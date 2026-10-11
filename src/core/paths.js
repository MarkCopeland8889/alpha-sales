// Folder layout for Alpha-Sales.
// Every data folder named in the blueprint lives at the project root (or under
// ALPHA_HOME when set). They are git-ignored and backed up to Google Drive by rclone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_ROOT = process.env.ALPHA_HOME ? path.resolve(process.env.ALPHA_HOME) : APP_ROOT;

const at = (...p) => path.join(DATA_ROOT, ...p);

// Display names of the five built-in browsers. Used for folder names everywhere
// (Profiles/<Browser>/<Profile>, Software/<Browser>, Configurations/<Browser>).
export const BROWSER_FOLDERS = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  camoufox: 'Camoufox',
  vulpineos: 'VulpineOS',
  invisible: 'Invisible Playwright',
};

export const PATHS = {
  root: DATA_ROOT,
  app: APP_ROOT,
  accounts: at('Accounts'),
  profiles: at('Profiles'),
  configurations: at('Configurations'),
  scrapers: at('Scrapers'),
  localFiles: at('Local Files'),
  logs: at('Logs'),
  software: at('Software'),
  frameworks: at('Software', 'Frameworks'),
  extensionCopies: at('Software', 'Extension Copies'),
  // Engine state that should never be synced (sessions, local DB, locks).
  state: at('Local Files', '.alpha'),
  ui: path.join(APP_ROOT, 'ui'),
  bridges: path.join(APP_ROOT, 'bridges'),
};

export const SOFTWARE = {
  chrome: at('Software', 'Chrome'),
  firefox: at('Software', 'Firefox'), // Playwright's Juggler-patched Firefox build
  camoufox: at('Software', 'Camoufox'),
  vulpineos: at('Software', 'VulpineOS'),
  invisible: at('Software', 'Invisible-Playwright'),
  rclone: at('Software', 'rclone'),
  sevenZip: at('Software', '7zip'),
};

// Folders mirrored to Google Drive (see src/sync/rclone.js).
export const SYNCED_FOLDERS = ['Accounts', 'Profiles', 'Configurations', 'Scrapers', 'Local Files'];

export function profileDir(browser, profile) {
  return path.join(PATHS.profiles, BROWSER_FOLDERS[browser] ?? browser, profile);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Creates the full local folder skeleton from the blueprint.
export function ensureFolders() {
  const dirs = [
    PATHS.accounts, PATHS.configurations, PATHS.scrapers, PATHS.localFiles, PATHS.logs,
    PATHS.software, PATHS.frameworks, PATHS.state,
    path.join(PATHS.extensionCopies, 'Chrome'),
    path.join(PATHS.extensionCopies, 'Firefox'),
    path.join(PATHS.configurations, 'Camoufox'),
    path.join(PATHS.configurations, 'Invisible Playwright'),
    path.join(PATHS.configurations, 'Chrome'),
    ...Object.values(BROWSER_FOLDERS).map((b) => path.join(PATHS.profiles, b)),
  ];
  for (const d of dirs) ensureDir(d);
}

// Makes a string safe to use as a single folder or file name on Windows, macOS and Linux.
export function safeName(name, max = 80) {
  const cleaned = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const short = cleaned.slice(0, max).trim();
  // Windows reserves these device names in any folder.
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(short)) return `_${short}`;
  return short || 'untitled';
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Atomic JSON write: write to a temp file then rename, so a crash never leaves half a file.
export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  return data;
}
