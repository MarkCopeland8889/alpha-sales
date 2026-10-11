// Consumer Google Chrome (not Chromium).
//
// The workaround: Playwright's own launcher adds automation flags, and branded Chrome
// (since v137) ignores --load-extension. So Alpha-Sales starts the real chrome.exe itself
// with a profile folder and a DevTools port, then attaches Playwright over CDP.
// Extensions are loaded through the DevTools *pipe* with Extensions.loadUnpacked, which
// branded Chrome still allows when started with --enable-unsafe-extension-debugging.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config } from '../core/env.js';
import { SOFTWARE } from '../core/paths.js';
import { IS_WINDOWS, IS_MAC } from '../core/commands.js';
import { freePort, waitFor, sleep } from '../core/utils.js';
import { logger } from '../core/logbook.js';
import { chromeExtensionPaths } from '../extensions/index.js';

const log = logger('browsers:chrome');

export function chromeCandidates() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  if (IS_WINDOWS) {
    return [
      path.join(SOFTWARE.chrome, 'Chrome-bin', 'chrome.exe'),
      path.join(SOFTWARE.chrome, 'Application', 'chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
  }
  if (IS_MAC) {
    return [
      path.join(SOFTWARE.chrome, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
  }
  return [
    path.join(SOFTWARE.chrome, 'opt', 'google', 'chrome', 'chrome'),
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ];
}

// Prefers the copy inside Software/Chrome, then a system install. CHROME_PATH overrides both.
export function findChrome() {
  if (config.chromePath) return fs.existsSync(config.chromePath) ? config.chromePath : null;
  return chromeCandidates().find((p) => fs.existsSync(p)) || null;
}

export function isInRepo(exe) {
  return Boolean(exe) && path.resolve(exe).startsWith(path.resolve(SOFTWARE.chrome));
}

// Minimal DevTools-over-pipe client (fd 3 = to Chrome, fd 4 = from Chrome, messages end in \0).
class PipeClient {
  constructor(child) {
    this.out = child.stdio[3];
    this.in = child.stdio[4];
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.in.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\0')) >= 0) {
        const msg = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        this.handle(msg);
      }
    });
    this.in.on('error', () => {});
    this.out.on('error', () => {});
  }

  handle(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const p = msg.id != null && this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  }

  send(method, params = {}, timeout = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools pipe call ${method} timed out`));
      }, timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.out.write(`${JSON.stringify({ id, method, params })}\0`);
    });
  }
}

function buildArgs({ profilePath, port, proxyServer, cfg, headless, usePipe, startUrl }) {
  const args = [
    `--user-data-dir=${profilePath}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
  ];
  if (usePipe) args.push('--remote-debugging-pipe', '--enable-unsafe-extension-debugging');
  if (cfg.locale) args.push(`--lang=${cfg.locale}`);
  if (Array.isArray(cfg.window)) args.push(`--window-size=${cfg.window[0]},${cfg.window[1]}`);
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`, '--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  }
  if (headless) args.push('--headless=new');
  if (process.platform === 'linux') {
    args.push('--password-store=basic');
    if (process.getuid?.() === 0) args.push('--no-sandbox');
  }
  args.push(...(cfg.args || []));
  args.push(startUrl || 'about:blank');
  return args;
}

// Turns on Developer mode in the profile so unpacked extensions stay enabled.
function enableDeveloperMode(profilePath) {
  const prefFile = path.join(profilePath, 'Default', 'Preferences');
  try {
    fs.mkdirSync(path.dirname(prefFile), { recursive: true });
    const prefs = fs.existsSync(prefFile) ? JSON.parse(fs.readFileSync(prefFile, 'utf8')) : {};
    prefs.extensions ||= {};
    prefs.extensions.ui ||= {};
    if (prefs.extensions.ui.developer_mode === true) return;
    prefs.extensions.ui.developer_mode = true;
    fs.writeFileSync(prefFile, JSON.stringify(prefs));
  } catch (err) {
    log.warn('Could not enable developer mode in the profile', err);
  }
}

export async function launchChrome({ profilePath, proxyServer, cfg = {}, headless = false, extensions = [], startUrl }) {
  const exe = findChrome();
  if (!exe) throw new Error('Google Chrome was not found. Use Software > Install Chrome, or set CHROME_PATH.');
  if (/chromium/i.test(exe)) log.warn('CHROME_PATH points at Chromium; Alpha-Sales expects consumer Google Chrome', { exe });

  if ((cfg.launchMode || 'cdp') === 'playwright') return launchViaPlaywright({ exe, profilePath, proxyServer, cfg, headless, extensions });

  const extPaths = chromeExtensionPaths(extensions);
  const usePipe = extPaths.length > 0;
  if (usePipe) enableDeveloperMode(profilePath);
  const port = await freePort();
  const args = buildArgs({ profilePath, port, proxyServer, cfg, headless, usePipe, startUrl });
  const child = spawn(exe, args, {
    stdio: usePipe ? ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  child.stdout.on('data', () => {});
  const exited = new Promise((r) => child.once('exit', r));

  const endpoint = `http://127.0.0.1:${port}`;
  try {
    await waitFor(async () => {
      if (child.exitCode != null) throw new Error(`Chrome exited (${child.exitCode}): ${stderr.slice(-800)}`);
      const res = await fetch(`${endpoint}/json/version`);
      return res.ok;
    }, { timeout: 30000, label: 'Chrome DevTools endpoint' });
  } catch (err) {
    child.kill();
    throw err;
  }

  let pipe = null;
  if (usePipe) {
    pipe = new PipeClient(child);
    for (const p of extPaths) {
      try {
        const res = await pipe.send('Extensions.loadUnpacked', { path: p });
        log.ok(`Loaded extension ${path.basename(p)} (${res?.id})`);
      } catch (err) {
        log.warn(`Chrome refused extension ${path.basename(p)}`, err);
      }
    }
  }

  const driver = cfg.stealthPlugin ? await stealthChromium() : chromium;
  const browser = await driver.connectOverCDP(endpoint);
  const context = browser.contexts()[0] ?? (await browser.newContext());

  async function close() {
    try {
      if (pipe) await pipe.send('Browser.close', {}, 5000).catch(() => {});
      else {
        const s = await browser.newBrowserCDPSession();
        await s.send('Browser.close').catch(() => {});
      }
    } catch {
      // fall through to kill
    }
    const done = await Promise.race([exited.then(() => true), sleep(10000).then(() => false)]);
    if (!done) child.kill();
    await browser.close().catch(() => {});
  }

  return {
    kind: 'playwright',
    engine: 'chrome-cdp',
    executable: exe,
    cdpUrl: endpoint,
    browser,
    context,
    process: child,
    exited,
    close,
  };
}

