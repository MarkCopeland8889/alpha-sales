// Logbook: the debug/log collection system from the blueprint.
//
//   import { logger } from './core/logbook.js';
//   const log = logger('browsers');
//   log.ok('Chrome launched');                         // ✅ simple
//   log.warn('Proxy slow', { ms: 4200 });              // ⚠️ advanced (has details)
//   log.fail('Launch failed', err);                    // ❌ advanced (error + stack)
//
// Every entry, whatever its state or type, is appended to this run's file:
//   Logs/run_YYYY-MM-DD_HH-mm-ss.log
// Job runs also get their own file under Logs/jobs/ (see logger(scope, { file })).
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDir } from './paths.js';
import { emit } from './events.js';
import { stamp } from './utils.js';

export const STATES = { ok: '✅', warn: '⚠️', fail: '❌' };

const RUN_STARTED = new Date();
export const RUN_FILE = path.join(PATHS.logs, `run_${stamp(RUN_STARTED)}.log`);
const recent = [];
const MAX_RECENT = 1000;
let console_ = true;

export function setConsoleOutput(on) {
  console_ = on;
}

function timestamp(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function serializeDetails(details) {
  if (details == null) return null;
  if (details instanceof Error) {
    return { error: details.message, name: details.name, stack: details.stack?.split('\n').slice(0, 12).join('\n') };
  }
  if (typeof details !== 'object') return { value: details };
  try {
    return JSON.parse(JSON.stringify(details, (k, v) => (v instanceof Error ? { error: v.message, stack: v.stack } : v)));
  } catch {
    return { value: String(details) };
  }
}

function format(entry) {
  const head = `[${entry.time}] ${STATES[entry.state]} [${entry.scope}] ${entry.message}`;
  if (entry.type === 'simple') return head;
  const body = JSON.stringify(entry.details, null, 2).split('\n').map((l) => `    ${l}`).join('\n');
  return `${head}\n${body}`;
}

function append(file, text) {
  try {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, `${text}\n`);
  } catch {
    // Logging must never crash the app.
  }
}

function write(scope, state, message, details, extraFile) {
  const now = new Date();
  const serial = serializeDetails(details);
  const entry = {
    time: timestamp(now),
    at: now.toISOString(),
    state,
    icon: STATES[state],
    type: serial ? 'advanced' : 'simple',
    scope,
    message: String(message),
    details: serial,
  };
  const text = format(entry);
  append(RUN_FILE, text);
  if (extraFile) append(extraFile, text);
  recent.push(entry);
  if (recent.length > MAX_RECENT) recent.shift();
  if (console_) {
    const out = state === 'fail' ? console.error : console.log;
    out(text);
  }
  emit('log', entry);
  return entry;
}

export function logger(scope = 'app', { file } = {}) {
  return {
    scope,
    file,
    ok: (msg, details) => write(scope, 'ok', msg, details, file),
    info: (msg, details) => write(scope, 'ok', msg, details, file),
    warn: (msg, details) => write(scope, 'warn', msg, details, file),
    fail: (msg, details) => write(scope, 'fail', msg, details, file),
    child: (sub) => logger(`${scope}:${sub}`, { file }),
  };
}

export const log = logger('app');

export function recentLogs({ limit = 300, scope, state } = {}) {
  return recent
    .filter((e) => (!scope || e.scope.startsWith(scope)) && (!state || e.state === state))
    .slice(-limit);
}

export function listLogFiles() {
  const out = [];
  const walk = (dir, rel = '') => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, path.join(rel, name));
      else if (name.endsWith('.log')) out.push({ file: path.join(rel, name), size: st.size, modified: st.mtime });
    }
  };
  walk(PATHS.logs);
  return out.sort((a, b) => b.modified - a.modified);
}

export function readLogFile(rel, { tail = 200000 } = {}) {
  const full = path.resolve(PATHS.logs, rel);
  if (!full.startsWith(path.resolve(PATHS.logs))) throw new Error('Invalid log path');
  const text = fs.readFileSync(full, 'utf8');
  return text.length > tail ? text.slice(-tail) : text;
}
