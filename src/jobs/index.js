// Jobs: a saved set of scrapers plus the browser setup to run them with.
//
// definition = {
//   browser:   { browser: 'chrome', profile: 'sales-1', proxyId: null, config: null, headless: false },
//   controller: 'basic' | 'stealth' | 'jev',
//   mode:       'sequential' (steps one after another on the same tab) | 'parallel' (each step in its own tab)
//   steps:     [{ scraper: 'page-snapshot', input: { url: '...' }, label: 'Home page', continueOnError: false }],
//   keepOpen:  false,          // leave the browser open after the run
//   maxRunMinutes: 240,
// }
import { db } from '../db/index.js';
import { getScraper } from '../scrapers/index.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';

const log = logger('jobs');
export const CONTROLLERS = {
  basic: 'Basic Playwright: wait for each element, then act after a short random delay',
  stealth: 'Stealth: same steps, meant for Camoufox / VulpineOS / Invisible Playwright profiles',
  jev: 'Experimental Jev control system (decision model picks actions); not connected yet',
};

async function validate(def) {
  if (!Array.isArray(def.steps) || !def.steps.length) throw new Error('A job needs at least one step');
  for (const step of def.steps) await getScraper(step.scraper);
  const needsBrowser = await Promise.all(def.steps.map(async (s) => (await getScraper(s.scraper)).needsBrowser !== false));
  if (needsBrowser.some(Boolean) && (!def.browser?.browser || !def.browser?.profile)) {
    throw new Error('Choose a browser and profile for this job');
  }
  if (def.controller && !CONTROLLERS[def.controller]) throw new Error(`Unknown controller ${def.controller}`);
}

export async function listJobs(accountId) {
  return db.select('jobs', { account_id: accountId }, { order: 'created_at', desc: true });
}

export async function getJob(accountId, id) {
  const job = await db.get('jobs', id);
  if (!job || job.account_id !== accountId) throw new Error('Job not found');
  return job;
}

export async function saveJob(accountId, data) {
  const definition = {
    browser: data.definition?.browser || {},
    controller: data.definition?.controller || 'basic',
    mode: data.definition?.mode || 'sequential',
    steps: data.definition?.steps || [],
    keepOpen: Boolean(data.definition?.keepOpen),
    maxRunMinutes: data.definition?.maxRunMinutes || null,
  };
  await validate(definition);
  const row = {
    name: data.name || 'Untitled job',
    description: data.description || null,
    project_id: data.project_id || null,
    definition,
    schedule: data.schedule || null,
    target_machine_id: data.target_machine_id || null,
    enabled: data.enabled !== false,
  };
  let saved;
  if (data.id) {
    await getJob(accountId, data.id);
    [saved] = await db.update('jobs', { id: data.id, account_id: accountId }, row);
  } else {
    saved = await db.insert('jobs', { account_id: accountId, status: 'idle', ...row });
  }
  log.ok(`Saved job "${saved.name}"`);
  emit('jobs.changed', { id: saved.id });
  return saved;
}

export async function deleteJob(accountId, id) {
  await getJob(accountId, id);
  await db.remove('checkpoints', { job_id: id });
  await db.remove('job_runs', { job_id: id });
  await db.remove('jobs', { id, account_id: accountId });
  emit('jobs.changed', { id });
}

export async function listRuns(accountId, { jobId, limit = 50 } = {}) {
  const match = { account_id: accountId, ...(jobId ? { job_id: jobId } : {}) };
  return db.select('job_runs', match, { order: 'created_at', desc: true, limit });
}

export async function getRun(accountId, id) {
  const run = await db.get('job_runs', id);
  if (!run || run.account_id !== accountId) throw new Error('Run not found');
  const checkpoints = await db.select('checkpoints', { run_id: id }, { order: 'created_at' });
  return { ...run, checkpoints };
}
