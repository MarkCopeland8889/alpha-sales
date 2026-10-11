// Cloud file storage via rclone + Google Drive.
//
// Drive layout:  <RCLONE_REMOTE>:<RCLONE_ROOT>/<account email>/
//                    Accounts/ Profiles/ Configurations/ Scrapers/ Local Files/ Logs/ Archive/<date>/
//
// Blueprint functions:
//   check(path)        scan a file or folder and report differences (local vs Drive)
//   update(path)       upload a specific file, replacing the older version in Drive
//   updateAll()        check() -> fan out -> update() for every changed file, then pull newer files
//   archive.exist(p)   move a file that exists in Drive into the Archive folder
//   archive.new(p)     upload a local file/folder into Archive (before it is deleted)
//   onLocalEdit(p)     check() -> if different -> update()
//   onLocalDelete(p)   check() -> if it exists in Drive -> archive.exist(); else archive.new() when still on disk
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../core/env.js';
import { DATA_ROOT, SOFTWARE, SYNCED_FOLDERS, PATHS, ensureDir } from '../core/paths.js';
import { run, IS_WINDOWS, which } from '../core/commands.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';
import { machineInfo } from '../core/machine.js';
import { db } from '../db/index.js';
import { currentUser, accountFolderName } from '../auth/session.js';

const log = logger('sync');

// Never upload caches, lock files or the engine's private state.
export const FILTER_RULES = [
  '- .alpha/**',
  '- **/Cache/**',
  '- **/Code Cache/**',
  '- **/GPUCache/**',
  '- **/GrShaderCache/**',
  '- **/ShaderCache/**',
  '- **/DawnCache/**',
  '- **/DawnGraphiteCache/**',
  '- **/DawnWebGPUCache/**',
  '- **/Service Worker/CacheStorage/**',
  '- **/Service Worker/ScriptCache/**',
  '- **/cache2/**',
  '- **/startupCache/**',
  '- **/Crashpad/**',
  '- **/crashes/**',
  '- **/SingletonLock',
  '- **/SingletonCookie',
  '- **/SingletonSocket',
  '- **/lockfile',
  '- **/parent.lock',
  '- **/.parentlock',
  '- **/*.tmp',
  '- **/*-journal',
];

export function rcloneExe() {
  const local = path.join(SOFTWARE.rclone, IS_WINDOWS ? 'rclone.exe' : 'rclone');
  return fs.existsSync(local) ? local : null;
}

function configFile() {
  return path.join(ensureDir(SOFTWARE.rclone), 'rclone.conf');
}

function filterFile() {
  const f = path.join(ensureDir(SOFTWARE.rclone), 'filter.txt');
  fs.writeFileSync(f, `${FILTER_RULES.join('\n')}\n`);
  return f;
}

async function exe() {
  const local = rcloneExe();
  if (local) return local;
  const onPath = await which('rclone');
  if (onPath) return onPath;
  throw new Error('rclone is not installed. Run "Install software > rclone" first.');
}

async function rclone(args, opts = {}) {
  const bin = await exe();
  return run(bin, ['--config', configFile(), ...args], { quiet: true, ...opts });
}

export function remoteBase(user = currentUser()) {
  return `${config.rcloneRemote}:${config.rcloneRoot}/${accountFolderName(user)}`;
}

const toPosix = (p) => p.split(path.sep).join('/');

function relOf(p) {
  const abs = path.isAbsolute(p) ? p : path.join(DATA_ROOT, p);
  const rel = path.relative(DATA_ROOT, abs);
  if (rel.startsWith('..')) throw new Error(`${p} is outside the Alpha-Sales folder`);
  return { abs, rel: toPosix(rel) };
}

const remoteOf = (rel) => `${remoteBase()}/${rel}`;
const archiveOf = (rel) => `${remoteBase()}/Archive/${new Date().toISOString().slice(0, 10)}/${rel}`;

// Small queue so we never run more than two rclone transfers at once.
let active = 0;
const waiting = [];
async function queued(fn) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

async function recordEdit(rel, action, size) {
  const user = currentUser();
  if (!user) return;
  const m = await machineInfo();
  const now = new Date().toISOString();
  try {
    await db.upsert('file_sync', { account_id: user.id, path: rel, last_edit: now, machine_id: m.machineId, size, action }, ['account_id', 'path']);
    await db.update('devices', { account_id: user.id, machine_id: m.machineId }, { last_edit: now });
  } catch (err) {
    log.warn('Could not record the sync in the database', err);
  }
}

