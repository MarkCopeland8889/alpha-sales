import net from 'node:net';
import crypto from 'node:crypto';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// A short human-like pause. Used between Playwright actions in "basic" controller mode.
export function jitter(baseMs = 400, spread = 0.6) {
  const delta = baseMs * spread;
  return sleep(Math.max(0, Math.round(baseMs - delta / 2 + Math.random() * delta)));
}

export function uid(prefix = '') {
  return `${prefix}${crypto.randomUUID()}`;
}

export function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

export function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export async function waitFor(check, { timeout = 30000, interval = 250, label = 'condition' } = {}) {
  const until = Date.now() + timeout;
  let lastErr;
  while (Date.now() < until) {
    try {
      const v = await check();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}

// AES-256-GCM helpers for secrets stored on disk (account passwords).
// The key comes from ALPHA_SECRET; without it values are stored as plain text.
export function encryptSecret(plain, passphrase) {
  if (!passphrase || plain == null || plain === '') return plain;
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `enc:v1:${Buffer.concat([salt, iv, cipher.getAuthTag(), data]).toString('base64')}`;
}

export function decryptSecret(value, passphrase) {
  if (typeof value !== 'string' || !value.startsWith('enc:v1:')) return value;
  if (!passphrase) throw new Error('ALPHA_SECRET is required to read this saved password');
  const raw = Buffer.from(value.slice(7), 'base64');
  const key = crypto.scryptSync(passphrase, raw.subarray(0, 16), 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(16, 28));
  decipher.setAuthTag(raw.subarray(28, 44));
  return Buffer.concat([decipher.update(raw.subarray(44)), decipher.final()]).toString('utf8');
}
