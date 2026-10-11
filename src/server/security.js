// The control panel can run commands on this computer, so the API only answers:
//   - requests whose Host header is this machine (blocks DNS-rebinding attacks), and
//   - requests carrying the per-install token in the X-Alpha-Token header
//     (other websites open in your browser cannot read or send it).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDir } from '../core/paths.js';

const TOKEN_FILE = path.join(PATHS.state, 'api-token');

export function apiToken() {
  ensureDir(PATHS.state);
  if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString('hex'));
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function hostAllowed(req) {
  const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTS.has(host);
}

export function guard(req, res, next) {
  if (!hostAllowed(req)) return res.status(403).json({ error: 'Forbidden host' });
  if (req.path.startsWith('/api/') && req.path !== '/api/token') {
    const token = req.get('x-alpha-token');
    if (!token || token.length !== apiToken().length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(apiToken()))) {
      return res.status(401).json({ error: 'Missing or invalid control-panel token' });
    }
  }
  return next();
}
