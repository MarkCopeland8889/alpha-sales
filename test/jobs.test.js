import { HOME, HAS_BROWSER, waitUntil } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { localLogin } from '../src/auth/session.js';
import { onLogin, shutdown } from '../src/engine.js';
import { db } from '../src/db/index.js';
import { machineInfo } from '../src/core/machine.js';
import { appVersion } from '../src/core/version.js';
import { queueRun, stopRun } from '../src/jobs/queue.js';
import { saveJob, getRun } from '../src/jobs/index.js';
import { openRequests, resolveRequest } from '../src/scrapers/hitl.js';
import { createProfile } from '../src/profiles/index.js';
import { addExtension } from '../src/extensions/index.js';
import { openBrowser } from '../src/browsers/index.js';
import { saveGuardrails } from '../src/guardrails/index.js';
import { freePort } from '../src/core/utils.js';

let user;
const finished = (id) => waitUntil(async () => {
  const r = await db.get('job_runs', id);
  return ['completed', 'failed', 'stopped'].includes(r.status) ? r : null;
}, { timeout: 60000 });

test.before(async () => {
  user = await localLogin('tester');
  await onLogin(user);
});
test.after(() => shutdown());

test('login registers this computer with its version and status', async () => {
  const m = await machineInfo();
  const v = await appVersion();
  const [device] = await db.select('devices', { account_id: user.id, machine_id: m.machineId });
  assert.equal(device.app_version, v.full);
  assert.equal(device.status, 'available');
  assert.ok(device.last_heartbeat);
  const [account] = await db.select('accounts', { id: user.id });
  assert.ok(account.last_login);
});

test('a job runs its steps in order and passes values between them', async () => {
  const project = await db.insert('projects', { account_id: user.id, name: 'Acme', variables: { business_name: 'Acme Books' } });
  const job = await saveJob(user.id, {
    name: 'two prompts',
    project_id: project.id,
    definition: {
      steps: [
        { scraper: 'ai-prompt', input: { provider: 'mock', prompt: 'terms for {{business_name}}', saveAs: 'terms' } },
        { scraper: 'ai-prompt', input: { provider: 'mock', prompt: 'use {{terms}}', saveAs: 'final' } },
      ],
    },
  });
  const run = await queueRun(user.id, { jobId: job.id });
  const done = await finished(run.id);
  assert.equal(done.status, 'completed', done.error);
  assert.equal(done.result.steps.length, 2);
  assert.equal(done.result.steps[1].result.preview, 'echo: use echo: terms for Acme Books');
  const full = await getRun(user.id, run.id);
  assert.deepEqual(full.checkpoints.map((c) => c.name), ['answered', 'answered']);
  assert.ok(fs.existsSync(path.join(HOME, 'Logs', full.log_file)));
  assert.ok(fs.existsSync(path.join(HOME, 'Local Files', 'AI', 'two prompts', 'final.txt')));
});

test('a job that needs a browser is rejected without a profile', async () => {
  await assert.rejects(saveJob(user.id, { name: 'x', definition: { steps: [{ scraper: 'page-snapshot', input: {} }] } }), /browser and profile/);
});

test('a run waits for a human, then continues when someone clicks Done', async () => {
  const dir = path.join(HOME, 'Scrapers', 'needs-human');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'scraper.js'), `export default {
    name: 'needs-human', needsBrowser: false,
    async run(ctx) { const answer = await ctx.askHuman('Solve the puzzle'); return { answer }; },
  };`);
  const run = await queueRun(user.id, { spec: { name: 'hitl', steps: [{ scraper: 'needs-human' }] } });
  const req = await waitUntil(() => openRequests().find((r) => r.run_id === run.id));
  assert.equal((await db.get('job_runs', run.id)).status, 'waiting_human');
  await resolveRequest(req.id, 'solved it');
  const done = await finished(run.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.result.steps[0].result.answer, 'solved it');
});

