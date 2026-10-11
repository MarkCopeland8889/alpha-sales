// The `ctx` object every scraper receives. It bundles the browser page, logging,
// checkpoints, AI, the data store, human-in-the-loop and guardrails.
import { db } from '../db/index.js';
import { ai } from '../ai/index.js';
import { datastore } from './datastore.js';
import * as human from './human.js';
import { requestHuman, detectChallenge } from './hitl.js';
import * as guardrails from '../guardrails/index.js';
import { reportSiteStatus } from '../proxies/index.js';
import { getProfile } from '../profiles/index.js';

export async function createContext({ run, scraper, input, session, page, log, signal, accountId, project, shared = {}, onProgress }) {
  const resumeRows = run.resumeFrom
    ? await db.select('checkpoints', { run_id: run.resumeFrom, scraper: scraper.name }, { order: 'created_at' })
    : [];
  const resume = Object.fromEntries(resumeRows.map((r) => [r.name, r.data]));
  const profile = session ? getProfile(session.browser, session.profile) : null;
  // The run shows "waiting_human" while a person is needed, then goes back to "running".
  const withHuman = async (req) => {
    await db.update('job_runs', { id: run.id }, { status: 'waiting_human' }).catch(() => {});
    try {
      return await requestHuman({ runId: run.id, page, ...req });
    } finally {
      await db.update('job_runs', { id: run.id, status: 'waiting_human' }, { status: 'running' }).catch(() => {});
    }
  };

  const ctx = {
    run,
    scraper: scraper.name,
    input,
    project: project || null,
    variables: project?.variables || {},
    // Values passed between the steps of one job run (e.g. AI answers used by later scrapers).
    shared,
    session,
    page,
    log,
    ai,
    human,
    signal,
    // Checkpoint data from the run being resumed, keyed by checkpoint name.
    resume,

    shouldStop() {
      return signal.aborted || guardrails.getGuardrails().killSwitch;
    },
    throwIfStopped() {
      if (signal.aborted) throw new Error('Run stopped');
      guardrails.assertRunning();
    },

    async checkpoint(name, data = {}) {
      ctx.throwIfStopped();
      await db.insert('checkpoints', { account_id: accountId, run_id: run.id, job_id: run.jobId ?? null, scraper: scraper.name, name, data });
      log.ok(`Checkpoint: ${name}`);
      await onProgress?.({ scraper: scraper.name, checkpoint: name, at: new Date().toISOString() });
    },

    progress(data) {
      return onProgress?.({ scraper: scraper.name, ...data });
    },

    store: (...area) => datastore(...area),

    // Humanized actions on the current page ("basic" controller).
    click: (selector, o) => human.click(page, selector, o),
    type: (selector, text, o) => human.type(page, selector, text, o),
    fill: (selector, value, o) => human.fill(page, selector, value, o),
    scroll: (o) => human.scroll(page, o),
    pause: (min, max) => human.pause(min, max),

    // Counts an action against the daily budget for the account this profile belongs to.
    action: (name, opts = {}) => guardrails.action(name, { account: opts.account || (session ? `${session.browser}/${session.profile}` : 'default'), ...opts }),

    askHuman: (message, opts = {}) => withHuman({ message, url: opts.url ?? null, kind: opts.kind || 'task', timeoutMs: opts.timeoutMs }),

    detectChallenge: () => detectChallenge(page),

    // If a CAPTCHA or security check is showing, pause until a human solves it.
    async guardCaptcha() {
      const hit = await detectChallenge(page);
      if (!hit) return false;
      const url = typeof page.url === 'function' ? await page.url() : null;
      await withHuman({ kind: hit.kind, message: `Solve the ${hit.kind} (${hit.detail}) in profile "${session?.profile}", then click Done`, url });
      return true;
    },

    // Records how a website behaves through this profile's proxy (working / restricted / blocked).
    async reportSite(website, status, reason) {
      if (!profile?.proxyId) return null;
      return reportSiteStatus(accountId, profile.proxyId, website, status, reason);
    },
  };
  return ctx;
}
