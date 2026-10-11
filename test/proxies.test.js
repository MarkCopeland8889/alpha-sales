import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from 'proxy-chain';
import { parseProxyString, saveProxy, listProxies, checkSites, importProxies, deleteProxy, startForwarder } from '../src/proxies/index.js';
import { freePort } from '../src/core/utils.js';

const ACC = 'acc-proxies';

test('proxy strings in common formats are parsed', () => {
  assert.deepEqual(parseProxyString('1.2.3.4:8080'), { type: 'http', host: '1.2.3.4', port: 8080, username: null, password: null });
  assert.deepEqual(parseProxyString('1.2.3.4:8080:u:p', 'socks5'), { type: 'socks5', host: '1.2.3.4', port: 8080, username: 'u', password: 'p' });
  assert.deepEqual(parseProxyString('socks5://u%40x:p@host:1080'), { type: 'socks5', host: 'host', port: 1080, username: 'u@x', password: 'p' });
  assert.equal(parseProxyString('   '), null);
});

test('authenticated proxies work through the local forwarder, and site checks are saved', async (t) => {
  // A website that is fine on / and shows a bot challenge on /challenge.
  const site = http.createServer((req, res) => {
    if (req.url === '/challenge') res.end('<div id="px-captcha">Please verify you are human</div>');
    else if (req.url === '/forbidden') { res.statusCode = 403; res.end('no'); } else res.end('<h1>hello</h1>');
  });
  const sitePort = await freePort();
  await new Promise((r) => site.listen(sitePort, '127.0.0.1', r));
  // An upstream proxy that requires user:pass.
  const upstreamPort = await freePort();
  let authed = 0;
  const upstream = new Server({
    port: upstreamPort,
    host: '127.0.0.1',
    prepareRequestFunction: ({ username, password }) => {
      if (username !== 'bob' || password !== 's3cret') return { requestAuthentication: true };
      authed += 1;
      return {};
    },
  });
  await upstream.listen();
  t.after(async () => { site.close(); await upstream.close(true); });

  const p = await saveProxy(ACC, { label: 'local', type: 'http', host: '127.0.0.1', port: upstreamPort, username: 'bob', password: 's3cret' });
  const base = `http://127.0.0.1:${sitePort}`;
  const results = await checkSites(ACC, p.id, [`${base}/`, `${base}/challenge`, `${base}/forbidden`]);
  assert.deepEqual(results.map((r) => r.status), ['working', 'restricted', 'blocked']);
  assert.ok(authed >= 3);

  const [listed] = await listProxies(ACC);
  assert.equal(listed.password, '••••••');
  assert.equal(listed.checks.length, 3);

  // Wrong password: the site check reports blocked with the proxy's reason.
  const bad = await saveProxy(ACC, { type: 'http', host: '127.0.0.1', port: upstreamPort, username: 'bob', password: 'nope' });
  const [r] = await checkSites(ACC, bad.id, [`${base}/`]);
  assert.equal(r.status, 'blocked');

  // The browser-facing forwarder needs no credentials of its own.
  const fwd = await startForwarder({ ...p, password: 's3cret' });
  assert.match(fwd.server, /^http:\/\/127\.0\.0\.1:\d+$/);
  await fwd.close();
});

test('proxy lists can be imported and deleted', async () => {
  const added = await importProxies('acc-import', 'a.example:1\nb.example:2:u:p\n\n', 'socks5');
  assert.equal(added.length, 2);
  assert.equal(added[1].type, 'socks5');
  await deleteProxy('acc-import', added[0].id);
  assert.equal((await listProxies('acc-import')).length, 1);
  await assert.rejects(deleteProxy('someone-else', added[1].id), /not found/);
});
