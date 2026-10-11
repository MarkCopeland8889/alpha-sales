// LinkedIn browsing helpers shared by the Krypton readers: open a page (counted against the
// daily guardrail budget, CAPTCHA and login checks), click buttons found by their text, scroll.
//
// Krypton only reads. Every click goes through clickText(), which refuses any button whose
// text or label matches the "forbidden" pattern (apply, connect, message, follow, react, ...).
import * as dom from './dom.js';
import { selectors } from './selectors.js';
import { randInt, sleep } from '../../../core/utils.js';

export function createLinkedIn(ctx, settings) {
  const { page, log } = ctx;
  const sel = selectors();
  const scale = Math.max(0, Number(settings.delay_scale ?? 1));
  const forbidden = new RegExp(sel.patterns.forbidden, 'i');
  let tokens = 0;

  const pause = (min = 600, max = 1500) => sleep(Math.round(randInt(min, max) * scale));
  const evaluate = (fn, arg) => page.evaluate(fn, arg);
  const currentUrl = async () => page.url();

  // Basic controller: wait for the part of the page we need, then a short random pause.
  async function settle(waitFor = 'main') {
    await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => {});
    await pause(900, 2000);
  }

  async function visit(url, action, { waitFor = 'main' } = {}) {
    ctx.throwIfStopped();
    if (action) await ctx.action(action);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(waitFor);
    await ctx.guardCaptcha();
    let state = await evaluate(dom.pageState, sel);
    if (state.loginWall) {
      await ctx.askHuman('LinkedIn is asking to log in. Log in to LinkedIn in the open browser window, then click Done.', { url, kind: 'login' });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await settle(waitFor);
      await ctx.guardCaptcha();
      state = await evaluate(dom.pageState, sel);
      if (state.loginWall) {
        const err = new Error('Still not logged in to LinkedIn after the pause');
        err.fatal = true;
        throw err;
      }
    }
    return state;
  }

  // Finds a button by text/aria pattern, tags it, and clicks it with a real mouse click.
  // Returns what was clicked, or null when nothing matched.
  async function clickText(spec) {
    ctx.throwIfStopped();
    const token = `k${(tokens += 1)}`;
    const found = await evaluate(dom.markTarget, { ...spec, token, forbidden: sel.patterns.forbidden });
    if (!found) return null;
    if (forbidden.test(found.text) || forbidden.test(found.aria)) {
      log.warn(`Refused to click "${found.text || found.aria}" (Krypton only reads)`);
      return null;
    }
    await pause(300, 900);
    try {
      await page.click(`[data-alpha-target="${token}"]`, { timeout: 10000 });
    } catch (err) {
      log.warn(`Could not click "${found.text || found.aria}": ${err.message.split('\n')[0]}`);
      return null;
    }
    await pause(700, 1600);
    return found;
  }

  // Clicks every visible "see more" style button (about section, post text, job description).
  async function expandAll(scope, max = 15) {
    let n = 0;
    while (n < max && (await clickText({ scope, textPattern: sel.patterns.seeMore }))) n += 1;
    return n;
  }

  async function scrollDown(px) {
    const amount = px ?? randInt(500, 1000);
    if (page.mouse?.wheel) await page.mouse.wheel(0, amount).catch(() => evaluate((y) => window.scrollBy(0, y), amount));
    else await evaluate((y) => window.scrollBy(0, y), amount);
    await pause(500, 1200);
  }

  // Scrolls until the page stops growing (lazy-loaded sections), at most `rounds` times.
  async function scrollToEnd(rounds = 12) {
    let still = 0;
    let last = 0;
    for (let i = 0; i < rounds && still < 2; i += 1) {
      ctx.throwIfStopped();
      await scrollDown();
      const { height } = await evaluate(dom.scrollToBottom);
      await pause(600, 1400);
      still = height === last ? still + 1 : 0;
      last = height;
    }
  }

  async function closeDialog() {
    await page.keyboard.press('Escape').catch(() => {});
    await pause(400, 900);
  }

  return { page, sel, settings, base: settings.linkedin_base_url, log, pause, evaluate, currentUrl, settle, visit, clickText, expandAll, scrollDown, scrollToEnd, closeDialog };
}

// "3d", "2w", "1mo", "1yr", "5h", "3 days ago" -> age in days (null when unknown).
export function ageInDays(label) {
  const s = String(label || '').toLowerCase();
  if (!s) return null;
  if (/\bnow\b|\bjust\b/.test(s)) return 0;
  const iso = s.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return Math.max(0, (Date.now() - Date.parse(iso[0])) / 86400000);
  const m = s.match(/(\d+)\s*(mo|months?|yrs?|years?|y|w|wks?|weeks?|d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (/^mo|^month/.test(unit)) return n * 30;
  if (/^y/.test(unit)) return n * 365;
  if (/^w/.test(unit)) return n * 7;
  if (/^d/.test(unit)) return n;
  if (/^h/.test(unit)) return n / 24;
  return 0; // minutes / seconds
}
