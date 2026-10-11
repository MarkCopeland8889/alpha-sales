import { api, h, card, pageHeader, button, action, badge, table, timeAgo, formModal, confirmBox, toast } from '../lib.js';

const STATUS_TONE = { active: 'ok', needs_login: 'warn', warming: 'info', restricted: 'warn', banned: 'fail', retired: '' };
const STATUSES = ['active', 'needs_login', 'warming', 'restricted', 'banned', 'retired'];
const TOOLS = [['codex', 'Codex CLI'], ['claude', 'Claude Code'], ['gemini', 'Gemini CLI'], ['opencode', 'OpenCode'], ['antigravity', 'Antigravity (AGY)']];

export async function accounts(root, ctx) {
  const [list, profiles, proxies, { info }] = await Promise.all([api.get('/accounts'), api.get('/profiles'), api.get('/proxies'), api.get('/browsers')]);
  const profileOptions = [['', 'Not linked'], ...profiles.map((p) => [`${p.browser}/${p.name}`, `${info[p.browser].label} · ${p.name}`])];
  const proxyOptions = [['', 'Profile default'], ...proxies.map((p) => [p.id, p.label || `${p.host}:${p.port}`])];

  const editWeb = (a = {}) => formModal(a.username ? `Edit ${a.platform}/${a.username}` : 'New web account', [
    { name: 'platform', label: 'Platform', required: true, placeholder: 'e.g. LinkedIn' },
    { name: 'username', label: 'Username', required: true },
    { name: 'email', label: 'Login email' },
    { name: 'password', label: 'Password', type: 'password', placeholder: a.hasPassword ? 'Leave blank to keep the saved password' : 'Optional; encrypted with ALPHA_SECRET', help: 'Only needed if a scraper should type it. Logging in by hand once and keeping the profile is safer.' },
    { name: 'link', label: 'Browser profile', type: 'select', options: profileOptions },
    { name: 'proxyId', label: 'Proxy', type: 'select', options: proxyOptions },
    { name: 'loginUrl', label: 'Login page', placeholder: 'https://www.linkedin.com/login' },
    { name: 'status', label: 'Status', type: 'select', options: STATUSES },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], { ...a, link: a.browser ? `${a.browser}/${a.profile}` : '', proxyId: a.proxyId || '', password: '' }, async (v) => {
    const [browser, profile] = v.link ? v.link.split('/') : [null, null];
    await api.post('/accounts', { type: 'web', ...v, browser, profile, proxyId: v.proxyId || null, link: undefined });
    ctx.refresh();
  });

  const editOauth = (a = {}) => formModal(a.username ? `Edit ${a.platform}/${a.username}` : 'New CLI (OAuth) account', [
    { name: 'tool', label: 'Tool', type: 'select', options: TOOLS },
    { name: 'platform', label: 'Platform folder', required: true, placeholder: 'e.g. OpenAI, Anthropic, Google' },
    { name: 'username', label: 'Account name', required: true, placeholder: 'e.g. work-account' },
    { name: 'email', label: 'Email' },
    { name: 'status', label: 'Status', type: 'select', options: STATUSES },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], { tool: 'codex', ...a }, async (v) => {
    await api.post('/accounts', { type: 'oauth', ...v });
    ctx.refresh();
  });

  const remove = (a) => action(async () => {
    if (!(await confirmBox(`Delete ${a.platform}/${a.username}? Its folder is archived to Google Drive first when sync is connected.`))) return;
    await api.del(`/accounts/${encodeURIComponent(a.platform)}/${encodeURIComponent(a.username)}`);
    ctx.refresh();
  });

  const web = list.filter((a) => a.type === 'web');
  const oauth = list.filter((a) => a.type === 'oauth');
  root.append(
    pageHeader('Accounts', 'Web accounts live in a browser profile. CLI accounts keep each tool\'s login in its own folder, so several logins of the same tool work side by side. Both are stored under Accounts/<Platform>/<username>.',
      button('New CLI account', () => editOauth()), button('New web account', () => editWeb(), { kind: 'primary' })),
    card('Web accounts', table([
      { label: 'Account', render: (a) => h('div', {}, h('strong', {}, `${a.platform} / ${a.username}`), a.email ? h('div', { class: 'muted' }, a.email) : null) },
      { label: 'Status', render: (a) => badge(a.status, STATUS_TONE[a.status]) },
      { label: 'Profile', render: (a) => (a.profile ? `${info[a.browser]?.label} · ${a.profile}` : h('span', { class: 'muted' }, 'not linked')) },
      { label: 'Password', render: (a) => (a.hasPassword ? 'saved' : '') },
      { label: 'Last login', render: (a) => timeAgo(a.lastLogin) },
      { label: '', render: (a) => h('div', { class: 'row' },
        button('Open', action(async () => {
          await api.post(`/accounts/${encodeURIComponent(a.platform)}/${encodeURIComponent(a.username)}/open`);
          toast('Browser opened');
        }), { small: true, kind: 'primary' }),
        button('Edit', () => editWeb(a), { small: true }),
        button('Delete', remove(a), { small: true, kind: 'danger' })) },
    ], web, { emptyText: 'No web accounts yet.' })),
    card('CLI (OAuth) accounts', table([
      { label: 'Account', render: (a) => h('div', {}, h('strong', {}, `${a.platform} / ${a.username}`), a.email ? h('div', { class: 'muted' }, a.email) : null) },
      { label: 'Tool', render: (a) => TOOLS.find(([id]) => id === a.tool)?.[1] || a.tool },
      { label: 'Status', render: (a) => badge(a.status, STATUS_TONE[a.status]) },
      { label: 'Use in AI hub as', render: (a) => h('code', {}, `${a.platform}/${a.username}`) },
      { label: '', render: (a) => h('div', { class: 'row' },
        button('Log in', action(async () => {
          const r = await api.post(`/accounts/${encodeURIComponent(a.platform)}/${encodeURIComponent(a.username)}/login`);
          toast(`A terminal opened running "${r.command}". Finish the login there.`);
        }), { small: true, kind: 'primary' }),
        button('Edit', () => editOauth(a), { small: true }),
        button('Delete', remove(a), { small: true, kind: 'danger' })) },
    ], oauth, { emptyText: 'No CLI accounts yet.' })),
  );
}
