import { api, h, card, pageHeader, button, action, badge, table, timeAgo, form, confirmBox, toast, pre, clear, tabs } from '../lib.js';

// ---- Google Drive (rclone) ---------------------------------------------------------------
export async function sync(root, ctx) {
  const s = await api.get('/sync/status');
  const out = h('div');
  const show = (title, data) => clear(out).append(card(title, pre(typeof data === 'string' ? data : JSON.stringify(data, null, 2))));
  const pathForm = form([{ name: 'path', label: 'Path inside the app folder (blank = everything synced)', placeholder: 'e.g. Configurations/Chrome' }]);
  const ready = s.installed && s.remoteConfigured;

  root.append(
    pageHeader('Google Drive', `Accounts, Profiles, Configurations, Scrapers and Local Files are mirrored to Google Drive with rclone, under ${s.base || 'Alpha-Sales/<your account>'}. Every upload writes its last edit date to the database.`),
    h('div', { class: 'grid' },
      card('rclone', s.installed ? badge('installed', 'ok') : badge('not installed', 'warn'), h('div', { class: 'muted mono' }, s.binary || ''),
        s.installed ? null : h('p', {}, button('Install rclone', () => { location.hash = '#/software'; }))),
      card('Google Drive', ready ? badge(`connected as "${s.remote}"`, 'ok') : badge('not connected', 'warn'),
        h('p', {}, button(s.remoteConfigured ? 'Reconnect' : 'Connect Google Drive', action(async () => {
          toast('A Google consent page opens in your browser. Approve it, then come back.');
          await api.post('/sync/connect');
          ctx.refresh();
        }, { success: 'Google Drive connected' }), { kind: s.remoteConfigured ? '' : 'primary' }))),
      card('Automatic sync', s.autoSync ? badge('on', 'ok') : badge('off'), h('p', { class: 'muted' }, 'Local edits are pushed a few seconds after they happen. Change it in Settings (RCLONE_AUTO_SYNC).'))),
    card('Actions', pathForm.el, h('div', { class: 'row', style: { marginTop: '12px' } },
      button('check()', action(async () => show('Differences (local vs Drive)', await api.post('/sync/check', pathForm.values()))), { title: 'Compare local files with Drive' }),
      button('update()', action(async () => {
        const v = pathForm.values();
        show('Update', v.path ? await api.post('/sync/update', v) : await api.post('/sync/update-all'));
      }), { kind: 'primary', title: 'Upload local changes to Drive' }),
      button('Pull from Drive', action(async () => {
        if (!(await confirmBox('Download newer files from Google Drive into this computer?', { danger: false, label: 'Pull' }))) return;
        show('Pull', await api.post('/sync/pull'));
      })),
      button('archive.exist()', action(async () => show('Archive', await api.post('/sync/archive', { ...pathForm.values(), mode: 'exist' }))), { title: 'Move the Drive copy into Archive/<date>' }),
      button('archive.new()', action(async () => show('Archive', await api.post('/sync/archive', { ...pathForm.values(), mode: 'new' }))), { title: 'Upload the local copy into Archive/<date>' }))),
    out,
  );
  if (!ready) out.append(card(null, h('p', { class: 'muted' }, 'Install rclone and connect Google Drive to enable sync. Until then everything stays on this computer.')));
}