export async function status() {
  const bin = rcloneExe() || (await which('rclone'));
  let remoteConfigured = false;
  if (bin) {
    const res = await rclone(['listremotes']);
    remoteConfigured = res.stdout.split(/\r?\n/).some((l) => l.trim() === `${config.rcloneRemote}:`);
  }
  return {
    installed: Boolean(bin),
    binary: bin,
    remote: config.rcloneRemote,
    remoteConfigured,
    base: currentUser() ? remoteBase() : null,
    autoSync: config.rcloneAutoSync,
  };
}

// Connects Google Drive: rclone opens the Google consent page in the browser.
export async function connectDrive({ onOutput } = {}) {
  const args = ['config', 'create', config.rcloneRemote, 'drive', 'scope=drive'];
  if (config.googleClientId && config.googleClientSecret) {
    args.push(`client_id=${config.googleClientId}`, `client_secret=${config.googleClientSecret}`);
  }
  log.ok('Opening Google Drive authorization in your browser');
  const res = await rclone(args, { onOutput, timeout: 10 * 60 * 1000 });
  if (!res.ok) throw new Error(`rclone could not connect Google Drive: ${res.stderr.slice(-800)}`);
  log.ok(`Google Drive connected as remote "${config.rcloneRemote}"`);
  await ensureRemoteSkeleton();
  return status();
}

// Creates the account folder and its template subfolders in Drive.
export async function ensureRemoteSkeleton() {
  for (const folder of [...SYNCED_FOLDERS, 'Logs', 'Archive']) {
    await rclone(['mkdir', `${remoteBase()}/${folder}`]);
  }
}

