import { api, h, card, pageHeader, button, action, badge, table, timeAgo, formModal, modal, confirmBox, toast, tabs, pre, form } from '../lib.js';

const SITE_TONE = { working: 'ok', restricted: 'warn', blocked: 'fail' };
const proxyName = (p) => p.label || `${p.type}://${p.host}:${p.port}`;

// ---- Profiles & sessions -----------------------------------------------------------------
export async function profiles(root, ctx) {
  const [{ info, available, folders }, list, sessions, proxies, exts] = await Promise.all([
    api.get('/browsers'), api.get('/profiles'), api.get('/sessions'), api.get('/proxies'), api.get('/extensions'),
  ]);
  const configsByBrowser = Object.fromEntries(await Promise.all(Object.keys(info).map(async (b) => [b, await api.get(`/configs/${b}`)])));
  const proxyOptions = [['', 'No proxy'], ...proxies.map((p) => [p.id, proxyName(p)])];
  const extOptions = (browser) => exts.filter((e) => e.kind === (browser === 'chrome' ? 'chrome' : 'firefox')).map((e) => [e.name, `${e.title} ${e.version}`]);
  const configOptions = (browser) => [['', 'None (defaults)'], ...configsByBrowser[browser].map((c) => [c.name, `${c.name} · ${c.summary}`])];

  const fieldsFor = (browser, isNew) => [
    ...(isNew ? [{ name: 'name', label: 'Profile name', required: true, placeholder: 'e.g. sales-1' }] : []),
    { name: 'proxyId', label: 'Proxy', type: 'select', options: proxyOptions },
    { name: 'config', label: 'Configuration', type: 'select', options: configOptions(browser) },
    { name: 'startUrl', label: 'Start page', placeholder: 'https://…' },
    { name: 'extensions', label: 'Extensions', type: 'multi', options: extOptions(browser), help: extOptions(browser).length ? null : 'Add extension copies on the Extensions page.' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  const clean = (v) => ({ ...v, proxyId: v.proxyId || null, config: v.config || null });

  const create = () => {
    const pick = form([{ name: 'browser', label: 'Browser', type: 'select', options: Object.entries(info).map(([k, v]) => [k, `${v.label}${available[k] ? '' : ' (not installed)'}`]) }], { browser: 'chrome' });
    modal({
      title: 'New profile',
      body: h('div', {}, pick.el, h('p', { class: 'muted' }, 'Each profile is its own browser data folder under Profiles/<Browser>/<Profile>, with its own cookies, history and logins.')),
      actions: [{ label: 'Next', kind: 'primary', onClick: () => {
        const { browser } = pick.values();
        setTimeout(() => formModal(`New ${info[browser].label} profile`, fieldsFor(browser, true), {}, async (v) => {
          await api.post('/profiles', { browser, ...clean(v) });
          ctx.refresh();
        }), 0);
      } }],
    });
  };

  const edit = (p) => formModal(`${info[p.browser].label} · ${p.name}`, fieldsFor(p.browser, false), { ...p, proxyId: p.proxyId || '', config: p.config || '' }, async (v) => {
    await api.patch(`/profiles/${p.browser}/${encodeURIComponent(p.name)}`, clean(v));
    ctx.refresh();
  });

  const open = (p) => formModal(`Open ${p.name}`, [
    { name: 'proxyId', label: 'Proxy for this session', type: 'select', options: [['', `Profile default${p.proxyId ? '' : ' (none)'}`], ['none', 'No proxy'], ...proxies.map((x) => [x.id, proxyName(x)])] },
    { name: 'startUrl', label: 'Open URL', value: p.startUrl || '' },
    { name: 'headless', label: 'Headless (no window)', type: 'checkbox' },
  ], {}, async (v) => {
    const body = { startUrl: v.startUrl || undefined, headless: v.headless };
    if (v.proxyId === 'none') body.proxyId = false;
    else if (v.proxyId) body.proxyId = v.proxyId;
    await api.post(`/profiles/${p.browser}/${encodeURIComponent(p.name)}/open`, body);
    ctx.refresh();
  }, { submit: 'Open browser', success: 'Browser opened' });

  const shot = action(async (s) => {
    const blob = await api.get(`/sessions/${s.id}/screenshot`);
    const url = URL.createObjectURL(blob);
    modal({ title: `${s.browserLabel} · ${s.profile}`, wide: true, body: h('img', { src: url, style: { width: '100%', borderRadius: '8px' } }) });
  });

  root.append(
    pageHeader('Profiles & sessions', 'Open any profile in Chrome (your installed Google Chrome, not Chromium), Firefox, Camoufox, VulpineOS or Invisible Playwright, with an optional proxy and configuration.',
      button('New profile', create, { kind: 'primary' })),
    h('div', { class: 'row', style: { marginBottom: '14px' } }, Object.entries(info).map(([k, v]) => badge(`${v.label}: ${available[k] ? 'ready' : 'not installed'}`, available[k] ? 'ok' : 'warn'))),
    card('Open browsers', table([
      { label: 'Profile', render: (s) => h('div', {}, h('strong', {}, s.profile), h('div', { class: 'muted' }, `${s.browserLabel} · ${s.engine}`)) },
      { label: 'Proxy', render: (s) => s.proxy || 'none' },
      { label: 'Config', render: (s) => s.config || (s.seed != null ? `seed ${s.seed}` : 'default') },
      { label: 'Debug URL', render: (s) => (s.cdpUrl ? h('code', {}, s.cdpUrl) : '') },
      { label: 'Opened', render: (s) => timeAgo(s.startedAt) },
      { label: '', render: (s) => h('div', { class: 'row' },
        button('Go to…', () => formModal('Navigate', [{ name: 'url', label: 'URL', required: true }], {}, async (v) => { await api.post(`/sessions/${s.id}/goto`, v); }, { submit: 'Go', success: 'Loaded' }), { small: true }),
        button('Screenshot', () => shot(s), { small: true }),
        button('Export cookies', action(async () => {
          const r = await api.post(`/sessions/${s.id}/cookies/export`);
          toast(`Saved ${r.count} cookies to ${r.file}`);
        }), { small: true }),
        button('Close', action(async () => { await api.post(`/sessions/${s.id}/close`); ctx.refresh(); }), { small: true, kind: 'danger' })) },
    ], sessions, { emptyText: 'No browsers open. Open a profile below.' })),
    card('Profiles', table([
      { label: 'Profile', render: (p) => h('div', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, `${folders[p.browser]}${p.notes ? ` · ${p.notes}` : ''}`)) },
      { label: 'Proxy', render: (p) => (p.proxyId ? proxyName(proxies.find((x) => x.id === p.proxyId) || { label: 'missing proxy' }) : 'none') },
      { label: 'Config', render: (p) => p.config || 'default' },
      { label: 'Extensions', render: (p) => (p.extensions?.length ? p.extensions.map((e) => badge(e)) : 'none') },
      { label: 'Last used', render: (p) => timeAgo(p.lastUsed) },
      { label: '', render: (p) => h('div', { class: 'row' },
        p.locked ? badge('open', 'info')
          : button('Open', () => open(p), { small: true, kind: 'primary' }),
        button('Edit', () => edit(p), { small: true }),
        button('Delete', action(async () => {
          if (!(await confirmBox(`Delete the ${info[p.browser].label} profile "${p.name}"? Its folder is archived to Google Drive first when sync is connected.`))) return;
          await api.del(`/profiles/${p.browser}/${encodeURIComponent(p.name)}`);
          ctx.refresh();
        }), { small: true, kind: 'danger' })) },
    ], list, { emptyText: 'No profiles yet.' })),
  );
  ctx.on((e) => { if (e.type === 'session.opened' || e.type === 'session.closed') ctx.refresh(); });
}

// ---- Proxies -----------------------------------------------------------------------------
export async function proxies(root, ctx) {
  const list = await api.get('/proxies');
  const types = ['http', 'https', 'socks5', 'socks4'];
  const edit = (p = {}) => formModal(p.id ? `Edit ${proxyName(p)}` : 'Add proxy', [
    { name: 'label', label: 'Label', placeholder: 'e.g. US residential 1' },
    { name: 'type', label: 'Type', type: 'select', options: types },
    { name: 'host', label: 'Host', required: true },
    { name: 'port', label: 'Port', type: 'number', required: true },
    { name: 'username', label: 'Username' },
    { name: 'password', label: 'Password', type: 'password', placeholder: p.hasPassword ? 'Leave blank to keep the saved password' : '' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], { ...p, password: '' }, async (v) => {
    await api.post('/proxies', { id: p.id, ...v });
    ctx.refresh();
  });

  const importBox = () => formModal('Import proxies', [
    { name: 'type', label: 'Default type', type: 'select', options: types },
    { name: 'text', label: 'One proxy per line', type: 'textarea', rows: 10, placeholder: 'host:port\nhost:port:user:pass\nuser:pass@host:port\nsocks5://user:pass@host:port' },
  ], { type: 'http' }, async (v) => {
    const r = await api.post('/proxies/import', v);
    toast(`Imported ${r.length} proxies`);
    ctx.refresh();
  }, { submit: 'Import', success: null });

  const check = (p) => formModal(`Check websites through ${proxyName(p)}`, [
    { name: 'websites', label: 'Websites (one per line)', type: 'list', rows: 6 },
  ], { websites: p.checks.map((c) => c.website).join('\n') || 'linkedin.com\ngoogle.com' }, async (v) => {
    const r = await api.post(`/proxies/${p.id}/check`, v);
    toast(r.map((c) => `${c.website}: ${c.status}`).join(' · '));
    ctx.refresh();
  }, { submit: 'Check', success: null });

  root.append(
    pageHeader('Proxies', 'Proxies are saved to the database so every computer can use them. A website check records whether a site is working, restricted or blocked through each proxy.',
      button('Import list', importBox), button('Add proxy', () => edit(), { kind: 'primary' })),
    card(null, table([
      { label: 'Proxy', render: (p) => h('div', {}, h('strong', {}, proxyName(p)), h('div', { class: 'muted mono' }, `${p.type}://${p.username ? `${p.username}@` : ''}${p.host}:${p.port}`)) },
      { label: 'Test', render: (p) => (p.status ? h('div', {}, badge(p.status, p.status === 'working' ? 'ok' : 'fail'), p.last_ip ? h('div', { class: 'muted' }, `exit IP ${p.last_ip}`) : null, h('div', { class: 'muted' }, timeAgo(p.last_checked))) : badge('not tested')) },
      { label: 'Websites', render: (p) => (p.checks.length ? h('div', { class: 'row' }, p.checks.map((c) => h('span', { title: c.reason || '' }, badge(`${c.website}: ${c.status}`, SITE_TONE[c.status])))) : h('span', { class: 'muted' }, 'none checked')) },
      { label: '', render: (p) => h('div', { class: 'row' },
        button('Test', action(async () => {
          const r = await api.post(`/proxies/${p.id}/test`);
          toast(r.ok ? `Works: ${r.ip} in ${r.ms}ms` : `Failed: ${r.error}`, r.ok ? 'ok' : 'fail');
          ctx.refresh();
        }), { small: true }),
        button('Check sites', () => check(p), { small: true }),
        button('Edit', () => edit(p), { small: true }),
        button('Delete', action(async () => {
          if (!(await confirmBox(`Delete proxy ${proxyName(p)}?`))) return;
          await api.del(`/proxies/${p.id}`);
          ctx.refresh();
        }), { small: true, kind: 'danger' })) },
    ], list, { emptyText: 'No proxies yet.' })),
  );
}

// ---- Configurations ----------------------------------------------------------------------
let configTab = 'chrome';
export async function configs(root, ctx) {
  const [{ info }, fields] = await Promise.all([api.get('/browsers'), api.get('/configs/fields')]);
  const browsers = ['chrome', 'firefox', 'camoufox', 'invisible'];
  const list = await api.get(`/configs/${configTab}`);
  const help = fields[configTab] || {};

  const edit = async (c) => {
    const data = c?.data ?? await api.post(`/configs/${configTab}/generate`, {});
    formModal(c ? `Edit ${c.name}` : `New ${info[configTab].label} configuration`, [
      { name: 'name', label: 'Name', required: true },
      { name: 'data', label: 'Settings (JSON)', type: 'json', rows: 14, help: 'New configurations start from a random but coherent preset.' },
    ], { name: c?.name || '', data }, async (v) => {
      await api.post(`/configs/${configTab}`, v);
      ctx.refresh();
    }, { wide: true });
  };

  root.append(
    pageHeader('Configurations', 'Saved launch settings per browser. Camoufox configurations also apply to VulpineOS. Invisible Playwright configurations hold the fingerprint seed, so the same seed gives the same fingerprint every run.',
      button('New configuration', action(() => edit()), { kind: 'primary' })),
    tabs(browsers.map((b) => [b, info[b].label]), (id) => { configTab = id; ctx.refresh(); }, configTab),
    card(null, table([
      { label: 'Name', render: (c) => h('strong', {}, c.name) },
      { label: 'Summary', render: (c) => c.summary },
      { label: '', render: (c) => h('div', { class: 'row' },
        button('Edit', () => edit(c), { small: true }),
        button('Delete', action(async () => {
          if (!(await confirmBox(`Delete configuration "${c.name}"?`))) return;
          await api.del(`/configs/${configTab}/${encodeURIComponent(c.name)}`);
          ctx.refresh();
        }), { small: true, kind: 'danger' })) },
    ], list, { emptyText: `No ${info[configTab].label} configurations yet.` })),
    card('Available settings', table([
      { label: 'Setting', render: (r) => h('code', {}, r[0]) },
      { label: 'Meaning', render: (r) => r[1] },
    ], Object.entries(help))),
  );
}

// ---- Extensions --------------------------------------------------------------------------
export async function extensions(root, ctx) {
  const list = await api.get('/extensions');
  const add = () => formModal('Add extension copy', [
    { name: 'kind', label: 'For', type: 'select', options: [['chrome', 'Chrome'], ['firefox', 'Firefox family (Firefox, Camoufox, VulpineOS, Invisible Playwright)']] },
    { name: 'sourcePath', label: 'Path on this computer', required: true, help: 'An unpacked extension folder, a .crx or .zip (Chrome), or an .xpi (Firefox).' },
    { name: 'name', label: 'Name (optional)' },
  ], { kind: 'chrome' }, async (v) => {
    await api.post('/extensions', v);
    ctx.refresh();
  }, { submit: 'Add' });

  root.append(
    pageHeader('Extensions', 'Extension copies live in Software/Extension Copies. Pick them per profile on the Profiles page and they are installed into that profile when it opens.',
      button('Add extension', add, { kind: 'primary' })),
    card(null, table([
      { label: 'Extension', render: (e) => h('div', {}, h('strong', {}, e.title), h('div', { class: 'muted' }, e.name)) },
      { label: 'For', render: (e) => badge(e.kind === 'chrome' ? 'Chrome' : 'Firefox family') },
      { label: 'Version', render: (e) => `${e.version} · MV${e.manifestVersion}` },
      { label: 'Id', render: (e) => (e.geckoId ? h('code', {}, e.geckoId) : '') },
      { label: '', render: (e) => button('Remove', action(async () => {
        if (!(await confirmBox(`Remove "${e.title}" from Extension Copies? Profiles that list it will skip it.`))) return;
        await api.del(`/extensions/${e.kind}/${encodeURIComponent(e.name)}`);
        ctx.refresh();
      }), { small: true, kind: 'danger' }) },
    ], list, { emptyText: 'No extension copies yet.' })),
    card('How Chrome extensions load', pre('Recent Chrome releases ignore the --load-extension flag. Alpha-Sales starts Chrome with a DevTools pipe and installs each unpacked extension with Extensions.loadUnpacked, which works on the consumer Chrome build.')),
  );
}
