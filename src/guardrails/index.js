// Guardrails: limits that keep accounts safe and runs under control.
//   - daily action budgets per account + action (e.g. linkedin.profile_view: 80/day)
//   - a minimum gap between actions on the same account, longer for LinkedIn page loads
//   - a global kill switch that stops every job and blocks new actions
//   - a maximum run time per job (enforced by the job runner)
// Settings live in Configurations/guardrails.json (synced); counters in Local Files/.alpha.
import path from 'node:path';
import { PATHS, readJson, writeJson } from '../core/paths.js';
import { sleep } from '../core/utils.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';

const log = logger('guardrails');
const SETTINGS = path.join(PATHS.configurations, 'guardrails.json');
const counterFile = () => path.join(PATHS.state, 'guardrails', `${new Date().toISOString().slice(0, 10)}.json`);

export const DEFAULT_GUARDRAILS = {
  killSwitch: false,
  maxRunMinutes: 240,
  minActionGapMs: 1200,
  maxConcurrentRuns: 2,
  // perDay: daily budget per account. minGapMs: wait at least this long after the account's
  // previous counted action before this one (LinkedIn page loads are spaced well apart).
  limits: {
    default: { perDay: 1000 },
    'linkedin.profile_view': { perDay: 80, minGapMs: 20000 },
    'linkedin.search_page': { perDay: 150, minGapMs: 15000 },
    'linkedin.post_view': { perDay: 300, minGapMs: 12000 },
    'linkedin.job_view': { perDay: 200, minGapMs: 12000 },
  },
};

export class GuardrailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardrailError';
  }
}

export function getGuardrails() {
  const saved = readJson(SETTINGS, {});
  const limits = { ...DEFAULT_GUARDRAILS.limits };
  for (const [k, v] of Object.entries(saved.limits || {})) limits[k] = { ...DEFAULT_GUARDRAILS.limits[k], ...v };
  return { ...DEFAULT_GUARDRAILS, ...saved, limits };
}

export function saveGuardrails(patch) {
  const next = { ...getGuardrails(), ...patch };
  writeJson(SETTINGS, next);
  log.ok('Guardrails updated');
  emit('guardrails.changed', next);
  return next;
}

export function setKillSwitch(on) {
  const g = saveGuardrails({ killSwitch: Boolean(on) });
  if (on) log.warn('Kill switch ON: all jobs stop and no new actions run');
  else log.ok('Kill switch off');
  return g;
}

export function usageToday() {
  return readJson(counterFile(), {});
}

const lastAction = new Map();

export function assertRunning() {
  if (getGuardrails().killSwitch) throw new GuardrailError('Kill switch is on');
}

// Call before each counted action. Waits out the minimum gap, then counts it, or throws when over budget.
export async function action(name, { account = 'default', count = 1 } = {}) {
  const g = getGuardrails();
  if (g.killSwitch) throw new GuardrailError('Kill switch is on');
  const limit = g.limits[name] || g.limits.default;
  const key = `${account}|${name}`;
  const counters = usageToday();
  const used = counters[key] || 0;
  if (limit?.perDay && used + count > limit.perDay) {
    throw new GuardrailError(`Daily limit reached for ${name} on ${account} (${used}/${limit.perDay})`);
  }
  const gap = Math.max(Number(g.minActionGapMs) || 0, Number(limit?.minGapMs) || 0);
  const since = Date.now() - (lastAction.get(account) || 0);
  if (since < gap) await sleep(gap - since);
  lastAction.set(account, Date.now());
  counters[key] = used + count;
  writeJson(counterFile(), counters);
  return { used: counters[key], limit: limit?.perDay ?? null };
}
