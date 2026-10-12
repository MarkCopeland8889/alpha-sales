import { HOME } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createProfile, listProfiles, getProfile, updateProfile, deleteProfile, acquireLock, releaseLock } from '../src/profiles/index.js';
import { generateConfig, saveConfig, listConfigs, getConfig } from '../src/configs/index.js';
import { addExtension, listExtensions, chromeExtensionPaths, removeExtension } from '../src/extensions/index.js';
import { saveAccount, getAccount, listAccounts } from '../src/accounts/index.js';

test('profiles live in Profiles/<Browser>/<Profile> with their settings', () => {
  const p = createProfile({ browser: 'invisible', name: 'sales 1', startUrl: 'https://example.com' });
  assert.equal(p.path, path.join(HOME, 'Profiles', 'Invisible Playwright', 'sales 1'));
  assert.ok(fs.existsSync(path.join(p.path, 'alpha-profile.json')));
  assert.throws(() => createProfile({ browser: 'invisible', name: 'sales 1' }), /already exists/);
  assert.throws(() => createProfile({ browser: 'edge', name: 'x' }), /Unknown browser/);
  updateProfile('invisible', 'sales 1', { notes: 'warm', config: 'seed-a' });
  assert.equal(getProfile('invisible', 'sales 1').notes, 'warm');
  assert.equal(listProfiles('invisible').length, 1);
});

test('a profile can only be open once', async () => {
  createProfile({ browser: 'chrome', name: 'locked' });
  await acquireLock('chrome', 'locked', 's_1');
  await assert.rejects(acquireLock('chrome', 'locked', 's_2'), /already open/);
  await assert.rejects(deleteProfile('chrome', 'locked'), /Close this profile/);
  releaseLock('chrome', 'locked');
  await deleteProfile('chrome', 'locked');
  assert.equal(getProfile('chrome', 'locked'), null);
});

test('Invisible Playwright seeds and Camoufox configs are small JSON files', () => {
  const seed = generateConfig('invisible');
  assert.ok(Number.isInteger(seed.seed));
  saveConfig('invisible', 'seed-a', seed);
  assert.ok(fs.existsSync(path.join(HOME, 'Configurations', 'Invisible Playwright', 'seed-a.json')));
  assert.equal(getConfig('invisible', 'seed-a').seed, seed.seed);
  saveConfig('camoufox', 'win', generateConfig('camoufox', { os: 'windows' }));
  // VulpineOS reads Camoufox configurations.
  assert.equal(listConfigs('vulpineos')[0].name, 'win');
  assert.throws(() => saveConfig('invisible', 'bad', { seed: 'abc' }), /integer/);
});

test('extension copies are added and resolved for Chrome profiles', () => {
  const ext = addExtension('chrome', path.join(import.meta.dirname, 'fixtures', 'ext-hello'), 'hello');
  assert.equal(ext.title, 'Alpha Hello');
  assert.equal(listExtensions().length, 1);
  assert.deepEqual(chromeExtensionPaths(['hello']), [path.join(HOME, 'Software', 'Extension Copies', 'Chrome', 'hello')]);
  assert.throws(() => chromeExtensionPaths(['missing']), /not in Software/);
  removeExtension('chrome', 'hello');
  assert.equal(listExtensions().length, 0);
});

test('web and OAuth accounts are stored under Accounts/<Platform>/<username>', () => {
  saveAccount({ type: 'web', platform: 'LinkedIn', username: 'jane', password: 'pw', browser: 'chrome', profile: 'sales 1' });
  saveAccount({ type: 'oauth', platform: 'OpenAI', username: 'work', tool: 'codex' });
  assert.ok(fs.existsSync(path.join(HOME, 'Accounts', 'LinkedIn', 'jane', 'account.json')));
  const raw = JSON.parse(fs.readFileSync(path.join(HOME, 'Accounts', 'LinkedIn', 'jane', 'account.json'), 'utf8'));
  assert.match(raw.password, /^enc:v1:/);
  assert.equal(getAccount('LinkedIn', 'jane').password, undefined);
  assert.equal(getAccount('LinkedIn', 'jane', { withSecret: true }).password, 'pw');
  assert.equal(listAccounts().length, 2);
  assert.throws(() => saveAccount({ type: 'oauth', platform: 'X', username: 'y', tool: 'nope' }), /CLI tool/);
});

test('a sign-in window opens plain Chrome on the profile, with no automation, and holds the profile', async (t) => {
  const { openForSignIn, openBrowser, listSessions, closeSession, isProfileOpen } = await import('../src/browsers/index.js');
  const { readLock } = await import('../src/profiles/index.js');
  const { waitUntil } = await import('./helpers.js');
  // A stand-in Chrome that records its arguments and stays open until closed.
  const dir = fs.mkdtempSync(path.join(HOME, 'fake-chrome-'));
  const exe = path.join(dir, 'chrome');
  const argsFile = path.join(dir, 'args.txt');
  fs.writeFileSync(exe, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nexec sleep 30\n`, { mode: 0o755 });
  const before = process.env.CHROME_PATH;
  process.env.CHROME_PATH = exe;
  t.after(() => { process.env.CHROME_PATH = before; });

  const p = createProfile({ browser: 'chrome', name: 'sign-in test' });
  const info = await openForSignIn({ browser: 'chrome', profile: 'sign-in test', urls: ['https://www.linkedin.com/login', 'https://claude.ai/login'] });
  const args = (await waitUntil(() => fs.existsSync(argsFile) && fs.readFileSync(argsFile, 'utf8'))).trim().split('\n');
  assert.ok(args.includes(`--user-data-dir=${p.path}`));
  assert.deepEqual(args.slice(-2), ['https://www.linkedin.com/login', 'https://claude.ai/login']);
  assert.ok(!args.some((a) => /remote-debugging|enable-automation|extension-debugging/.test(a)), args.join(' '));

  assert.ok(listSessions().some((s) => s.id === info.id && s.signIn));
  assert.ok(isProfileOpen('chrome', 'sign-in test'));
  await assert.rejects(openBrowser({ browser: 'chrome', profile: 'sign-in test', lockWaitMs: 0 }), /sign-in window/);

  await closeSession(info.id);
  await waitUntil(() => !readLock('chrome', 'sign-in test'));
  assert.ok(!listSessions().some((s) => s.id === info.id));
});
