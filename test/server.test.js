import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../src/server/index.js';
import { apiToken } from '../src/server/security.js';
import { freePort } from '../src/core/utils.js';
import { shutdown } from '../src/engine.js';

let server;
let port;
const call = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
    let text = '';
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text }));
  });
  req.on('error', reject);
  if (body) req.write(JSON.stringify(body));
  req.end();
});

test.before(async () => {
  port = await freePort();
  server = await startServer({ port, host: '127.0.0.1' });
});
test.after(async () => {
  server.close();
  await shutdown();
});

test('the control panel page is served', async () => {
  const r = await call('/');
  assert.equal(r.status, 200);
  assert.match(r.json, /Alpha-Sales/);
});

test('API calls need the control-panel token', async () => {
  assert.equal((await call('/api/status')).status, 401);
  assert.equal((await call('/api/status', { headers: { 'x-alpha-token': 'wrong' } })).status, 401);
  const ok = await call('/api/status', { headers: { 'x-alpha-token': apiToken() } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.dbMode, 'local');
  assert.equal(ok.json.user, null);
});

test('requests for other host names are refused (DNS rebinding)', async () => {
  const r = await call('/api/token', { headers: { host: 'evil.example:7300' } });
  assert.equal(r.status, 403);
});

test('signed-in endpoints refuse requests before login, then work after local login', async () => {
  const headers = { 'x-alpha-token': apiToken() };
  assert.equal((await call('/api/projects', { headers })).status, 401);
  const login = await call('/api/auth/local', { method: 'POST', headers, body: {} });
  assert.equal(login.status, 200);
  const saved = await call('/api/projects', { method: 'POST', headers, body: { name: 'Demo', variables: { business_name: 'Demo Co' } } });
  assert.equal(saved.status, 200);
  const list = await call('/api/projects', { headers });
  assert.equal(list.json.projects[0].name, 'Demo');
  const scrapers = await call('/api/scrapers', { headers });
  assert.ok(scrapers.json.some((s) => s.name === 'page-snapshot'));
  const ai = await call('/api/ai/complete', { method: 'POST', headers, body: { provider: 'mock', prompt: 'ping' } });
  assert.equal(ai.json.text, 'echo: ping');
});
