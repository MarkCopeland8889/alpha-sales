import { HOME } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { logger, recentLogs, RUN_FILE } from '../src/core/logbook.js';
import { safeName, ensureFolders, PATHS } from '../src/core/paths.js';
import { encryptSecret, decryptSecret } from '../src/core/utils.js';
import { localDb } from '../src/db/local.js';

test('folders are created under ALPHA_HOME', () => {
  ensureFolders();
  for (const f of ['Accounts', 'Configurations', 'Scrapers', 'Local Files', 'Logs', 'Software/Extension Copies/Chrome', 'Profiles/Chrome', 'Profiles/Invisible Playwright']) {
    assert.ok(fs.existsSync(path.join(HOME, f)), f);
  }
  assert.equal(PATHS.root, HOME);
});

test('log() writes simple and advanced entries with state icons to the run file', async () => {
  const log = logger('test');
  log.ok('all good');
  log.warn('careful', { detail: 1 });
  log.fail('broken', new Error('boom'));
  const lines = recentLogs({ scope: 'test' });
  assert.deepEqual(lines.map((l) => l.icon), ['✅', '⚠️', '❌']);
  assert.equal(lines[1].details.detail, 1);
  assert.equal(recentLogs({ scope: 'test', state: 'fail' }).length, 1);
  await new Promise((r) => setTimeout(r, 100));
  const text = fs.readFileSync(RUN_FILE, 'utf8');
  assert.match(text, /✅ \[test\] all good/);
  assert.match(text, /❌ \[test\] broken/);
  assert.match(text, /boom/);
  assert.ok(RUN_FILE.startsWith(path.join(HOME, 'Logs')));
});

test('safeName makes scraped names usable as file names', () => {
  assert.equal(safeName('a/b:c*?"<>|d'), 'a b c d');
  assert.equal(safeName('  CON  '), '_CON');
  assert.equal(safeName('Jane Doe.'), 'Jane Doe');
  assert.equal(safeName(''), 'untitled');
  assert.ok(safeName('x'.repeat(300)).length <= 80);
});

test('secrets round-trip and fail with the wrong passphrase', () => {
  const enc = encryptSecret('hunter2', 'pass');
  assert.match(enc, /^enc:v1:/);
  assert.equal(decryptSecret(enc, 'pass'), 'hunter2');
  assert.throws(() => decryptSecret(enc, 'wrong'));
});

test('local database: insert, select, update, upsert, remove', async () => {
  const a = await localDb.insert('projects', { account_id: 'u1', name: 'A' });
  await localDb.insert('projects', { account_id: 'u2', name: 'B' });
  assert.equal((await localDb.select('projects', { account_id: 'u1' })).length, 1);
  const [u] = await localDb.update('projects', { id: a.id, account_id: 'u1' }, { name: 'A2' });
  assert.equal(u.name, 'A2');
  assert.equal((await localDb.update('projects', { id: a.id, account_id: 'nope' }, { name: 'X' })).length, 0);
  await localDb.upsert('proxy_checks', { proxy_id: 'p', website: 'x.com', status: 'working' }, ['proxy_id', 'website']);
  await localDb.upsert('proxy_checks', { proxy_id: 'p', website: 'x.com', status: 'blocked' }, ['proxy_id', 'website']);
  const checks = await localDb.select('proxy_checks', { proxy_id: 'p' });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, 'blocked');
  await localDb.remove('projects', { id: a.id });
  assert.equal(await localDb.get('projects', a.id), null);
});
