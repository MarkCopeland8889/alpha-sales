// Firefox-based browsers driven by Playwright's Juggler protocol:
//   firefox    Playwright's patched Firefox build, installed into Software/Firefox
//   camoufox   Camoufox (anti-detect Firefox), installed into Software/Camoufox
//   vulpineos  VulpineOS browser (Camoufox-based), same functions as Camoufox
import fs from 'node:fs';
import path from 'node:path';
import { firefox } from 'playwright-core';
import { config } from '../core/env.js';
import { SOFTWARE } from '../core/paths.js';
import { IS_WINDOWS, IS_MAC } from '../core/commands.js';
import { installXpisIntoProfile, firefoxAddonFolders } from '../extensions/index.js';

export function firefoxInstalled() {
  try {
    return fs.existsSync(firefox.executablePath());
  } catch {
    return false;
  }
}

export async function launchFirefox({ profilePath, proxyServer, cfg = {}, headless = false, extensions = [] }) {
  if (!firefoxInstalled()) throw new Error('Playwright Firefox is not installed. Use Software > Install Firefox.');
  const prefs = {
    ...installXpisIntoProfile(profilePath, extensions),
    ...(cfg.locale ? { 'intl.accept_languages': cfg.locale } : {}),
    ...(cfg.firefox_user_prefs || {}),
  };
  const context = await firefox.launchPersistentContext(profilePath, {
    headless,
    viewport: null,
    locale: cfg.locale,
    proxy: proxyServer ? { server: proxyServer } : undefined,
    firefoxUserPrefs: prefs,
    args: Array.isArray(cfg.window) ? [`--width=${cfg.window[0]}`, `--height=${cfg.window[1]}`] : [],
  });
  return { kind: 'playwright', engine: 'firefox', executable: firefox.executablePath(), context, browser: context.browser(), close: () => context.close() };
}

export function camoufoxExecutable() {
  const dir = process.env.CAMOUFOX_INSTALL_DIR;
  const names = IS_WINDOWS ? ['camoufox.exe'] : IS_MAC ? ['Camoufox.app/Contents/MacOS/camoufox'] : ['camoufox', 'camoufox-bin'];
  for (const n of names) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function vulpineExecutable() {
  if (config.vulpinePath) return fs.existsSync(config.vulpinePath) ? config.vulpinePath : null;
  const names = IS_WINDOWS
    ? ['vulpine.exe', 'camoufox.exe', 'browser/vulpine.exe']
    : IS_MAC ? ['Vulpine.app/Contents/MacOS/vulpine', 'Camoufox.app/Contents/MacOS/camoufox'] : ['vulpine', 'browser/vulpine', 'camoufox'];
  for (const n of names) {
    const p = path.join(SOFTWARE.vulpineos, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Camoufox and VulpineOS share the camoufox-js launcher; VulpineOS only swaps the binary.
async function launchCamoufoxLike({ profilePath, proxyServer, cfg = {}, headless = false, extensions = [], executable, engine }) {
  const { Camoufox } = await import('camoufox-js');
  const { name: _n, ...options } = cfg;
  const context = await Camoufox({
    ...options,
    headless,
    user_data_dir: profilePath,
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    // geoip needs a proxy to look up; without one it uses this computer's IP.
    ...(options.geoip === undefined ? { geoip: Boolean(proxyServer) } : {}),
    ...(extensions.length ? { addons: firefoxAddonFolders(extensions) } : {}),
    ...(executable ? { executable_path: executable } : {}),
  });
  return { kind: 'playwright', engine, executable: executable || camoufoxExecutable(), context, browser: context.browser(), close: () => context.close() };
}

export async function launchCamoufox(opts) {
  if (!camoufoxExecutable()) throw new Error('Camoufox is not installed. Use Software > Install Camoufox.');
  return launchCamoufoxLike({ ...opts, engine: 'camoufox' });
}

export async function launchVulpine(opts) {
  const exe = vulpineExecutable();
  if (!exe) throw new Error('VulpineOS browser was not found in Software/VulpineOS. Install it or set VULPINE_PATH.');
  return launchCamoufoxLike({ ...opts, executable: exe, engine: 'vulpineos' });
}
