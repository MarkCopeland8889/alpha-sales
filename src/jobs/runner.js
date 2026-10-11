// Executes one job run on this computer: opens the browser, runs each scraper step,
// saves checkpoints and progress, sends a run heartbeat, and always cleans up.
import path from 'node:path';
import { db } from '../db/index.js';
import { PATHS, safeName, ensureDir } from '../core/paths.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';
import { stamp } from '../core/utils.js';
import { machineInfo } from '../core/machine.js';
import { appVersion } from '../core/version.js';
import { markBusy, markIdle } from '../devices/registry.js';
import { openBrowser } from '../browsers/index.js';
import { getScraper, prepareInput } from '../scrapers/index.js';
import { createContext } from '../scrapers/context.js';
import { getGuardrails, assertRunning } from '../guardrails/index.js';

const active = new Map(); // runId -> { controller, label }

export function activeRuns() {
  return [...active.entries()].map(([id, a]) => ({ id, label: a.label, startedAt: a.startedAt }));
}

export function abortLocalRun(runId, reason = 'Stopped by user') {
  const a = active.get(runId);
  if (!a) return false;
  a.controller.abort(new Error(reason));
  return true;
}

export function abortAllRuns(reason = 'Kill switch') {
  for (const id of active.keys()) abortLocalRun(id, reason);
}

function untilAborted(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason || new Error('Run stopped'));
    signal.addEventListener('abort', () => reject(signal.reason || new Error('Run stopped')), { once: true });
  });
}

export async function executeRun(row) {
  const spec = row.spec || {};
  const label = row.label || spec.name || 'Ad-hoc run';
  const controller = new AbortController();
  const { signal } = controller;
  const startedAt = new Date().toISOString();
  active.set(row.id, { controller, label, startedAt });

  const logFile = path.join(ensureDir(path.join(PATHS.logs, 'jobs')), `${stamp()}_${safeName(label, 40)}_${row.id.slice(0, 8)}.log`);
  const log = logger(`job:${label}`, { file: logFile });
  const m = await machineInfo();
  const v = await appVersion();
  const update = (patch) => db.update('job_runs', { id: row.id }, patch).catch((err) => log.warn('Could not update the run row', err));

  await update({ status: 'running', started_at: startedAt, machine_id: m.machineId, app_version: v.full, last_heartbeat: startedAt, log_file: path.relative(PATHS.logs, logFile) });
  if (row.job_id) await db.update('jobs', { id: row.job_id }, { status: 'running', machine_id: m.machineId, last_heartbeat: startedAt }).catch(() => {});
  emit('run.started', { id: row.id, label });
  markBusy();
  log.ok(`Run started on ${m.deviceName}`, { steps: spec.steps?.length, browser: spec.browser });

  // Run heartbeat; also notices a stop requested from another computer.
  const heartbeat = setInterval(async () => {
    const now = new Date().toISOString();
    await update({ last_heartbeat: now });
    if (row.job_id) await db.update('jobs', { id: row.job_id }, { last_heartbeat: now }).catch(() => {});
    const fresh = await db.get('job_runs', row.id).catch(() => null);
    if (fresh?.status === 'stopped') controller.abort(new Error('Stopped from another computer'));
    if (getGuardrails().killSwitch) controller.abort(new Error('Kill switch'));
  }, 30000);
  const maxMinutes = spec.maxRunMinutes || getGuardrails().maxRunMinutes;
  const timeout = setTimeout(() => controller.abort(new Error(`Run exceeded ${maxMinutes} minutes`)), maxMinutes * 60000);

  let session = null;
  const results = [];
  let progress = {};
  const onProgress = async (p) => {
    progress = { ...progress, ...p, step: p.step ?? progress.step };
    await update({ progress });
    emit('run.progress', { id: row.id, progress });
  };

  try {
    assertRunning();
    const project = spec.projectId ? await db.get('projects', spec.projectId) : null;
    const defs = await Promise.all((spec.steps || []).map((s) => getScraper(s.scraper)));
    const needsBrowser = defs.some((d) => d.needsBrowser !== false);
    if (needsBrowser) {
      session = await openBrowser({ ...spec.browser, controller: spec.controller || 'basic' });
      // If the browser dies mid-run, stop the run.
      session.onClose(() => controller.abort(new Error('The browser was closed')));
    }
    const mainPage = session ? await session.page() : null;
    const shared = {};
    const runInfo = { id: row.id, jobId: row.job_id, label, resumeFrom: spec.resumeFrom || null };

    const runStep = async (step, i, page) => {
      const def = defs[i];
      const stepLog = log.child(step.label || def.name);
      const input = prepareInput(def, step.input);
      await onProgress({ step: i + 1, of: defs.length, scraper: def.name, checkpoint: null });
      const ctx = await createContext({
        run: runInfo, scraper: def, input, session, page, log: stepLog, signal,
        accountId: row.account_id, project, shared, onProgress,
      });
      try {
        const result = await Promise.race([def.run(ctx, input), untilAborted(signal)]);
        results[i] = { step: i + 1, scraper: def.name, ok: true, result: result ?? null };
        stepLog.ok('Step finished');
      } catch (err) {
        results[i] = { step: i + 1, scraper: def.name, ok: false, error: err.message };
        if (page && !signal.aborted) {
          const shot = path.join(ensureDir(path.join(PATHS.logs, 'screens', row.id)), `step-${i + 1}.png`);
          await page.screenshot({ path: shot }).then(() => stepLog.fail('Step failed (screenshot saved)', { error: err.message, screenshot: shot }))
            .catch(() => stepLog.fail('Step failed', err));
        } else stepLog.fail('Step failed', err);
        if (!step.continueOnError || signal.aborted) throw err;
      }
    };

    if (spec.mode === 'parallel') {
      await Promise.all(spec.steps.map(async (step, i) => {
        const page = defs[i].needsBrowser === false ? null : i === 0 ? mainPage : await session.newPage();
        return runStep(step, i, page);
      }));
    } else {
      for (let i = 0; i < spec.steps.length; i += 1) {
        assertRunning();
        if (signal.aborted) throw signal.reason;
        await runStep(spec.steps[i], i, defs[i].needsBrowser === false ? null : mainPage);
      }
    }

    await update({ status: 'completed', finished_at: new Date().toISOString(), result: { steps: results, shared: summarize(shared) } });
    log.ok('Run completed');
    emit('run.finished', { id: row.id, status: 'completed' });
    return { status: 'completed', results };
  } catch (err) {
    const status = signal.aborted ? 'stopped' : 'failed';
    await update({ status, finished_at: new Date().toISOString(), error: err.message, result: { steps: results } });
    if (status === 'stopped') log.warn(`Run stopped: ${err.message}`);
    else log.fail('Run failed', err);
    emit('run.finished', { id: row.id, status, error: err.message });
    return { status, error: err.message, results };
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    if (session && !(spec.keepOpen && !signal.aborted)) await session.close().catch(() => {});
    if (row.job_id) await db.update('jobs', { id: row.job_id }, { status: 'idle', machine_id: null }).catch(() => {});
    active.delete(row.id);
    markIdle();
  }
}

function summarize(shared) {
  return Object.fromEntries(Object.entries(shared).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 2000) : v]));
}
