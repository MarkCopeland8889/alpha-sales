import { HOME, HAS_BROWSER } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { addExtension, crxPublicKey, extensionIdFromBytes, setDefaultExtension, listExtensions } from '../src/extensions/index.js';
import { createProfile } from '../src/profiles/index.js';
import { openBrowser } from '../src/browsers/index.js';

const varint = (n) => {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
};
const field = (num, bytes) => Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes]);

// Builds a CRX3 file the way the Chrome Web Store serves one (signature is not checked here).
function makeCrx() {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pub = publicKey.export({ type: 'spki', format: 'der' });
  const crxId = crypto.createHash('sha256').update(pub).digest().subarray(0, 16);
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, pub), field(2, Buffer.alloc(256, 1))])),
    field(10000, field(1, crxId)),
  ]);
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ name: 'Store Ext', version: '1.2.3', manifest_version: 3, update_url: 'https://clients2.google.com/service/update2/crx' })));
  zip.addFile('_metadata/verified_contents.json', Buffer.from('[]'));
  const head = Buffer.alloc(12);
  head.write('Cr24', 0);
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(header.length, 8);
  return { buf: Buffer.concat([head, header, zip.toBuffer()]), id: extensionIdFromBytes(crxId), pub };
}

test('a Chrome Web Store .crx keeps its store id when unpacked', () => {
  const crx = makeCrx();
  assert.equal(crxPublicKey(crx.buf).id, crx.id);
  const file = path.join(HOME, 'store.crx');
  fs.writeFileSync(file, crx.buf);
  const ext = addExtension('chrome', file, 'Store');
  const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
  assert.equal(manifest.key, crx.pub.toString('base64'));
  assert.equal(extensionIdFromBytes(crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest()), crx.id);
  assert.ok(!fs.existsSync(path.join(ext.path, '_metadata')), 'Chrome refuses unpacked folders with _metadata');
});

test('default extensions are added to every new profile unless a list is given', () => {
  setDefaultExtension('chrome', 'Store', true);
  assert.equal(listExtensions().find((e) => e.name === 'Store').default, true);
  assert.deepEqual(createProfile({ browser: 'chrome', name: 'with-defaults' }).extensions, ['Store']);
  assert.deepEqual(createProfile({ browser: 'chrome', name: 'without', extensions: [] }).extensions, []);
  assert.deepEqual(createProfile({ browser: 'firefox', name: 'ff-defaults' }).extensions, []);
});

test('Chrome loads the unpacked store copy under its Web Store id', { skip: !HAS_BROWSER && 'no Chrome or Chromium available' }, async () => {
  const crx = makeCrx();
  const file = path.join(HOME, 'store2.crx');
  fs.writeFileSync(file, crx.buf);
  addExtension('chrome', file, 'Store2');
  createProfile({ browser: 'chrome', name: 'store-id', extensions: ['Store2'] });
  const session = await openBrowser({ browser: 'chrome', profile: 'store-id', headless: true });
  try {
    const page = await session.goto(`chrome-extension://${crx.id}/manifest.json`);
    assert.match(await page.evaluate(() => document.body.innerText), /Store Ext/);
  } finally {
    await session.close({ backup: false });
  }
});
