// App version and the quick update command.
// Version = package.json version + git commit, e.g. "0.1.0+3f9c2ab". Computers only
// delegate jobs to each other when these strings match exactly.
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, readJson } from './paths.js';
import { run, IS_WINDOWS } from './commands.js';
import { logger } from './logbook.js';

const log = logger('version');
export const RESTART_EXIT_CODE = 75;
let cachedVersion = null;

async function gitCommit() {
  if (!fs.existsSync(path.join(APP_ROOT, '.git'))) return null;
  const res = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP_ROOT, quiet: true });
  return res.ok ? res.stdout.trim() : null;
}

export async function appVersion({ refresh = false } = {}) {
  if (cachedVersion && !refresh) return cachedVersion;
  const pkg = readJson(path.join(APP_ROOT, 'package.json'), {});
  const commit = await gitCommit();
  cachedVersion = { version: pkg.version || '0.0.0', commit, full: commit ? `${pkg.version}+${commit}` : pkg.version };
  return cachedVersion;
}

// Pulls the latest code and reinstalls dependencies. Returns what changed.
// The caller decides whether to restart (exit with RESTART_EXIT_CODE so start.cmd/start.sh relaunch).
export async function updateApp({ onOutput } = {}) {
  const before = await appVersion({ refresh: true });
  if (!before.commit) throw new Error('This copy is not a git checkout, so it cannot self-update. Clone the repository with git first.');
  const status = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: APP_ROOT, quiet: true });
  if (status.stdout.trim()) throw new Error('There are uncommitted code changes; commit or stash them before updating.');
  log.ok('Updating: pulling latest code');
  const pull = await run('git', ['pull', '--ff-only'], { cwd: APP_ROOT, onOutput });
  if (!pull.ok) throw new Error(`git pull failed: ${pull.stderr || pull.stdout}`);
  const after = await appVersion({ refresh: true });
  if (after.commit === before.commit) {
    log.ok('Already up to date', { version: after.full });
    return { updated: false, from: before.full, to: after.full };
  }
  log.ok('Installing dependencies');
  const npm = IS_WINDOWS ? 'npm.cmd' : 'npm';
  const install = await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: APP_ROOT, onOutput, shell: IS_WINDOWS });
  if (!install.ok) throw new Error(`npm install failed: ${install.stderr.slice(-1500)}`);
  log.ok('Update installed', { from: before.full, to: after.full });
  return { updated: true, from: before.full, to: after.full };
}