// ---- Commands ----------------------------------------------------------------------------
let cmdType = 'shell';
export async function commands(root, ctx) {
  const examples = {
    shell: 'node --version',
    powershell: 'Get-ComputerInfo | Select-Object OsName, OsVersion',
    admin: 'winget upgrade --all --silent',
    ahk: 'MsgBox "Hello from Alpha-Sales"',
  };
  const help = {
    shell: 'Runs in the system shell (cmd on Windows, sh elsewhere).',
    powershell: 'Runs a PowerShell script (pwsh or Windows PowerShell).',
    admin: 'Runs PowerShell as administrator. Windows shows a UAC prompt on this computer; on macOS/Linux it uses sudo without a password prompt.',
    ahk: 'Runs an AutoHotkey v2 script (Windows only).',
  };
  const input = h('textarea', { rows: 8, spellcheck: 'false', placeholder: examples[cmdType] });
  const out = h('div');
  root.append(
    pageHeader('Commands', 'Run shell, PowerShell, administrator or AutoHotkey commands on this computer. Every command is written to the log.'),
    tabs([['shell', 'Shell'], ['powershell', 'PowerShell'], ['admin', 'Administrator'], ['ahk', 'AutoHotkey']], (id) => { cmdType = id; ctx.refresh(); }, cmdType),
    card(null, h('p', { class: 'muted' }, help[cmdType]), input, h('div', { class: 'row', style: { marginTop: '12px' } },
      button('Run', action(async () => {
        if (cmdType === 'admin' && !(await confirmBox('Run this command as administrator?', { label: 'Run as admin' }))) return;
        clear(out).append(h('p', { class: 'muted' }, 'Running…'));
        const r = await api.post('/commands/run', { type: cmdType, command: input.value });
        clear(out).append(card(null, h('div', { class: 'row' }, badge(r.ok ? 'exit 0' : `exit ${r.code}`, r.ok ? 'ok' : 'fail')),
          r.stdout ? pre(r.stdout) : null, r.stderr ? h('div', {}, h('h3', { style: { marginTop: '12px' } }, 'Errors'), pre(r.stderr)) : null));
      }), { kind: 'primary' }),
      button('Example', () => { input.value = examples[cmdType]; }))),
    out,
  );
}

// ---- Logs --------------------------------------------------------------------------------
export async function logs(root, ctx) {
  const files = await api.get('/logs/files');
  const viewer = h('div');
  const showFile = action(async (name) => {
    const r = await api.get(`/logs/file?name=${encodeURIComponent(name)}`);
    clear(viewer).append(card(name, pre(r.text || '(empty)')));
    viewer.scrollIntoView({ behavior: 'smooth' });
  });
  const filter = form([
    { name: 'state', label: 'Show', type: 'select', options: [['', 'Everything'], ['warn', '⚠️ Warnings'], ['fail', '❌ Errors'], ['ok', '✅ Successes']] },
    { name: 'scope', label: 'Area', placeholder: 'e.g. sync, browsers, job:' },
  ]);
  const recentBox = h('div');
  const loadRecent = action(async () => {
    const v = filter.values();
    const q = new URLSearchParams({ limit: '300', ...(v.state ? { state: v.state } : {}), ...(v.scope ? { scope: v.scope } : {}) });
    const rows = await api.get(`/logs/recent?${q}`);
    clear(recentBox).append(rows.length ? h('div', { class: 'pre' }, rows.map((e) => h('div', { class: `log-line ${e.state}` },
      `${e.time.replace('T', ' ').slice(0, 19)} ${e.icon} [${e.scope}] ${e.message}`, e.details ? h('span', { class: 'muted' }, ` ${JSON.stringify(e.details)}`) : null))) : h('p', { class: 'muted' }, 'No matching entries.'));
  });
  filter.el.addEventListener('change', () => loadRecent());

  root.append(
    pageHeader('Logs', `Every action is logged with ✅, ⚠️ or ❌. Simple lines are what you see; advanced details are kept with them. This session writes to ${ctx.status.logFile}; each job run also gets its own file under Logs/jobs.`),
    card('This session', filter.el, h('div', { style: { marginTop: '12px' } }, recentBox)),
    card('Log files', table([
      { label: 'File', render: (f) => h('a', { href: '#/logs', onclick: (e) => { e.preventDefault(); showFile(f.file); } }, f.file) },
      { label: 'Size', render: (f) => `${(f.size / 1024).toFixed(1)} KB` },
      { label: 'Modified', render: (f) => timeAgo(f.modified) },
    ], files.slice(0, 200), { emptyText: 'No log files yet.' })),
    viewer,
  );
  await loadRecent();
}

