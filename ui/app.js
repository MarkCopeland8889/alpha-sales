// Control panel shell: navigation, routing, login gate, live log and alerts.
import { api, h, clear, toast, onLive, connectLive, confirmBox } from './lib.js';

const NAV = [
  ['Overview', [['/', 'Dashboard', 'overview', 'dashboard'], ['/computers', 'Computers', 'overview', 'computers'], ['/projects', 'Projects', 'overview', 'projects']]],
  ['Browsers', [['/profiles', 'Profiles & sessions', 'browsers', 'profiles'], ['/proxies', 'Proxies', 'browsers', 'proxies'], ['/configs', 'Configurations', 'browsers', 'configs'], ['/extensions', 'Extensions', 'browsers', 'extensions']]],
  ['Accounts', [['/accounts', 'Accounts', 'accounts', 'accounts']]],
  ['AI', [['/ai', 'AI hub', 'ai', 'ai']]],
  ['Automation', [['/scrapers', 'Scrapers', 'automation', 'scrapers'], ['/jobs', 'Jobs', 'automation', 'jobs'], ['/runs', 'Runs', 'automation', 'runs'], ['/hitl', 'Human help', 'automation', 'hitl'], ['/guardrails', 'Guardrails', 'automation', 'guardrails']]],
  ['System', [['/sync', 'Google Drive', 'system', 'sync'], ['/commands', 'Commands', 'system', 'commands'], ['/logs', 'Logs', 'system', 'logs'], ['/software', 'Software', 'system', 'software'], ['/settings', 'Settings', 'system', 'settings']]],
];
const ROUTES = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([path, , mod, fn]) => [path, { mod, fn }])));

const state = { status: null, cleanup: [], hitlCount: 0 };
// Pages that work before signing in (so Supabase and software can be set up first).
const PUBLIC = new Set(['/settings', '/software', '/logs']);
const view = document.getElementById('view');

function renderNav() {
  const nav = document.getElementById('nav');
  const current = location.hash.slice(1) || '/';
  clear(nav).append(...NAV.flatMap(([group, items]) => [
    h('div', { class: 'group' }, group),
    ...items.map(([path, label]) => h('a', {
      href: `#${path}`,
      class: path === current ? 'active' : '',
      onclick: () => document.getElementById('sidebar').classList.remove('open'),
    }, label, path === '/hitl' && state.hitlCount ? h('span', { class: 'count' }, state.hitlCount) : null)),
  ]));
}

async function loadStatus() {
  state.status = await api.get('/status');
  const s = state.status;
  document.getElementById('brand-version').textContent = `v${s.version.full}`;
  document.getElementById('device-pill').textContent = `${s.machine.deviceName} · ${s.deviceStatus}`;
  document.getElementById('user-pill').textContent = s.user ? s.user.email : 'Not signed in';
  const kill = document.getElementById('kill-btn');
  kill.textContent = s.killSwitch ? 'Kill switch ON' : 'Kill switch';
  kill.classList.toggle('primary', s.killSwitch);
  state.hitlCount = s.openHumanRequests;
  updateHitlBanner();
  return s;
}

function updateHitlBanner() {
  const b = document.getElementById('hitl-banner');
  b.hidden = !state.hitlCount;
  b.textContent = `${state.hitlCount} task${state.hitlCount === 1 ? '' : 's'} need${state.hitlCount === 1 ? 's' : ''} a human`;
  renderNav();
}

export async function route() {
  for (const fn of state.cleanup.splice(0)) fn();
  renderNav();
  const path = location.hash.slice(1) || '/';
  const r = ROUTES[path] || ROUTES['/'];
  const ctx = {
    status: state.status,
    refresh: () => route(),
    reloadStatus: loadStatus,
    on: (fn) => state.cleanup.push(onLive(fn)),
  };
  clear(view).append(h('div', { class: 'muted' }, 'Loading…'));
  try {
    if (!state.status?.user && !PUBLIC.has(path)) {
      const m = await import('./pages/login.js');
      await m.login(clear(view), ctx);
      return;
    }
    const m = await import(`./pages/${r.mod}.js`);
    const node = h('div');
    await m[r.fn](node, ctx);
    clear(view).append(node);
  } catch (err) {
    clear(view).append(h('div', { class: 'card' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, err.message)));
  }
}

// ---- Live log drawer ---------------------------------------------------------------------
function addLogLine(e) {
  const lines = document.getElementById('log-lines');
  const el = h('div', { class: `log-line ${e.state}` }, `${e.time.slice(11)} ${e.icon} `, h('span', { class: 'scope' }, `[${e.scope}] `), e.message,
    e.details ? h('span', { class: 'muted' }, ` ${JSON.stringify(e.details).slice(0, 400)}`) : null);
  const atBottom = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 30;
  lines.append(el);
  while (lines.childElementCount > 400) lines.firstChild.remove();
  if (atBottom) lines.scrollTop = lines.scrollHeight;
  document.getElementById('log-last').textContent = `${e.icon} ${e.message}`;
}

async function boot() {
  document.getElementById('log-toggle').onclick = () => document.getElementById('log-drawer').classList.toggle('collapsed');
  document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('hitl-banner').onclick = () => { location.hash = '#/hitl'; };
  document.getElementById('kill-btn').onclick = async () => {
    const on = !state.status?.killSwitch;
    if (on && !(await confirmBox('Stop every running job and close every browser now?', { label: 'Stop everything' }))) return;
    try {
      await api.post('/guardrails/kill', { on });
      toast(on ? 'Kill switch on: everything stopped' : 'Kill switch off', on ? 'warn' : 'ok');
      await loadStatus();
    } catch (err) {
      toast(err.message, 'fail');
    }
  };

  const params = new URLSearchParams(location.search);
  if (params.get('loginError')) {
    toast(`Login failed: ${params.get('loginError')}`, 'fail');
    history.replaceState(null, '', '/');
  }

  onLive((e) => {
    if (e.type === 'log') addLogLine(e.data);
    if (e.type === 'hitl.request') {
      state.hitlCount += 1;
      updateHitlBanner();
      toast(`Needs a human: ${e.data.message}`, 'warn');
      if (Notification?.permission === 'granted') new Notification('Alpha-Sales needs you', { body: e.data.message });
    }
    if (e.type === 'hitl.resolved') {
      state.hitlCount = Math.max(0, state.hitlCount - 1);
      updateHitlBanner();
    }
    if (e.type === 'auth.changed') loadStatus().then(route);
    if (e.type === 'device.heartbeat' || e.type === 'guardrails.changed') loadStatus().catch(() => {});
  });
  connectLive((on) => document.getElementById('live-dot').classList.toggle('on', on));
  try {
    const recent = await api.get('/logs/recent?limit=150');
    recent.forEach(addLogLine);
  } catch {
    // ignore
  }
  if (window.Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  await loadStatus();
  window.addEventListener('hashchange', route);
  await route();
}

boot().catch((err) => {
  view.textContent = `Could not reach the Alpha-Sales engine: ${err.message}`;
});
