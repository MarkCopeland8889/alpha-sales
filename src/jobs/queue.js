// Job queue & delegation. Every run is a row in job_runs with the machine_id of the
// computer that must run it. Each computer picks up its own queued runs (every 10 s,
// and instantly through Supabase realtime), so delegating a job to another computer is
// just queueing it with that computer's machine id.
import { db } from '../db/index.js';
import { config } from '../core/env.js';
import { machineInfo } from '../core/machine.js';
import { appVersion } from '../core/version.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';
import { checkDelegationTarget, currentStatus } from '../devices/registry.js';
import { getGuardrails } from '../guardrails/index.js';
import { getJob } from './index.js';
import { executeRun, activeRuns, abortLocalRun } from './runner.js';

const log = logger('queue');
let timer = null;
let unsubscribe = null;
let accountId = null;
let pumping = false;

export async function queueRun(accId, { jobId, spec, label, machineId, resumeFrom } = {}) {
  const me = await machineInfo();
  const v = await appVersion();
  let definition = spec;
  let job = null;
  if (jobId) {
    job = await getJob(accId, jobId);
    definition = { ...job.definition, name: job.name, projectId: job.project_id };
  }
  if (!definition?.steps?.length) throw new Error('Nothing to run');
  const target = machineId || job?.target_machine_id || me.machineId;
  const check = await checkDelegationTarget(accId, target);
  if (!check.ok) throw new Error(check.reason);

  const row = await db.insert('job_runs', {
    account_id: accId,
    job_id: jobId || null,
    label: label || job?.name || definition.name || 'Ad-hoc run',
    machine_id: target,
    requested_by: me.machineId,
    app_version: v.full,
    status: 'queued',
    spec: { ...definition, resumeFrom: resumeFrom || null },
    progress: {},
  });
  const where = target === me.machineId ? 'this computer' : check.target.device_name;
  log.ok(`Queued "${row.label}" on ${where}`);
  emit('run.queued', { id: row.id, machineId: target });
  if (target === me.machineId) setImmediate(() => void pump());
  return row;
}

// Picks up queued runs addressed to this computer.
export async function pump() {
  if (!accountId || pumping) return;
  pumping = true;
  try {
    if (['draining', 'maintenance', 'updating', 'error'].includes(currentStatus())) return;
    const g = getGuardrails();
    if (g.killSwitch) return;
    const free = g.maxConcurrentRuns - activeRuns().length;
    if (free <= 0) return;
    const me = await machineInfo();
    const queued = await db.select('job_runs', { account_id: accountId, machine_id: me.machineId, status: 'queued' }, { order: 'created_at', limit: free });
    for (const run of queued) {
      // Claim it (only succeeds if still queued) so a run never starts twice.
      const claimed = await db.update('job_runs', { id: run.id, status: 'queued' }, { status: 'running' });
      if (!claimed.length) continue;
      void executeRun(claimed[0]);
    }
  } catch (err) {
    log.warn('Queue check failed', err);
  } finally {
    pumping = false;
  }
}

export async function startQueue(accId) {
  accountId = accId;
  const me = await machineInfo();
  // Runs left "running" by a crash of this computer are marked failed.
  const stale = await db.select('job_runs', { account_id: accId, machine_id: me.machineId, status: 'running' });
  for (const r of stale) {
    if (!activeRuns().some((a) => a.id === r.id)) {
      await db.update('job_runs', { id: r.id }, { status: 'failed', error: 'Interrupted: the app was closed or crashed', finished_at: new Date().toISOString() });
    }
  }
  stopQueue();
  timer = setInterval(() => void pump(), 10000);
  timer.unref?.();
  if (config.useSupabase) {
    unsubscribe = db.subscribe('job_runs', `machine_id=eq.${me.machineId}`, () => void pump());
  }
  void pump();
}

export function stopQueue() {
  if (timer) clearInterval(timer);
  timer = null;
  unsubscribe?.();
  unsubscribe = null;
}

export async function stopRun(accId, runId) {
  const run = await db.get('job_runs', runId);
  if (!run || run.account_id !== accId) throw new Error('Run not found');
  const local = abortLocalRun(runId);
  if (!local && ['queued', 'running', 'paused', 'waiting_human'].includes(run.status)) {
    // Another computer runs it: its run heartbeat sees this and stops.
    await db.update('job_runs', { id: runId }, { status: 'stopped', error: 'Stopped by user', finished_at: new Date().toISOString() });
  }
  log.ok(`Stop requested for "${run.label}"`);
  return { local };
}