// ---- Software ----------------------------------------------------------------------------
export async function software(root, ctx) {
  const list = await api.get('/software');
  root.append(
    pageHeader('Software', 'Everything Alpha-Sales needs is installed into the Software folder of the app, so each computer is set up the same way. The steps are also listed in "Software/List of Software Installations & Commands.md".',
      button('Install everything missing', action(async () => {
        for (const s of list) if (!s.installed && !s.manual && !(s.windowsOnly && !navigator.userAgent.includes('Windows'))) await api.post(`/software/${s.id}/install`);
        toast('Installing in the background. Follow progress in the live log.');
      }), { kind: 'primary' })),
    card(null, table([
      { label: 'Software', render: (s) => h('div', {}, h('strong', {}, s.label), s.path ? h('div', { class: 'muted mono' }, s.path) : null) },
      { label: 'Status', render: (s) => h('div', { class: 'row' },
        s.installing ? badge('installing…', 'info') : s.installed ? badge('installed', 'ok') : badge('missing', 'warn'),
        s.id === 'chrome' && s.installed && !s.inRepo ? badge('using the system Chrome', '') : null,
        s.windowsOnly ? badge('Windows only') : null,
        s.manual ? badge('manual download') : null) },
      { label: 'Details', render: (s) => (s.tools ? Object.entries(s.tools).map(([t, ok]) => badge(t, ok ? 'ok' : '')) : s.error || '') },
      { label: '', render: (s) => (s.installing ? '' : button(s.installed ? 'Reinstall' : 'Install', action(async () => {
        await api.post(`/software/${s.id}/install`);
        toast(`Installing ${s.label}. Follow progress in the live log.`);
        setTimeout(() => ctx.refresh(), 600);
      }), { small: true, kind: s.installed ? '' : 'primary' })) },
    ], list)),
    card('About Chrome', h('p', {}, 'Alpha-Sales uses the consumer Google Chrome build, not open-source Chromium. The installer downloads the official Chrome package from Google into Software/Chrome, so the version is the same on every computer. If you prefer your normal Chrome install, set CHROME_PATH in Settings.')),
  );
  ctx.on((e) => { if (['software.installed', 'software.failed', 'software.installing'].includes(e.type)) ctx.refresh(); });
}

// ---- Settings ----------------------------------------------------------------------------
export async function settings(root, ctx) {
  const { env, dataRoot, port } = await api.get('/settings');
  const status = ctx.status;
  const f = form(env.map((e) => ({
    name: e.key,
    label: e.key,
    type: e.secret ? 'password' : 'text',
    placeholder: e.secret && e.set ? '•••••• saved (leave blank to keep)' : '',
    help: e.help,
  })), Object.fromEntries(env.map((e) => [e.key, e.value])));

  root.append(
    pageHeader('Settings', `Saved to the .env file in the app folder. Data folder: ${dataRoot}. Control panel port: ${port}.`),
    card('App', h('div', { class: 'row' },
      badge(`version ${status.version.full}`, 'info'),
      badge(`database: ${status.dbMode}`),
      badge(status.user ? `signed in: ${status.user.email}` : 'not signed in', status.user ? 'ok' : 'warn')),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        button('Update app', action(async () => {
          if (!(await confirmBox('Pull the latest version and restart? Running jobs are stopped first.', { danger: false, label: 'Update' }))) return;
          const r = await api.post('/app/update');
          toast(r.updated ? 'Updated. Restarting…' : 'Already up to date');
          if (r.updated) setTimeout(() => location.reload(), 6000);
        }), { title: 'git pull + npm install, then restart' }),
        button('Restart', action(async () => {
          await api.post('/app/restart');
          toast('Restarting…');
          setTimeout(() => location.reload(), 5000);
        })),
        status.user ? button('Sign out', action(async () => {
          await api.post('/auth/logout');
          await ctx.reloadStatus();
          location.hash = '#/';
          ctx.refresh();
        }), { kind: 'danger' }) : null)),
    card('Configuration', f.el, h('div', { class: 'row', style: { marginTop: '12px' } }, button('Save settings', action(async () => {
      const v = f.values();
      // Blank secret fields keep their saved value.
      for (const e of env) if (e.secret && !v[e.key]) delete v[e.key];
      await api.put('/settings', v);
      toast('Saved. Restart the app for every change to apply.');
    }), { kind: 'primary' }))),
  );
}
