import { api, h, card, pageHeader, button, action, badge, table, timeAgo, formModal, confirmBox, toast } from '../lib.js';

const STATUS_TONE = { available: 'ok', busy: 'info', draining: 'warn', updating: 'warn', maintenance: 'warn', error: 'fail', offline: '' };
const RUN_TONE = { completed: 'ok', running: 'info', queued: '', failed: 'fail', stopped: 'warn', waiting_human: 'warn' };

function stat(label, value, sub) {
  return card(null, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat' }, value), sub ? h('div', { class: 'muted' }, sub) : null);
}

export async function dashboard(root, ctx) {
  const [status, devices, sessions, runs, software] = await Promise.all([
    api.get('/status'), api.get('/devices'), api.get('/sessions'), api.get('/runs?limit=8'), api.get('/software'),
  ]);
  const online = devices.filter((d) => d.online).length;
  const missing = software.filter((s) => !s.installed && !s.windowsOnly && !s.manual);
  root.append(
    pageHeader('Dashboard', `Signed in as ${status.user.email} on ${status.machine.deviceName}. Database: ${status.dbMode}.`,
      button('New job', () => { location.hash = '#/jobs'; }, { kind: 'primary' })),
    h('div', { class: 'grid' },
      stat('Computers online', `${online}/${devices.length}`, `This one: ${status.deviceStatus}`),
      stat('Open browsers', sessions.length, sessions.map((s) => s.profile).join(', ') || 'none'),
      stat('Running jobs', status.activeRuns.length, status.activeRuns.map((r) => r.label).join(', ') || 'idle'),
      stat('Needs a human', status.openHumanRequests, status.openHumanRequests ? 'Open Human help' : 'nothing waiting')),
    missing.length ? card('Setup', h('p', {}, 'Some software is not installed yet: ', missing.map((m) => m.label).join(', '), '. '), button('Open Software', () => { location.hash = '#/software'; })) : null,
    card('Recent runs', table([
      { label: 'Run', render: (r) => r.label },
      { label: 'Status', render: (r) => badge(r.status, RUN_TONE[r.status]) },
      { label: 'Progress', render: (r) => (r.progress?.scraper ? `${r.progress.scraper} ${r.progress.checkpoint ? `· ${r.progress.checkpoint}` : ''}` : '') },
      { label: 'When', render: (r) => timeAgo(r.created_at) },
    ], runs.runs, { emptyText: 'No runs yet. Create a job or run a scraper.' })),
    card('Quick start', h('ol', {},
      h('li', {}, 'Install browsers and tools on the ', h('a', { href: '#/software' }, 'Software'), ' page.'),
      h('li', {}, 'Create a browser ', h('a', { href: '#/profiles' }, 'profile'), ' (optionally with a ', h('a', { href: '#/proxies' }, 'proxy'), ').'),
      h('li', {}, 'Save your logins under ', h('a', { href: '#/accounts' }, 'Accounts'), ' and run the "Account login" scraper once.'),
      h('li', {}, 'Build a ', h('a', { href: '#/jobs' }, 'job'), ' from scrapers, then run it here or on another computer.'))),
  );
  ctx.on((e) => {
    if (['run.finished', 'run.started', 'session.opened', 'session.closed'].includes(e.type)) ctx.refresh();
  });
}

export async function computers(root, ctx) {
  const devices = await api.get('/devices');
  const statuses = ['available', 'draining', 'maintenance', 'error'];
  root.append(
    pageHeader('Computers', 'Every computer signed into this account. Jobs can be delegated only to computers that are online and on the same app version.',
      button('Set this computer\'s status', () => formModal('This computer\'s status', [
        { name: 'status', label: 'Status', type: 'select', options: statuses },
        { name: 'reason', label: 'Reason (optional)' },
      ], { status: ctx.status.deviceStatus === 'busy' ? 'available' : ctx.status.deviceStatus }, async (v) => {
        await api.post('/devices/status', v);
        await ctx.reloadStatus();
        ctx.refresh();
      }))),
    card(null, table([
      { label: 'Computer', render: (d) => h('div', {}, h('strong', {}, d.device_name), d.isThisMachine ? badge('this computer', 'info') : null, h('div', { class: 'muted mono' }, d.machine_id)) },
      { label: 'Status', render: (d) => h('div', { class: 'row' }, badge(d.online ? d.status : 'offline', d.online ? STATUS_TONE[d.status] : 'fail'), d.status_reason ? h('span', { class: 'muted' }, d.status_reason) : null) },
      { label: 'Last heartbeat', render: (d) => timeAgo(d.last_heartbeat) },
      { label: 'Version', render: (d) => h('div', {}, d.app_version, d.sameVersion ? null : badge('different version', 'warn')) },
      { label: 'System', render: (d) => `${d.os || d.platform} · ${d.info?.cpus ?? '?'} CPU · ${d.info?.memoryGb ?? '?'} GB` },
      { label: 'Last edit', render: (d) => timeAgo(d.last_edit) },
    ], devices)),
  );
  ctx.on((e) => { if (e.type === 'device.heartbeat') ctx.refresh(); });
}

export async function projects(root, ctx) {
  const { projects: list, suggested } = await api.get('/projects');
  const edit = (p = {}) => formModal(p.id ? `Edit ${p.name}` : 'New project', [
    { name: 'name', label: 'Project name', required: true },
    { name: 'description', label: 'Description', type: 'textarea' },
    ...suggested.map(([key, label, req]) => ({ name: `var_${key}`, label, required: req, type: key === 'business_description' || key === 'pain_points' ? 'textarea' : 'text' })),
    { name: 'extra', label: 'Other variables (JSON)', type: 'json', help: 'Any extra {{placeholders}} for AI prompts and scrapers' },
  ], {
    ...p,
    ...Object.fromEntries(suggested.map(([key]) => [`var_${key}`, p.variables?.[key] ?? ''])),
    extra: Object.fromEntries(Object.entries(p.variables || {}).filter(([k]) => !suggested.some(([s]) => s === k))),
  }, async (v) => {
    const variables = { ...v.extra };
    for (const [key] of suggested) if (v[`var_${key}`]) variables[key] = v[`var_${key}`];
    await api.post('/projects', { id: p.id, name: v.name, description: v.description, variables });
    ctx.refresh();
  }, { wide: true });

  root.append(
    pageHeader('Projects', 'A project holds a business or idea and its preset variables. Jobs and AI prompts use them as {{business_name}}-style placeholders.',
      button('New project', () => edit(), { kind: 'primary' })),
    card(null, table([
      { label: 'Project', render: (p) => h('div', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, p.description || '')) },
      { label: 'Variables', render: (p) => Object.keys(p.variables || {}).map((k) => badge(k)).slice(0, 8) },
      { label: '', render: (p) => h('div', { class: 'row' }, button('Edit', () => edit(p), { small: true }), button('Delete', action(async () => {
        if (!(await confirmBox(`Delete project "${p.name}"?`))) return;
        await api.del(`/projects/${p.id}`);
        toast('Project deleted');
        ctx.refresh();
      }), { small: true, kind: 'danger' })) },
    ], list, { emptyText: 'No projects yet.' })),
  );
}
