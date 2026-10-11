// Browsers & sessions. One function opens any of the five browsers with a profile,
// an optional proxy and an optional anti-detect configuration:
//
//   const session = await openBrowser({ browser: 'chrome', profile: 'sales-1', proxyId, config: 'default' });
//   const page = await session.page();
//   await page.goto('https://example.com');
//   await session.close();
//
// Every open session is tracked (one per profile), shown in the UI, and the profile
// folder is backed up to Google Drive after the browser closes.
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_FOLDERS, PATHS, ensureDir, profileDir } from '../core/paths.js';
import { config as env } from '../core/env.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';
import { shortId, stamp, sleep } from '../core/utils.js';
import { getProfile, createProfile, updateProfile, acquireLock, releaseLock, readLock } from '../profiles/index.js';
import { getConfig } from '../configs/index.js';
import { getProxy, startForwarder, describe as describeProxy } from '../proxies/index.js';
import { launchChrome, findChrome, puppeteerFor, openChromeForSignIn } from './chrome.js';
import { launchFirefox, launchCamoufox, launchVulpine, firefoxInstalled, camoufoxExecutable, vulpineExecutable } from './firefox-family.js';
import { launchInvisible, venvPython } from './invisible.js';
import { pushFolder, status as syncStatus } from '../sync/rclone.js';
import { currentUser } from '../auth/session.js';

const log = logger('browsers');

export const BROWSER_INFO = {
  chrome: { label: 'Chrome', engine: 'Consumer Google Chrome over CDP', stealth: 'medium' },
  firefox: { label: 'Firefox', engine: 'Playwright Firefox (Juggler)', stealth: 'low' },
  camoufox: { label: 'Camoufox', engine: 'Anti-detect Firefox (C++ fingerprint spoofing)', stealth: 'high' },
  vulpineos: { label: 'VulpineOS', engine: 'Camoufox-based browser for AI agents', stealth: 'high' },
  invisible: { label: 'Invisible Playwright', engine: 'Patched Firefox via Python bridge', stealth: 'high' },
};

export function browserAvailability() {
  return {
    chrome: Boolean(findChrome()),
    firefox: firefoxInstalled(),
    camoufox: Boolean(camoufoxExecutable()),
    vulpineos: Boolean(vulpineExecutable()),
    invisible: Boolean(venvPython()),
  };
}

const sessions = new Map();

class BrowserSession {
  constructor({ id, browser, profile, launched, proxyLabel, configName, forwarder, controller }) {
    Object.assign(this, { id, browser, profile, launched, proxyLabel, configName, forwarder, controller });
    this.context = launched.context;
    this.startedAt = new Date().toISOString();
    this.closed = false;
    this.listeners = [];
  }

  get kind() { return this.launched.kind; }

  // The first open tab (creates one if none).
  async page() {
    const pages = this.context.pages();
    return pages[0] ?? this.context.newPage();
  }

  newPage() { return this.context.newPage(); }
  pages() { return this.context.pages(); }

  async goto(url, opts) {
    const page = await this.page();
    await page.goto(url, { waitUntil: 'domcontentloaded', ...opts });
    return page;
  }

  async screenshot(file) {
    const page = await this.page();
    const out = file || path.join(ensureDir(path.join(PATHS.logs, 'screens')), `${this.profile}_${stamp()}.png`);
    await page.screenshot({ path: out });
    return out;
  }

  cookies(urls) { return this.context.cookies(urls); }
  addCookies(list) { return this.context.addCookies(list); }

  // Saves cookies to a JSON file (e.g. Accounts/<Platform>/<user>/cookies.json).
  async exportCookies(file) {
    const list = await this.context.cookies();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
    log.ok(`Exported ${list.length} cookies`, { file });
    return list.length;
  }

  async importCookies(file) {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    await this.context.addCookies(list);
    log.ok(`Imported ${list.length} cookies`, { file });
    return list.length;
  }