async function remoteStat(rel) {
  const res = await rclone(['lsjson', '--stat', remoteOf(rel)]);
  if (!res.ok) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

// check(): one file -> { state: same|different|local-only|remote-only|missing }.
//          folder   -> { same:[], different:[], localOnly:[], remoteOnly:[], errors:[] }
export async function check(target = '') {
  const { abs, rel } = relOf(target || DATA_ROOT);
  const localExists = fs.existsSync(abs);
  if (localExists && fs.statSync(abs).isFile()) {
    const st = fs.statSync(abs);
    const remote = await remoteStat(rel);
    if (!remote) return { path: rel, state: 'local-only' };
    const sameSize = Number(remote.Size) === st.size;
    const sameTime = Math.abs(new Date(remote.ModTime).getTime() - st.mtimeMs) < 2000;
    return { path: rel, state: sameSize && sameTime ? 'same' : 'different', remoteModified: remote.ModTime, localModified: st.mtime };
  }
  if (!localExists) {
    const remote = await remoteStat(rel);
    return { path: rel, state: remote ? 'remote-only' : 'missing' };
  }
  const folders = rel ? [rel] : SYNCED_FOLDERS;
  const report = { same: [], different: [], localOnly: [], remoteOnly: [], errors: [] };
  for (const folder of folders) {
    const res = await rclone(['check', path.join(DATA_ROOT, folder), remoteOf(folder), '--combined', '-', '--filter-from', filterFile(), '--size-only']);
    for (const line of res.stdout.split(/\r?\n/)) {
      const m = line.match(/^([=+\-*!]) (.+)$/);
      if (!m) continue;
      const p = `${folder}/${m[2]}`;
      ({ '=': report.same, '+': report.localOnly, '-': report.remoteOnly, '*': report.different, '!': report.errors })[m[1]].push(p);
    }
  }
  return report;
}

// update(): uploads one file and replaces the older copy in Drive.
export async function update(target) {
  const { abs, rel } = relOf(target);
  return queued(async () => {
    const res = await rclone(['copyto', abs, remoteOf(rel)]);
    if (!res.ok) throw new Error(`Upload failed for ${rel}: ${res.stderr.slice(-500)}`);
    const size = fs.existsSync(abs) ? fs.statSync(abs).size : null;
    await recordEdit(rel, 'updated', size);
    log.ok(`Backed up ${rel}`);
    emit('sync.updated', { path: rel });
    return { path: rel };
  });
}

// Uploads a whole folder (only newer files). Used for browser profiles after they close.
export async function pushFolder(target) {
  const { abs, rel } = relOf(target);
  return queued(async () => {
    const res = await rclone(['copy', abs, remoteOf(rel), '--update', '--filter-from', filterFile()]);
    if (!res.ok) throw new Error(`Folder upload failed for ${rel}: ${res.stderr.slice(-500)}`);
    await recordEdit(rel, 'updated', null);
    log.ok(`Backed up folder ${rel}`);
    return { path: rel };
  });
}

// Downloads files that are newer in Drive (run on app launch).
export async function pull(folders = SYNCED_FOLDERS) {
  const out = [];
  for (const folder of folders) {
    const res = await queued(() => rclone(['copy', remoteOf(folder), path.join(DATA_ROOT, folder), '--update', '--filter-from', filterFile()]));
    if (!res.ok && !/directory not found/i.test(res.stderr)) log.warn(`Pull failed for ${folder}`, { stderr: res.stderr.slice(-500) });
    else out.push(folder);
  }
  log.ok('Pulled newer files from Google Drive', { folders: out });
  return out;
}

export const archive = {
  // Moves a file or folder that exists in Drive into Archive/<date>/...
  async exist(target) {
    const { rel } = relOf(target);
    const res = await queued(() => rclone(['moveto', remoteOf(rel), archiveOf(rel)]));
    if (!res.ok) throw new Error(`Archive failed for ${rel}: ${res.stderr.slice(-500)}`);
    await recordEdit(rel, 'archived', null);
    log.ok(`Archived ${rel} in Drive`);
    return { path: rel };
  },
  // Uploads a local file/folder straight into Archive (use before deleting it locally).
  async new(target) {
    const { abs, rel } = relOf(target);
    const isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
    const res = await queued(() => rclone([isDir ? 'copy' : 'copyto', abs, archiveOf(rel), '--filter-from', filterFile()]));
    if (!res.ok) throw new Error(`Archive upload failed for ${rel}: ${res.stderr.slice(-500)}`);
    await recordEdit(rel, 'archived', null);
    log.ok(`Uploaded ${rel} to the Drive archive`);
    return { path: rel };
  },
};

export async function onLocalEdit(target) {
  const res = await check(target);
  if (res.state === 'different' || res.state === 'local-only') return update(target);
  return null;
}

export async function onLocalDelete(target) {
  const res = await check(target);
  if (res.state === 'remote-only') return archive.exist(target);
  if (res.state === 'same' || res.state === 'different' || res.state === 'local-only') return archive.new(target);
  return null;
}

// Safe delete used by the app: archive first, then remove locally.
export async function removeWithArchive(target) {
  const { abs, rel } = relOf(target);
  const s = await status();
  if (s.installed && s.remoteConfigured && currentUser()) {
    const remote = await remoteStat(rel);
    if (remote) await archive.exist(rel);
    else if (fs.existsSync(abs)) await archive.new(rel);
  }
  fs.rmSync(abs, { recursive: true, force: true });
  log.ok(`Deleted ${rel}`);
}

// update(): the login-time full sync. check -> fan out -> update, then pull newer files from Drive.
export async function updateAll() {
  const s = await status();
  if (!s.installed || !s.remoteConfigured) {
    log.warn('Skipping Google Drive sync: rclone or the Drive remote is not set up yet');
    return { skipped: true };
  }
  await ensureRemoteSkeleton();
  // Pull first so files edited on another computer win when they are newer,
  // then upload whatever is still newer or only present here.
  await pull();
  const report = await check();
  const toPush = [...report.different, ...report.localOnly].filter((p) => !p.startsWith('Profiles/'));
  for (const p of toPush) {
    try {
      await update(p);
    } catch (err) {
      log.warn(`Could not upload ${p}`, err);
    }
  }
  // Profiles are uploaded per folder (only newer files) instead of file by file.
  if (fs.existsSync(PATHS.profiles)) await pushFolder('Profiles').catch((err) => log.warn('Profile backup failed', err));
  await pushLogs().catch(() => {});
  const summary = { uploaded: toPush.length, remoteOnly: report.remoteOnly.length, errors: report.errors.length };
  log.ok('Google Drive sync finished', summary);
  emit('sync.finished', summary);
  return summary;
}

export async function pushLogs() {
  return rclone(['copy', PATHS.logs, remoteOf('Logs'), '--update']);
}
