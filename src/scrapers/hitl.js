// Human-in-the-loop (HITL): when a scraper hits a CAPTCHA, a login wall or anything that
// needs a person, it pauses and asks. The request shows up in the control panel (and in
// the DB, so it is visible from any computer); the run resumes when someone clicks Done.
import { db } from '../db/index.js';
import { currentUser } from '../auth/session.js';
import { machineInfo } from '../core/machine.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';
import { sleep } from '../core/utils.js';
import { ahk, IS_WINDOWS, findAutoHotkey } from '../core/commands.js';

const log = logger('hitl');
const waiting = new Map(); // id -> { resolve, reject, request }

export function openRequests() {
  return [...waiting.values()].map((w) => w.request);
}

async function bringToFront(page) {
  try {
    await page?.bringToFront?.();
    if (IS_WINDOWS && findAutoHotkey()) {
      // Flash attention: beep and restore the most recent browser window.
      await ahk('SoundBeep 750, 300\nif WinExist("ahk_exe chrome.exe") || WinExist("ahk_exe firefox.exe") || WinExist("ahk_exe camoufox.exe")\n  WinActivate', [], { quiet: true });
    }
  } catch {
    // focusing is best effort
  }
}

// Pauses until a person resolves the request. Resolves with the resolution text.
export async function requestHuman({ kind = 'captcha', message, url = null, runId = null, page = null, timeoutMs = 0 }) {
  const user = currentUser();
  const m = await machineInfo();
  const row = await db.insert('hitl_requests', {
    account_id: user?.id ?? 'local',
    run_id: runId,
    machine_id: m.machineId,
    kind,
    message,
    url,
    status: 'open',
  });
  const request = { ...row, deviceName: m.deviceName };
  log.warn(`Needs a human: ${message}`, { kind, url });
  emit('hitl.request', request);
  await bringToFront(page);

  const done = new Promise((resolve, reject) => waiting.set(row.id, { resolve, reject, request }));
  // Also watch the DB so the request can be resolved from another computer.
  let stop = false;
  const poll = (async () => {
    const until = timeoutMs ? Date.now() + timeoutMs : Infinity;
    while (!stop) {
      await sleep(5000);
      if (Date.now() > until) {
        cancel(row.id, 'Timed out waiting for a human');
        return;
      }
      const fresh = await db.get('hitl_requests', row.id).catch(() => null);
      if (fresh && fresh.status !== 'open' && waiting.has(row.id)) {
        const w = waiting.get(row.id);
        waiting.delete(row.id);
        if (fresh.status === 'resolved') w.resolve(fresh.resolution || 'done');
        else w.reject(new Error(fresh.resolution || 'Cancelled'));
        return;
      }
    }
  })();
  try {
    return await done;
  } finally {
    stop = true;
    void poll;
  }
}

export async function resolveRequest(id, resolution = 'done') {
  await db.update('hitl_requests', { id }, { status: 'resolved', resolution, resolved_at: new Date().toISOString() });
  const w = waiting.get(id);
  waiting.delete(id);
  w?.resolve(resolution);
  log.ok(`Human request resolved: ${resolution}`);
  emit('hitl.resolved', { id, resolution });
}

export function cancel(id, reason = 'Cancelled') {
  const w = waiting.get(id);
  waiting.delete(id);
  void db.update('hitl_requests', { id }, { status: 'cancelled', resolution: reason, resolved_at: new Date().toISOString() }).catch(() => {});
  w?.reject(new Error(reason));
  emit('hitl.resolved', { id, resolution: reason });
}

// Spots common bot challenges on the current page. Returns { kind, detail } or null.
export async function detectChallenge(page) {
  try {
    const frames = page.frames ? page.frames().map((f) => f.url()) : [];
    // Invisible reCAPTCHA (size=invisible) runs in the background on LinkedIn pages and shows
    // nothing to solve, so it is not a challenge. A real one shows up as a visible frame.
    const frameHit = frames.find((u) => /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|captcha-delivery|geo\.captcha/i.test(u) && !/[?&#]size=invisible\b/i.test(u));
    if (frameHit) return { kind: 'captcha', detail: new URL(frameHit).host };
    const url = typeof page.url === 'function' ? await page.url() : '';
    if (/\/checkpoint\/|\/challenge|captcha|\/authwall|\/uas\/login/i.test(url)) return { kind: 'challenge', detail: url };
    const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 5000));
    if (/verify you are human|are you a robot|unusual traffic|security check|let'?s do a quick security check|press and hold/i.test(text)) {
      return { kind: 'captcha', detail: 'page text' };
    }
  } catch {
    // pages that are navigating can throw; treat as no challenge
  }
  return null;
}