  // Visits a list of sites to build natural history on a fresh profile.
  async warmHistory(urls, { dwellMs = [4000, 9000] } = {}) {
    const page = await this.page();
    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.mouse.wheel(0, 400 + Math.random() * 800);
        await page.waitForTimeout(dwellMs[0] + Math.random() * (dwellMs[1] - dwellMs[0]));
      } catch (err) {
        log.warn(`History warm-up could not open ${url}`, err);
      }
    }
  }

  // Puppeteer handle on the same Chrome (Chrome only).
  async puppeteer(opts) {
    if (!this.launched.cdpUrl) throw new Error('Puppeteer can only attach to Chrome sessions');
    this._puppeteer ||= await puppeteerFor(this.launched.cdpUrl, opts);
    return this._puppeteer;
  }

  info() {
    return {
      id: this.id,
      browser: this.browser,
      browserLabel: BROWSER_INFO[this.browser]?.label,
      profile: this.profile,
      engine: this.launched.engine,
      kind: this.kind,
      proxy: this.proxyLabel,
      config: this.configName,
      controller: this.controller,
      cdpUrl: this.launched.cdpUrl || null,
      seed: this.launched.seed ?? null,
      startedAt: this.startedAt,
      pages: this.context.pages().length,
    };
  }

  onClose(fn) { this.listeners.push(fn); }

  async close({ backup = true } = {}) {
    if (this.closed) return;
    this.closed = true;
    try {
      await this._puppeteer?.disconnect?.();
      await this.launched.close();
    } catch (err) {
      log.warn(`Error while closing ${this.profile}`, err);
    }
    await this.forwarder?.close();
    releaseLock(this.browser, this.profile);
    sessions.delete(this.id);
    log.ok(`Closed ${BROWSER_INFO[this.browser].label} profile "${this.profile}"`);
    emit('session.closed', { id: this.id });
    for (const fn of this.listeners) await Promise.resolve(fn()).catch(() => {});
    if (backup) void backupProfile(this.browser, this.profile);
  }
}

async function backupProfile(browser, profile) {
  try {
    if (!env.rcloneAutoSync || !currentUser()) return;
    const s = await syncStatus();
    if (!s.installed || !s.remoteConfigured) return;
    await pushFolder(profileDir(browser, profile));
  } catch (err) {
    log.warn(`Profile backup failed for ${profile}`, err);
  }
}

// Opens a browser. Options:
//   browser     chrome | firefox | camoufox | vulpineos | invisible
//   profile     profile name (created automatically if createIfMissing)
//   proxyId     a proxy from the DB (defaults to the profile's proxy); null = profile default, false = no proxy
//   config      configuration name or inline object (defaults to the profile's config)
//   extensions  extension names (defaults to the profile's list)
//   headless    run without a window
//   controller  basic | stealth | jev (informational; used by scrapers)
export async function openBrowser(opts) {
  const { browser, profile: profileName, createIfMissing = true, headless = false, controller = 'basic', startUrl } = opts;
  if (!BROWSER_INFO[browser]) throw new Error(`Unknown browser "${browser}"`);
  if (!profileName) throw new Error('A profile name is required');
  let profile = getProfile(browser, profileName);
  if (!profile) {
    if (!createIfMissing) throw new Error(`Profile "${profileName}" does not exist`);
    profile = createProfile({ browser, name: profileName });
  }

  const id = `s_${shortId()}`;
  // A run that just finished on this profile may still be closing its browser: wait for it.
  const until = Date.now() + (opts.lockWaitMs ?? 30000);
  while (readLock(browser, profile.name)?.pid === process.pid && Date.now() < until) await sleep(250);
  await acquireLock(browser, profile.name, id);
  let forwarder = null;
  try {
    // Proxy: explicit id, else the profile's saved proxy. false disables it.
    let proxy = null;
    const proxyId = opts.proxyId === false ? null : opts.proxyId || profile.proxyId;
    if (proxyId) {
      const user = currentUser();
      if (!user) throw new Error('Log in to use proxies from the database');
      proxy = await getProxy(user.id, proxyId);
    }
    const configName = opts.config ?? profile.config;
    const cfg = getConfig(browser, configName);
    const extensions = opts.extensions ?? profile.extensions ?? [];

    let proxyServer = null;
    if (proxy && browser !== 'invisible') {
      forwarder = await startForwarder(proxy);
      proxyServer = forwarder.server;
    }

    const common = { profilePath: profile.path, proxyServer, cfg, headless, extensions, startUrl: startUrl || profile.startUrl };
    let launched;
    switch (browser) {
      case 'chrome': launched = await launchChrome(common); break;
      case 'firefox': launched = await launchFirefox(common); break;
      case 'camoufox': launched = await launchCamoufox(common); break;
      case 'vulpineos': launched = await launchVulpine(common); break;
      case 'invisible': launched = await launchInvisible({ ...common, proxy }); break;
      default: throw new Error(`Unknown browser ${browser}`);
    }

    const session = new BrowserSession({
      id,
      browser,
      profile: profile.name,
      launched,
      proxyLabel: proxy ? describeProxy(proxy) : null,
      configName: typeof configName === 'string' ? configName : configName ? 'inline' : null,
      forwarder,
      controller,
    });
    sessions.set(id, session);
    updateProfile(browser, profile.name, { lastUsed: new Date().toISOString() });

    // If the user closes the window by hand, clean up the session.
    const onGone = () => { if (!session.closed) void session.close(); };
    launched.browser?.on?.('disconnected', onGone);
    launched.exited?.then(onGone);
    launched.context.on?.('close', onGone);

    const openUrl = startUrl || profile.startUrl;
    const firstPage = launched.context.pages?.()[0];
    if (openUrl && browser !== 'chrome' && firstPage) await firstPage.goto(openUrl).catch(() => {});

    log.ok(`Opened ${BROWSER_INFO[browser].label} profile "${profile.name}"`, { proxy: session.proxyLabel, config: session.configName, extensions });
    emit('session.opened', session.info());
    return session;
  } catch (err) {
    await forwarder?.close();
    releaseLock(browser, profile.name);
    log.fail(`Could not open ${BROWSER_INFO[browser].label} profile "${profile.name}"`, err);
    throw err;
  }
}