async function stealthChromium() {
  const { chromium: extra } = await import('playwright-extra');
  const { default: stealth } = await import('puppeteer-extra-plugin-stealth');
  extra.use(stealth());
  return extra;
}

// Alternative: let Playwright start Chrome (simpler, but adds automation traces).
async function launchViaPlaywright({ exe, profilePath, proxyServer, cfg, headless, extensions }) {
  if (extensions.length) log.warn('Extensions are not loaded in "playwright" launch mode; use launchMode "cdp"');
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: exe,
    headless,
    viewport: null,
    locale: cfg.locale,
    proxy: proxyServer ? { server: proxyServer } : undefined,
    args: [...(Array.isArray(cfg.window) ? [`--window-size=${cfg.window[0]},${cfg.window[1]}`] : []), ...(cfg.args || [])],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  return { kind: 'playwright', engine: 'chrome-playwright', executable: exe, context, browser: context.browser(), close: () => context.close() };
}

// Connects Puppeteer (with the stealth plugin) to a running Chrome session.
export async function puppeteerFor(cdpUrl, { stealth = true } = {}) {
  const { default: puppeteer } = await import('puppeteer-extra');
  if (stealth) {
    const { default: plugin } = await import('puppeteer-extra-plugin-stealth');
    puppeteer.use(plugin());
  }
  return puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null });
}
