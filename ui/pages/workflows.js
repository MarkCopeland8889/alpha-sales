// Workflows: Krypton (LinkedIn client generation and prospecting).
import { api, h, card, pageHeader, button, action, table, form, modal, tabs, toast, clear, badge, fmtDate } from '../lib.js';

const TYPE = { string: 'text', text: 'textarea', number: 'number', boolean: 'checkbox', select: 'select' };

async function browserFields() {
  const [{ info, available }, profiles, proxies, { projects }, devices, { controllers }] = await Promise.all([
    api.get('/browsers'), api.get('/profiles'), api.get('/proxies'), api.get('/projects'), api.get('/devices'), api.get('/jobs'),
  ]);
  return [
    { name: 'profile', label: 'Browser profile (logged in to LinkedIn)', type: 'select', options: [['', 'Choose a profile'], ...profiles.map((p) => [`${p.browser}/${p.name}`, `${info[p.browser].label} · ${p.name}${available[p.browser] ? '' : ' (browser not installed)'}`])] },
    { name: 'proxyId', label: 'Proxy', type: 'select', options: [['', 'Profile default'], ['none', 'No proxy'], ...proxies.map((p) => [p.id, p.label || `${p.host}:${p.port}`])] },
    { name: 'controller', label: 'Controller', type: 'select', value: 'basic', options: Object.entries(controllers).map(([id, label]) => [id, label]) },
    { name: 'headless', label: 'Headless (hidden window)', type: 'checkbox', help: 'Leave off so you can log in or solve a check when asked' },
    { name: 'projectId', label: 'Project', type: 'select', options: [['', 'None'], ...projects.map((p) => [p.id, p.name])], help: 'Business details left blank here are taken from the project variables' },
    { name: 'machineId', label: 'Run on', type: 'select', options: [['', 'This computer'], ...devices.filter((d) => !d.isThisMachine).map((d) => [d.machine_id, `${d.device_name}${d.online ? '' : ' (offline)'}`])] },
  ];
}

function browserSpec(v) {
  if (!v.profile) return {};
  const [browser, profile] = v.profile.split('/');
  const spec = { browser, profile, headless: Boolean(v.headless) };
  if (v.proxyId === 'none') spec.proxyId = false;
  else if (v.proxyId) spec.proxyId = v.proxyId;
  return spec;
}

// Drops blank values so they fall back to the project variables and the defaults.
const clean = (values) => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined && v !== ''));

function openReport(name) {
  return action(async () => {
    const r = await api.get(`/krypton/runs/${encodeURIComponent(name)}/report`);
    if (!r.html) throw new Error('This run has no report yet');
    const frame = h('iframe', { class: 'report-frame', sandbox: 'allow-popups allow-popups-to-escape-sandbox', title: 'Krypton report' });
    frame.srcdoc = r.html;
    modal({
      title: name,
      wide: true,
      body: h('div', {}, h('p', { class: 'muted' }, 'Folder: ', h('code', {}, r.folder)), frame),
      actions: [{ label: 'Copy Markdown', onClick: async () => { await navigator.clipboard.writeText(r.md); toast('Report copied'); return false; } }],
    });
  });
}

export async function krypton(root, ctx) {
  const [{ groups, defaults, test1 }, bFields, { runs }] = await Promise.all([api.get('/krypton/fields'), browserFields(), api.get('/krypton/runs')]);
  const tabIds = [['browser', 'Browser'], ...groups.map(([title], i) => [`g${i}`, title.split(' (')[0]])];
  let active = 'g0';
  let values = {};
  const forms = {};

  const build = () => {
    forms.browser = form(bFields, values);
    groups.forEach(([, fields], i) => {
      forms[`g${i}`] = form(fields.map((f) => ({
        name: f.key,
        label: f.label,
        type: TYPE[f.type] || 'text',
        options: f.options,
        value: f.default ?? (f.type === 'number' || f.type === 'boolean' ? defaults[f.key] : ''),
        help: f.help,
        rows: f.key === 'business_description' ? 4 : 3,
      })), values);
    });
  };
  const collect = () => Object.assign({}, ...Object.values(forms).map((f) => f.values()));

  const formBox = h('div');
  const tabBox = h('div');
  const show = () => {
    clear(tabBox).append(tabs(tabIds, (id) => { values = { ...values, ...collect() }; active = id; build(); show(); }, active));
    clear(formBox).append(forms[active].el);
  };
  build();
  show();

  const settingsOf = (v) => {
    const bKeys = new Set(bFields.map((f) => f.name));
    return clean(Object.fromEntries(Object.entries(v).filter(([k]) => !bKeys.has(k))));
  };
  const check = (v) => {
    if (!v.profile) throw new Error('Choose a browser profile on the Browser tab');
    return v;
  };

  const runNow = action(async () => {
    const v = check({ ...values, ...collect() });
    const run = await api.post('/krypton/run', { input: settingsOf(v), browser: browserSpec(v), controller: v.controller || 'basic', projectId: v.projectId || null, machineId: v.machineId || undefined });
    toast(`Queued "${run.label}"`);
    location.hash = '#/runs';
  });
  const saveJob = action(async () => {
    const v = check({ ...values, ...collect() });
    await api.post('/jobs', {
      name: `Krypton: ${v.business_name || 'LinkedIn'}`,
      project_id: v.projectId || null,
      definition: { browser: browserSpec(v), controller: v.controller || 'basic', maxRunMinutes: 720, steps: [{ scraper: 'krypton-linkedin', input: settingsOf(v) }] },
    });
    toast('Saved as a job (Automation → Jobs) where it can be scheduled');
  });
  const fillTest1 = () => {
    values = { ...collect(), ...test1 };
    active = 'g0';
    build();
    show();
    toast('Test 1 filled in: choose the browser profile, then Run');
  };

  root.append(
    pageHeader('Krypton: LinkedIn prospecting', 'Finds people and companies that need your service from LinkedIn people, posts, jobs and groups, then ranks them with AI. It only reads: it never applies, connects, messages, follows or reacts.',
      button('Fill in test 1', fillTest1), button('Save as job', saveJob), button('Run now', runNow, { kind: 'primary' })),
    card('Settings', h('p', { class: 'muted' }, 'Required: business type, name and description. Leave the ideal customer blank and the AI writes the ICPs; leave the search terms blank and it writes those too.'), tabBox, formBox),
    card('Runs', table([
      { label: 'Run', render: (r) => h('div', {}, h('b', {}, r.name), h('div', { class: 'muted' }, fmtDate(r.updated))) },
      { label: 'Business', key: 'business' },
      { label: 'Terms', key: 'terms' },
      { label: 'Actively looking', render: (r) => badge(String(r.people1), r.people1 ? 'ok' : '') },
      { label: 'Matching', key: 'people2' },
      { label: 'Post leads', key: 'posts1' },
      { label: 'Exact jobs', render: (r) => badge(String(r.jobs1), r.jobs1 ? 'ok' : '') },
      { label: '', render: (r) => (r.hasReport ? button('Report', openReport(r.name), { small: true }) : h('span', { class: 'muted' }, 'running or stopped')) },
    ], runs, { emptyText: 'No Krypton runs yet. Fill in test 1 and press Run now.' })),
  );
  ctx.on((e) => { if (e.type === 'run.finished') ctx.refresh(); });
}