export function getSession(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('Browser session not found (it may have closed)');
  return s;
}

// Sign-in windows: plain Chrome on a profile, with no automation attached, so a person can
// log in where sites block automated browsers. They hold the profile lock until closed.
const signIns = new Map();

export async function openForSignIn({ browser, profile: profileName, urls = [], proxyId }) {
  if (browser !== 'chrome') throw new Error('Sign-in windows are available for Chrome profiles');
  const profile = getProfile(browser, profileName);
  if (!profile) throw new Error(`Profile "${profileName}" does not exist`);
  const id = `signin_${shortId()}`;
  await acquireLock(browser, profile.name, id);
  let forwarder = null;
  try {
    const pid = proxyId === false ? null : proxyId || profile.proxyId;
    if (pid) {
      const user = currentUser();
      if (!user) throw new Error('Log in to use proxies from the database');
      forwarder = await startForwarder(await getProxy(user.id, pid));
    }
    const list = urls.length ? urls : [profile.startUrl].filter(Boolean);
    const { child, exited } = openChromeForSignIn({ profilePath: profile.path, proxyServer: forwarder?.server, urls: list });
    const info = { id, browser, browserLabel: BROWSER_INFO[browser].label, profile: profile.name, engine: 'Chrome (sign-in, no automation)', signIn: true, proxy: null, startedAt: new Date().toISOString(), pages: list.length };
    signIns.set(id, { info, child });
    updateProfile(browser, profile.name, { lastUsed: info.startedAt });
    void exited.then(async () => {
      signIns.delete(id);
      await forwarder?.close();
      releaseLock(browser, profile.name);
      log.ok(`Closed the sign-in window for "${profile.name}"`);
      emit('session.closed', { id });
    });
    log.ok(`Opened "${profile.name}" in Chrome for sign-in (no automation)`, { urls: list });
    emit('session.opened', info);
    return info;
  } catch (err) {
    await forwarder?.close();
    releaseLock(browser, profile.name);
    throw err;
  }
}

export function listSessions() {
  return [...[...sessions.values()].map((s) => s.info()), ...[...signIns.values()].map((s) => s.info)];
}

export async function closeSession(id) {
  const signIn = signIns.get(id);
  if (signIn) {
    signIn.child.kill();
    return { closed: true };
  }
  return getSession(id).close();
}

export async function closeAllSessions() {
  for (const s of signIns.values()) s.child.kill();
  await Promise.all([...sessions.values()].map((s) => s.close()));
}

export function isProfileOpen(browser, profile) {
  return [...sessions.values(), ...[...signIns.values()].map((s) => s.info)].some((s) => s.browser === browser && s.profile === profile);
}

export { BROWSER_FOLDERS };
