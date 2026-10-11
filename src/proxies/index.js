// Proxies: stored in the online DB (table "proxies"), tested, checked per website,
// and turned into something each browser can use.
//
// Browsers cannot all handle authenticated proxies (Chrome ignores user:pass in
// --proxy-server; Playwright cannot do SOCKS5 auth). So any proxy with credentials is
// fronted by a local forwarder (proxy-chain) on 127.0.0.1 that adds the credentials.
import { Server } from 'proxy-chain';
import { ProxyAgent, fetch } from 'undici';
import { db } from '../db/index.js';
import { PROXY_TYPES, SITE_STATUSES } from '../db/schema.js';
import { freePort } from '../core/utils.js';
import { logger } from '../core/logbook.js';

const log = logger('proxies');

export function toUrl(p, { withAuth = true } = {}) {
  const auth = withAuth && p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@` : '';
  return `${p.type}://${auth}${p.host}:${p.port}`;
}

export function describe(p) {
  return `${p.label ? `${p.label} ` : ''}${p.type}://${p.host}:${p.port}${p.username ? ' (auth)' : ''}`;
}

// Accepts "type://user:pass@host:port", "host:port:user:pass" or "host:port".
export function parseProxyString(line, defaultType = 'http') {
  const s = line.trim();
  if (!s) return null;
  if (s.includes('://')) {
    const u = new URL(s);
    return {
      type: u.protocol.replace(':', '').replace('socks5h', 'socks5'),
      host: u.hostname,
      port: Number(u.port),
      username: decodeURIComponent(u.username) || null,
      password: decodeURIComponent(u.password) || null,
    };
  }
  const [host, port, username, password] = s.split(':');
  return { type: defaultType, host, port: Number(port), username: username || null, password: password || null };
}

function validate(p) {
  if (!PROXY_TYPES.includes(p.type)) throw new Error(`Proxy type must be one of ${PROXY_TYPES.join(', ')}`);
  if (!p.host) throw new Error('Proxy host is required');
  if (!Number.isInteger(Number(p.port)) || Number(p.port) <= 0) throw new Error('Proxy port must be a number');
}

export async function listProxies(accountId) {
  const proxies = await db.select('proxies', { account_id: accountId }, { order: 'created_at' });
  const checks = await db.select('proxy_checks', { account_id: accountId }, { order: 'website' });
  return proxies.map((p) => ({ ...p, password: p.password ? '••••••' : null, hasPassword: Boolean(p.password), checks: checks.filter((c) => c.proxy_id === p.id) }));
}

export async function getProxy(accountId, id) {
  const p = await db.get('proxies', id);
  if (!p || p.account_id !== accountId) throw new Error('Proxy not found');
  return p;
}

export async function saveProxy(accountId, data) {
  const row = {
    label: data.label || null,
    type: data.type || 'http',
    host: String(data.host || '').trim(),
    port: Number(data.port),
    username: data.username || null,
    notes: data.notes || null,
  };
  // Keep the stored password when the form leaves it blank on edit.
  if (data.password) row.password = data.password;
  validate(row);
  if (data.id) {
    await getProxy(accountId, data.id);
    const [updated] = await db.update('proxies', { id: data.id, account_id: accountId }, row);
    return updated;
  }
  return db.insert('proxies', { account_id: accountId, password: data.password || null, ...row });
}

export async function importProxies(accountId, text, type = 'http') {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const p = parseProxyString(line, type);
    if (!p) continue;
    out.push(await saveProxy(accountId, p));
  }
  log.ok(`Imported ${out.length} proxies`);
  return out;
}

export async function deleteProxy(accountId, id) {
  await getProxy(accountId, id);
  await db.remove('proxy_checks', { proxy_id: id });
  await db.remove('proxies', { id, account_id: accountId });
}

// Starts a local HTTP proxy on 127.0.0.1 that forwards to the real (authenticated) proxy.
// Returns { server: 'http://127.0.0.1:PORT', close() }. Proxies without credentials pass through.
export async function startForwarder(p) {
  if (!p.username) return { server: toUrl(upstreamProxy(p), { withAuth: false }), direct: true, close: async () => {} };
  const port = await freePort();
  const server = new Server({ port, host: '127.0.0.1', verbose: false, prepareRequestFunction: () => ({ upstreamProxyUrl: upstreamUrl(p) }) });
  await server.listen();
  return {
    server: `http://127.0.0.1:${port}`,
    direct: false,
    close: () => server.close(true).catch(() => {}),
  };
}

