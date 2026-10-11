// Profiles: Profiles/<Browser>/<Profile>/ is the browser's own data folder (cookies,
// history, logins, extensions). Alpha-Sales keeps its settings for the profile in
// alpha-profile.json inside that folder: proxy, configuration, extensions, notes.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, BROWSER_FOLDERS, profileDir, safeName, readJson, writeJson, ensureDir } from '../core/paths.js';
import { machineInfo } from '../core/machine.js';
import { logger } from '../core/logbook.js';
import { removeWithArchive } from '../sync/rclone.js';
import { defaultExtensions, EXT_KIND } from '../extensions/index.js';

const log = logger('profiles');
export const META_FILE = 'alpha-profile.json';
export const BROWSERS = Object.keys(BROWSER_FOLDERS);
const LOCK_DIR = path.join(PATHS.state, 'locks');

function assertBrowser(browser) {
  if (!BROWSERS.includes(browser)) throw new Error(`Unknown browser "${browser}". Use one of: ${BROWSERS.join(', ')}`);
}

export function getProfile(browser, name) {
  assertBrowser(browser);
  const dir = profileDir(browser, safeName(name));
  if (!fs.existsSync(dir)) return null;
  const meta = readJson(path.join(dir, META_FILE), {});
  return { name: safeName(name), browser, path: dir, ...defaults(), ...meta, locked: readLock(browser, name) };
}

function defaults() {
  return { proxyId: null, config: null, extensions: [], notes: '', startUrl: '', accounts: [] };
}

export function listProfiles(browser) {
  const browsers = browser ? [browser] : BROWSERS;
  const out = [];
  for (const b of browsers) {
    const root = path.join(PATHS.profiles, BROWSER_FOLDERS[b]);
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      if (name.startsWith('.')) continue;
      if (!fs.statSync(path.join(root, name)).isDirectory()) continue;
      out.push(getProfile(b, name));
    }
  }
  return out;
}

// Without an explicit extension list, a new profile gets the default extensions for its browser.
export function createProfile({ browser, name, proxyId = null, config = null, extensions, notes = '', startUrl = '' }) {
  assertBrowser(browser);
  if (!name) throw new Error('Profile name is required');
  const clean = safeName(name);
  const dir = profileDir(browser, clean);
  if (fs.existsSync(dir)) throw new Error(`Profile "${clean}" already exists for ${BROWSER_FOLDERS[browser]}`);
  ensureDir(dir);
  if (!Array.isArray(extensions)) extensions = defaultExtensions(EXT_KIND[browser].toLowerCase());
  const meta = { name: clean, browser, proxyId, config, extensions, notes, startUrl, accounts: [], createdAt: new Date().toISOString(), lastUsed: null };
  writeJson(path.join(dir, META_FILE), meta);
  log.ok(`Created ${BROWSER_FOLDERS[browser]} profile "${clean}"`);
  return getProfile(browser, clean);
}

export function updateProfile(browser, name, patch) {
  const p = getProfile(browser, name);
  if (!p) throw new Error(`Profile "${name}" not found`);
  const metaPath = path.join(p.path, META_FILE);
  const meta = { ...readJson(metaPath, {}), ...patch, name: p.name, browser };
  writeJson(metaPath, meta);
  return getProfile(browser, name);
}

export async function deleteProfile(browser, name) {
  const p = getProfile(browser, name);
  if (!p) throw new Error(`Profile "${name}" not found`);
  if (p.locked) throw new Error('Close this profile\'s browser before deleting it');
  // Archived to Google Drive first (when connected), then removed locally.
  await removeWithArchive(p.path);
  log.ok(`Deleted profile "${name}"`);
}

// ---- Locks: one running browser per profile --------------------------------------------
const lockFile = (browser, name) => path.join(LOCK_DIR, `${browser}__${safeName(name)}.lock`);

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function readLock(browser, name) {
  const lock = readJson(lockFile(browser, name), null);
  if (!lock) return null;
  // A lock from a crashed run of this app is stale.
  if (lock.pid && lock.pid !== process.pid && !pidAlive(lock.pid)) {
    fs.rmSync(lockFile(browser, name), { force: true });
    return null;
  }
  return lock;
}

export async function acquireLock(browser, name, sessionId) {
  const existing = readLock(browser, name);
  if (existing) throw new Error(`Profile "${name}" is already open (session ${existing.sessionId})`);
  const m = await machineInfo();
  writeJson(lockFile(browser, name), { pid: process.pid, machineId: m.machineId, sessionId, at: new Date().toISOString() });
}

export function releaseLock(browser, name) {
  fs.rmSync(lockFile(browser, name), { force: true });
}
