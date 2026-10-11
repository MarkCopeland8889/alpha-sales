// Anti-detect configurations, stored as small JSON files:
//   Configurations/Camoufox/<name>.json              Camoufox + VulpineOS launch options
//   Configurations/Invisible Playwright/<name>.json  { seed, pin, locale, timezone, ... }
//   Configurations/Chrome/<name>.json                extra Chrome flags, window, language
//   Configurations/Firefox/<name>.json               Firefox prefs, locale
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS, BROWSER_FOLDERS, safeName, readJson, writeJson, ensureDir } from '../core/paths.js';
import { logger } from '../core/logbook.js';

const log = logger('configs');

// VulpineOS is Camoufox-based, so it reads Camoufox configurations.
const FOLDER_FOR = { ...BROWSER_FOLDERS, vulpineos: BROWSER_FOLDERS.camoufox };

export const CONFIG_FIELDS = {
  camoufox: {
    os: 'windows | macos | linux, or a list to pick from',
    locale: 'e.g. "en-US" or ["en-US","en"]',
    humanize: 'true or max seconds for cursor movement',
    geoip: 'true = match timezone/locale/geolocation to the proxy IP',
    block_webrtc: 'true blocks WebRTC entirely',
    block_images: 'true blocks images (faster, less natural)',
    screen: '{ "maxWidth": 1920, "maxHeight": 1080 }',
    window: '[width, height]',
    fonts: 'extra font families',
    webgl_config: '["vendor", "renderer"]',
    firefox_user_prefs: 'extra Firefox prefs',
    config: 'raw Camoufox properties (overrides generated fingerprint values)',
  },
  invisible: {
    seed: 'integer; same seed = same fingerprint every run',
    pin: 'fingerprint fields to force, e.g. { "screen.width": 1920 }',
    locale: '"auto" or a BCP-47 tag',
    timezone: '"" (from egress IP) or an IANA zone',
    humanize: 'true/false or max seconds per movement',
    show_cursor: 'draw the pointer for people watching',
  },
  chrome: {
    args: 'extra command-line flags',
    locale: 'browser UI/Accept-Language, e.g. "en-US"',
    window: '[width, height]',
    launchMode: '"cdp" (default: real Chrome launched by us, attached over CDP) or "playwright"',
    stealthPlugin: 'true applies puppeteer-extra-plugin-stealth evasions (opt-in; can be outdated)',
  },
  firefox: {
    firefox_user_prefs: 'Firefox about:config prefs',
    locale: 'e.g. "en-US"',
    window: '[width, height]',
  },
};

function dirFor(browser) {
  const folder = FOLDER_FOR[browser];
  if (!folder) throw new Error(`Unknown browser ${browser}`);
  return ensureDir(path.join(PATHS.configurations, folder));
}

function fileFor(browser, name) {
  return path.join(dirFor(browser), `${safeName(name)}.json`);
}

export function listConfigs(browser) {
  const dir = dirFor(browser);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const data = readJson(path.join(dir, f), {});
      return { name: f.replace(/\.json$/, ''), browser, summary: summarize(browser, data), data };
    });
}

function summarize(browser, d) {
  if (browser === 'invisible') return `seed ${d.seed}${d.locale ? `, ${d.locale}` : ''}`;
  if (browser === 'chrome') return `${d.launchMode || 'cdp'}${d.args?.length ? `, ${d.args.length} flags` : ''}`;
  if (browser === 'camoufox' || browser === 'vulpineos') return [d.os, d.locale, d.geoip ? 'geoip' : null].flat().filter(Boolean).join(', ');
  return Object.keys(d).join(', ');
}

export function getConfig(browser, name) {
  if (!name) return {};
  if (typeof name === 'object') return name; // inline config object
  const data = readJson(fileFor(browser, name), null);
  if (!data) throw new Error(`Configuration "${name}" not found for ${browser}`);
  return data;
}

export function saveConfig(browser, name, data) {
  if (!name) throw new Error('A configuration needs a name');
  if (browser === 'invisible' && data.seed != null && !Number.isInteger(Number(data.seed))) throw new Error('Seed must be an integer');
  writeJson(fileFor(browser, name), data);
  log.ok(`Saved ${browser} configuration "${name}"`);
  return { name: safeName(name), browser, data };
}

export function deleteConfig(browser, name) {
  fs.rmSync(fileFor(browser, name), { force: true });
  log.ok(`Deleted ${browser} configuration "${name}"`);
}

const pick = (arr) => arr[crypto.randomInt(arr.length)];

// Random but coherent starting points. Camoufox and Invisible Playwright generate the
// detailed fingerprint themselves; these files only steer them.
export function generateConfig(browser, overrides = {}) {
  let data;
  switch (browser) {
    case 'invisible':
      data = { seed: crypto.randomInt(1, 2 ** 31 - 1), locale: 'auto', timezone: '', humanize: true, show_cursor: false };
      break;
    case 'camoufox':
    case 'vulpineos':
      data = {
        os: pick(['windows', 'windows', 'macos']),
        humanize: true,
        geoip: true,
        locale: 'en-US',
        screen: pick([{ maxWidth: 1920, maxHeight: 1080 }, { maxWidth: 1536, maxHeight: 864 }, { maxWidth: 2560, maxHeight: 1440 }]),
        block_webrtc: false,
      };
      break;
    case 'chrome':
      data = { launchMode: 'cdp', locale: 'en-US', window: pick([[1366, 768], [1440, 900], [1536, 864], [1920, 1080]]), args: [], stealthPlugin: false };
      break;
    case 'firefox':
      data = { locale: 'en-US', window: pick([[1366, 768], [1440, 900], [1920, 1080]]), firefox_user_prefs: {} };
      break;
    default:
      throw new Error(`Unknown browser ${browser}`);
  }
  return { ...data, ...overrides };
}