test('a running job can be stopped', async () => {
  const dir = path.join(HOME, 'Scrapers', 'slow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'scraper.js'), `export default {
    name: 'slow', needsBrowser: false,
    async run(ctx) { await ctx.checkpoint('started'); for (;;) { ctx.throwIfStopped(); await new Promise((r) => setTimeout(r, 50)); } },
  };`);
  const run = await queueRun(user.id, { spec: { name: 'slow', steps: [{ scraper: 'slow' }] } });
  await waitUntil(async () => (await db.select('checkpoints', { run_id: run.id })).length);
  await stopRun(user.id, run.id);
  const done = await finished(run.id);
  assert.equal(done.status, 'stopped');
});

test('jobs are only delegated to computers on the same version that are online', async () => {
  const now = new Date().toISOString();
  await db.insert('devices', { account_id: user.id, machine_id: 'old-pc', device_name: 'Old PC', app_version: '0.0.1', status: 'available', last_heartbeat: now });
  const v = await appVersion();
  await db.insert('devices', { account_id: user.id, machine_id: 'server-1', device_name: 'Server', app_version: v.full, status: 'available', last_heartbeat: now });
  await db.insert('devices', { account_id: user.id, machine_id: 'gone', device_name: 'Gone', app_version: v.full, status: 'available', last_heartbeat: '2020-01-01T00:00:00Z' });
  const spec = { name: 'delegated', steps: [{ scraper: 'ai-prompt', input: { provider: 'mock', prompt: 'hi' } }] };
  await assert.rejects(queueRun(user.id, { spec, machineId: 'old-pc' }), /same version/);
  await assert.rejects(queueRun(user.id, { spec, machineId: 'gone' }), /offline/);
  const run = await queueRun(user.id, { spec, machineId: 'server-1' });
  assert.equal(run.machine_id, 'server-1');
  await new Promise((r) => setTimeout(r, 300));
  // This computer leaves it for the server to pick up.
  assert.equal((await db.get('job_runs', run.id)).status, 'queued');
});

test('the kill switch blocks new runs', async () => {
  saveGuardrails({ killSwitch: true });
  try {
    const run = await queueRun(user.id, { spec: { name: 'blocked', steps: [{ scraper: 'ai-prompt', input: { provider: 'mock', prompt: 'x' } }] } });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await db.get('job_runs', run.id)).status, 'queued');
  } finally {
    saveGuardrails({ killSwitch: false });
  }
});

test('Chrome opens a profile over CDP with an extension, and a scraper saves a snapshot', { skip: !HAS_BROWSER && 'no Chrome or Chromium available' }, async (t) => {
  const site = http.createServer((req, res) => res.end('<title>Test shop</title><h1>Hello</h1><a href="/about">About</a>'));
  const port = await freePort();
  await new Promise((r) => site.listen(port, '127.0.0.1', r));
  t.after(() => site.close());

  addExtension('chrome', path.join(import.meta.dirname, 'fixtures', 'ext-hello'), 'hello');
  createProfile({ browser: 'chrome', name: 'cdp-test', extensions: ['hello'] });

  // Direct session: the extension's content script runs in the real profile.
  const session = await openBrowser({ browser: 'chrome', profile: 'cdp-test', headless: true });
  try {
    assert.equal(session.info().engine, 'chrome-cdp');
    const page = await session.goto(`http://127.0.0.1:${port}/`);
    const attr = await waitUntil(() => page.evaluate(() => document.documentElement.getAttribute('data-alpha-hello')), { timeout: 10000 });
    assert.equal(attr, 'loaded');
    const pptr = await session.puppeteer();
    assert.ok((await pptr.pages()).length >= 1);
  } finally {
    await session.close({ backup: false });
  }

  // Same profile through a job.
  const job = await saveJob(user.id, {
    name: 'snapshot',
    definition: { browser: { browser: 'chrome', profile: 'cdp-test', headless: true }, steps: [{ scraper: 'page-snapshot', input: { url: `http://127.0.0.1:${port}/`, scrolls: 1 } }] },
  });
  const run = await queueRun(user.id, { jobId: job.id });
  const done = await finished(run.id);
  assert.equal(done.status, 'completed', done.error);
  const folder = path.join(HOME, 'Local Files', 'Snapshots', 'snapshot', `127.0.0.1 ${port}`);
  assert.ok(fs.existsSync(path.join(folder, 'screenshot.png')), folder);
  assert.match(fs.readFileSync(path.join(folder, 'page.txt'), 'utf8'), /Hello/);
});
