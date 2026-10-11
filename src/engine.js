// App lifecycle.
// Login process (blueprint): log login date, start app, write app version to the DB,
// write status and heartbeat, then run update() (Google Drive sync).
import { ensureFolders } from './core/paths.js';
import { logger, RUN_FILE } from './core/logbook.js';
import { appVersion } from './core/version.js';
import { machineInfo } from './core/machine.js';
import { db } from './db/index.js';
import { restoreSession, currentUser } from './auth/session.js';
import { registerDevice, startHeartbeat, goOffline } from './devices/registry.js';
import { updateAll } from './sync/rclone.js';
import { startWatcher, stopWatcher } from './sync/watcher.js';
import { startQueue, stopQueue } from './jobs/queue.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { closeAllSessions } from './browsers/index.js';
import { abortAllRuns } from './jobs/runner.js';

const log = logger('engine');
let started = false;

export async function boot() {
  ensureFolders();
  const v = await appVersion();
  const m = await machineInfo();
  log.ok(`Alpha-Sales ${v.full} starting on ${m.deviceName}`, { logFile: RUN_FILE, db: db.mode });
  const user = await restoreSession();
  if (user) await onLogin(user);
  return user;
}

export async function onLogin(user = currentUser()) {
  if (!user) return;
  const now = new Date().toISOString();
  // First login creates the account bucket (sign-up); later logins refresh it.
  await db.upsert('accounts', { id: user.id, email: user.email, display_name: user.name, last_login: now }, ['id']);
  await registerDevice(user.id);
  startHeartbeat(user.id);
  await startQueue(user.id);
  await startScheduler(user.id);
  started = true;
  log.ok(`Logged in as ${user.email}`);
  // Drive sync runs in the background so the UI is usable right away.
  void updateAll()
    .then(() => startWatcher())
    .catch((err) => log.warn('Google Drive sync did not complete', err));
}

export async function onLogout() {
  stopQueue();
  stopScheduler();
  await stopWatcher();
  await goOffline();
  started = false;
}

export async function shutdown() {
  log.ok('Shutting down');
  abortAllRuns('App closing');
  await closeAllSessions().catch(() => {});
  if (started) await onLogout();
}
