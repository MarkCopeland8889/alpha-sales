// Imported first by every test file: points the app at a throwaway data folder and local mode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-test-'));
process.env.ALPHA_HOME = HOME;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.RCLONE_AUTO_SYNC = 'false';
process.env.ALPHA_SECRET = 'test-secret';

// A Chromium build stands in for consumer Chrome where Chrome is not installed (CI, containers).
const CHROMIUM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
if (!process.env.CHROME_PATH) {
  const found = CHROMIUM.find((p) => fs.existsSync(p));
  if (found) process.env.CHROME_PATH = found;
}
export const HAS_BROWSER = Boolean(process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH));

export async function waitUntil(fn, { timeout = 20000, every = 100 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, every));
  }
}
