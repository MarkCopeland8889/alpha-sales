// Invisible Playwright: a C++-patched anti-detect Firefox whose driver only ships for
// Python. Alpha-Sales runs it through bridges/invisible_bridge.py in its own venv
// (Software/Invisible-Playwright/venv) and exposes a Playwright-like page object, so
// scrapers use the same calls (page.goto, page.click, page.fill, ...).
// It always uses persistent mode: profile_dir = Profiles/Invisible Playwright/<profile>.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { PATHS, SOFTWARE } from '../core/paths.js';
import { IS_WINDOWS } from '../core/commands.js';
import { logger } from '../core/logbook.js';
import { installXpisIntoProfile } from '../extensions/index.js';

const log = logger('browsers:invisible');

export function venvPython() {
  const p = IS_WINDOWS
    ? path.join(SOFTWARE.invisible, 'venv', 'Scripts', 'python.exe')
    : path.join(SOFTWARE.invisible, 'venv', 'bin', 'python');
  return fs.existsSync(p) ? p : null;
}

class Bridge {
  constructor(python) {
    this.child = spawn(python, ['-u', path.join(PATHS.bridges, 'invisible_bridge.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    });
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-6000); });
    this.exited = new Promise((r) => this.child.once('exit', (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`Invisible Playwright bridge exited (${code}): ${this.stderr.slice(-800)}`));
      this.pending.clear();
      r(code);
    }));
  }

  call(method, params = {}, timeout = 180000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Invisible Playwright call ${method} timed out`));
      }, timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
}

// Playwright-like page backed by the Python bridge.
export class RemotePage {
  constructor(bridge, id) {
    this.bridge = bridge;
    this.id = id;
    const op = (name) => (args) => this.op(name, args);
    this.mouse = {
      move: (x, y) => op('mouse_move')({ x, y }),
      click: (x, y) => op('mouse_click')({ x, y }),
      wheel: (dx, dy) => op('mouse_wheel')({ dx, dy }),
    };
    this.keyboard = {
      press: (key) => op('keyboard_press')({ key }),
      type: (text, o = {}) => op('keyboard_type')({ text, delay: o.delay }),
    };
  }

  op(name, args = {}) {
    return this.bridge.call('page', { page: this.id, op: name, args });
  }

  goto(url, o = {}) { return this.op('goto', { url, waitUntil: o.waitUntil, timeout: o.timeout }); }
  click(selector, o = {}) { return this.op('click', { selector, timeout: o.timeout }); }
  dblclick(selector, o = {}) { return this.op('dblclick', { selector, timeout: o.timeout }); }
  hover(selector, o = {}) { return this.op('hover', { selector, timeout: o.timeout }); }
  fill(selector, value, o = {}) { return this.op('fill', { selector, value, timeout: o.timeout }); }
  type(selector, text, o = {}) { return this.op('type', { selector, text, delay: o.delay }); }
  press(selector, key) { return this.op('press', { selector, key }); }
  check(selector) { return this.op('check', { selector }); }
  selectOption(selector, value) { return this.op('select_option', { selector, value }); }
  setInputFiles(selector, files) { return this.op('set_input_files', { selector, files }); }
  waitForSelector(selector, o = {}) { return this.op('wait_for_selector', { selector, state: o.state, timeout: o.timeout }); }
  waitForTimeout(ms) { return this.op('wait_for_timeout', { ms }); }
  waitForLoadState(state = 'load', o = {}) { return this.op('wait_for_load_state', { state, timeout: o.timeout }); }
  waitForURL(url, o = {}) { return this.op('wait_for_url', { url, timeout: o.timeout }); }
  evaluate(fn, arg) {
    const expression = typeof fn === 'function' ? fn.toString() : fn;
    return this.op('evaluate', { expression, arg });
  }
  content() { return this.op('content'); }
  title() { return this.op('title'); }
  // Note: async here (Playwright's page.url() is sync).
  url() { return this.op('url'); }
  async screenshot(o = {}) {
    const file = o.path || path.join(PATHS.state, `shot-${Date.now()}.png`);
    await this.op('screenshot', { path: file, fullPage: o.fullPage });
    return o.path ? file : fs.readFileSync(file);
  }
  innerText(selector) { return this.op('inner_text', { selector }); }
  textContent(selector) { return this.op('text_content', { selector }); }
  getAttribute(selector, name) { return this.op('get_attribute', { selector, name }); }
  isVisible(selector) { return this.op('is_visible', { selector }); }
  count(selector) { return this.op('count', { selector }); }
  allInnerTexts(selector) { return this.op('all_inner_texts', { selector }); }
  bringToFront() { return this.op('bring_to_front'); }
  close() { return this.op('close_page'); }
}

class RemoteContext {
  constructor(bridge, pageIds) {
    this.bridge = bridge;
    this._pages = pageIds.map((id) => new RemotePage(bridge, id));
  }

  pages() { return this._pages; }

  async newPage() {
    const id = await this.bridge.call('new_page');
    const page = new RemotePage(this.bridge, id);
    this._pages.push(page);
    return page;
  }

  cookies(urls = []) { return this.bridge.call('cookies', { urls }); }
  addCookies(cookies) { return this.bridge.call('add_cookies', { cookies }); }
}

export async function launchInvisible({ profilePath, proxy, cfg = {}, headless = false, extensions = [] }) {
  const python = venvPython();
  if (!python) throw new Error('Invisible Playwright is not installed. Use Software > Install Invisible Playwright.');
  const bridge = new Bridge(python);
  const extraPrefs = { ...installXpisIntoProfile(profilePath, extensions), ...(cfg.extra_prefs || {}) };
  try {
    const res = await bridge.call('launch', {
      seed: cfg.seed ?? null,
      pin: cfg.pin ?? null,
      headless,
      // Invisible Playwright handles authenticated SOCKS/HTTP proxies natively.
      proxy: proxy ? { server: `${proxy.type}://${proxy.host}:${proxy.port}`, ...(proxy.username ? { username: proxy.username, password: proxy.password ?? '' } : {}) } : null,
      humanize: cfg.humanize ?? true,
      locale: cfg.locale ?? 'auto',
      timezone: cfg.timezone ?? '',
      show_cursor: cfg.show_cursor ?? null,
      extra_prefs: Object.keys(extraPrefs).length ? extraPrefs : null,
      profile_dir: profilePath,
    }, 300000);
    log.ok(`Invisible Playwright started (seed ${res.seed})`);
    const context = new RemoteContext(bridge, res.pages);
    return {
      kind: 'bridge',
      engine: 'invisible',
      seed: res.seed,
      context,
      close: async () => {
        await bridge.call('close', {}, 30000).catch(() => {});
        await Promise.race([bridge.exited, new Promise((r) => setTimeout(r, 5000))]);
        if (bridge.child.exitCode == null) bridge.child.kill();
      },
    };
  } catch (err) {
    bridge.child.kill();
    throw err;
  }
}