// "https" in most proxy lists means an HTTP proxy that supports CONNECT, so it is dialled as http://.
const upstreamProxy = (p) => ({ ...p, type: p.type === 'https' ? 'http' : p.type });
const upstreamUrl = (p) => toUrl(upstreamProxy(p));

async function fetchThrough(p, url, { timeout = 20000 } = {}) {
  // Always go through a local forwarder: it handles credentials and SOCKS for undici.
  const port = await freePort();
  const server = new Server({ port, host: '127.0.0.1', verbose: false, prepareRequestFunction: () => ({ upstreamProxyUrl: upstreamUrl(p) }) });
  await server.listen();
  const dispatcher = new ProxyAgent(`http://127.0.0.1:${port}`);
  try {
    const started = Date.now();
    const res = await fetch(url, {
      dispatcher,
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    });
    const body = await res.text();
    // proxy-chain answers 590-599 when the upstream proxy fails (597 = wrong credentials).
    if (res.status >= 590 && res.status <= 599) {
      const err = new Error(`Proxy error ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${res.status === 597 ? ' (wrong username or password)' : ''}`);
      err.proxyFailure = true;
      throw err;
    }
    return { status: res.status, body, ms: Date.now() - started, url: res.url };
  } finally {
    await dispatcher.close().catch(() => {});
    await server.close(true).catch(() => {});
  }
}

// Connectivity test: exit IP + latency. Saves the result on the proxy row.
export async function testProxy(accountId, id) {
  const p = await getProxy(accountId, id);
  let result;
  try {
    const res = await fetchThrough(p, 'https://api.ipify.org?format=json');
    const ip = JSON.parse(res.body).ip;
    result = { ok: true, ip, ms: res.ms };
    log.ok(`Proxy ${describe(p)} works (${ip}, ${res.ms}ms)`);
  } catch (err) {
    result = { ok: false, error: err.cause?.message || err.message };
    log.warn(`Proxy ${describe(p)} failed`, { error: result.error });
  }
  await db.update('proxies', { id }, { status: result.ok ? 'working' : 'failed', last_ip: result.ip ?? null, last_checked: new Date().toISOString() });
  return result;
}

const CHALLENGE = /captcha|cf-chl|challenge-platform|are you a robot|unusual traffic|verify you are human|px-captcha|datadome|access denied/i;

// Website status check through a proxy: working / restricted / blocked + reason.
// This is a first pass over HTTP; scrapers refine it with reportSiteStatus() when a
// page loads but a specific function is unavailable.
export async function checkSites(accountId, id, websites) {
  const p = await getProxy(accountId, id);
  const results = [];
  for (const raw of websites) {
    const website = raw.trim().replace(/\/$/, '');
    if (!website) continue;
    const url = website.startsWith('http') ? website : `https://${website}`;
    let status;
    let reason;
    try {
      const res = await fetchThrough(p, url);
      if ([401, 403, 407, 429, 451].includes(res.status)) {
        status = 'blocked';
        reason = `HTTP ${res.status}${CHALLENGE.test(res.body) ? ' with a bot challenge' : ''}`;
      } else if (CHALLENGE.test(res.body)) {
        status = 'restricted';
        reason = `Loads (HTTP ${res.status}) but shows a CAPTCHA or bot challenge`;
      } else if (res.status >= 500) {
        status = 'restricted';
        reason = `Server error HTTP ${res.status}`;
      } else {
        status = 'working';
        reason = `HTTP ${res.status} in ${res.ms}ms`;
      }
    } catch (err) {
      status = 'blocked';
      reason = err.cause?.message || err.message;
    }
    results.push(await reportSiteStatus(accountId, id, website, status, reason));
  }
  return results;
}

export async function reportSiteStatus(accountId, proxyId, website, status, reason = null) {
  if (!SITE_STATUSES.includes(status)) throw new Error(`Status must be one of ${SITE_STATUSES.join(', ')}`);
  return db.upsert('proxy_checks', {
    account_id: accountId, proxy_id: proxyId, website, status, reason, checked_at: new Date().toISOString(),
  }, ['proxy_id', 'website']);
}
