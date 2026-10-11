// Watches the synced folders and backs up edits to Google Drive as they happen.
// Browser profiles are not watched file-by-file (they change constantly while open);
// they are uploaded as a folder when their browser session closes.
import path from 'node:path';
import { watch } from 'chokidar';
import { DATA_ROOT } from '../core/paths.js';
import { config } from '../core/env.js';
import { logger } from '../core/logbook.js';
import { onLocalEdit, onLocalDelete, status } from './rclone.js';

const log = logger('sync:watch');
const WATCHED = ['Accounts', 'Configurations', 'Scrapers', 'Local Files'];
const IGNORE = [/[\\/]\.alpha([\\/]|$)/, /\.tmp$/, /~$/, /[\\/]\.git([\\/]|$)/, /[\\/]node_modules([\\/]|$)/];

let watcher = null;
const timers = new Map();

function debounce(file, fn) {
  clearTimeout(timers.get(file));
  timers.set(file, setTimeout(() => {
    timers.delete(file);
    fn().catch((err) => log.warn(`Sync failed for ${path.relative(DATA_ROOT, file)}`, err));
  }, 3000));
}

export async function startWatcher() {
  if (watcher || !config.rcloneAutoSync) return;
  const s = await status();
  if (!s.installed || !s.remoteConfigured) {
    log.warn('Auto-sync is off until rclone and Google Drive are connected');
    return;
  }
  watcher = watch(WATCHED.map((f) => path.join(DATA_ROOT, f)), {
    ignoreInitial: true,
    ignored: (p) => IGNORE.some((re) => re.test(p)),
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 },
  });
  watcher.on('add', (f) => debounce(f, () => onLocalEdit(f)));
  watcher.on('change', (f) => debounce(f, () => onLocalEdit(f)));
  watcher.on('unlink', (f) => debounce(f, () => onLocalDelete(f)));
  watcher.on('error', (err) => log.warn('File watcher error', err));
  log.ok('Watching folders for changes to back up', { folders: WATCHED });
}

export async function stopWatcher() {
  await watcher?.close();
  watcher = null;
}
