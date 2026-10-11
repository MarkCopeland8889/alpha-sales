// Larger schedules: jobs with a cron expression run automatically on their target computer.
// Example schedules: "0 9 * * 1-5" (9:00 on weekdays), "*/30 * * * *" (every 30 minutes).
import { Cron } from 'croner';
import { machineInfo } from '../core/machine.js';
import { logger } from '../core/logbook.js';
import { onEvent } from '../core/events.js';
import { listJobs } from './index.js';
import { queueRun } from './queue.js';

const log = logger('scheduler');
const crons = new Map();
let accountId = null;
let off = null;

export function validateSchedule(expr) {
  try {
    const c = new Cron(expr, { paused: true });
    const next = c.nextRun();
    c.stop();
    return { ok: true, next };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function reloadSchedules() {
  if (!accountId) return;
  for (const c of crons.values()) c.stop();
  crons.clear();
  const me = await machineInfo();
  const jobs = await listJobs(accountId);
  for (const job of jobs) {
    if (!job.enabled || !job.schedule) continue;
    // A schedule runs on its target computer; jobs without one run where they were scheduled from.
    if (job.target_machine_id && job.target_machine_id !== me.machineId) continue;
    try {
      const cron = new Cron(job.schedule, { protect: true }, async () => {
        try {
          await queueRun(accountId, { jobId: job.id, machineId: me.machineId });
        } catch (err) {
          log.warn(`Scheduled run of "${job.name}" could not start`, err);
        }
      });
      crons.set(job.id, cron);
    } catch (err) {
      log.warn(`Invalid schedule "${job.schedule}" on job "${job.name}"`, err);
    }
  }
  if (crons.size) log.ok(`${crons.size} scheduled job(s) active`);
}

export function upcoming() {
  return [...crons.entries()].map(([jobId, c]) => ({ jobId, next: c.nextRun() }));
}

export async function startScheduler(accId) {
  accountId = accId;
  await reloadSchedules();
  off?.();
  off = onEvent((e) => {
    if (e.type === 'jobs.changed') void reloadSchedules();
  });
}

export function stopScheduler() {
  for (const c of crons.values()) c.stop();
  crons.clear();
  off?.();
  off = null;
}
