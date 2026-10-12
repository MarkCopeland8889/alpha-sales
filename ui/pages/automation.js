import { api, h, card, pageHeader, button, action, badge, table, timeAgo, fmtDate, form, formModal, modal, confirmBox, toast, pre, clear } from '../lib.js';

const RUN_TONE = { completed: 'ok', running: 'info', queued: '', failed: 'fail', stopped: 'warn', waiting_human: 'warn', paused: 'warn' };

// Turns a scraper's declared inputs into form fields.
function inputFields(scraper, prefix = '') {
  return Object.entries(scraper.inputs || {}).map(([key, spec]) => {
    const type = { number: 'number', boolean: 'checkbox', list: 'list', text: 'textarea', json: 'json', select: 'select' }[spec.type] || 'text';
    return { name: `${prefix}${key}`, label: spec.label || key, type, options: spec.options, required: spec.required && spec.default === undefined, value: spec.default, help: spec.help };
  });
}
const stripPrefix = (values, prefix) => Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));

async function browserChoices() {
  const [{ info, available }, profiles, proxies] = await Promise.all([api.get('/browsers'), api.get('/profiles'), api.get('/proxies')]);
  return {
    info,
    profileOptions: [['', 'Choose a profile'], ...profiles.map((p) => [`${p.browser}/${p.name}`, `${info[p.browser].label} · ${p.name}${available[p.browser] ? '' : ' (browser not installed)'}`])],
    proxyOptions: [['', 'Profile default'], ['none', 'No proxy'], ...proxies.map((p) => [p.id, p.label || `${p.host}:${p.port}`])],
  };
}

async function computerOptions() {
  const devices = await api.get('/devices');
  return [['', 'This computer'], ...devices.filter((d) => !d.isThisMachine).map((d) => [d.machine_id, `${d.device_name}${d.online ? '' : ' (offline)'}${d.sameVersion ? '' : ' (different version)'}`])];
}

function browserSpec(v) {
  if (!v.profile) return {};
  const [browser, profile] = v.profile.split('/');
  const spec = { browser, profile, headless: Boolean(v.headless) };
  if (v.proxyId === 'none') spec.proxyId = false;
  else if (v.proxyId) spec.proxyId = v.proxyId;
  return spec;
}

// ---- Scrapers ----------------------------------------------------------------------------
export async function scrapers(root, ctx) {
  const list = await api.get('/scrapers');

  const runScraper = async (s) => {
    const [choices, computers, { projects }] = await Promise.all([browserChoices(), computerOptions(), api.get('/projects')]);
    const fields = [
      ...(s.needsBrowser ? [
        { name: 'profile', label: 'Browser profile', type: 'select', options: choices.profileOptions, required: true },
        { name: 'proxyId', label: 'Proxy', type: 'select', options: choices.proxyOptions },
        { name: 'headless', label: 'Headless', type: 'checkbox' },
      ] : []),
      { name: 'projectId', label: 'Project', type: 'select', options: [['', 'None'], ...projects.map((p) => [p.id, p.name])] },
      { name: 'machineId', label: 'Run on', type: 'select', options: computers },
      ...inputFields(s, 'in_'),
    ];
    formModal(`Run ${s.label}`, fields, {}, async (v) => {
      const run = await api.post('/scrapers/run', {
        scraper: s.name, browser: browserSpec(v), projectId: v.projectId || null, machineId: v.machineId || undefined, input: stripPrefix(v, 'in_'),
      });
      toast(`Queued "${run.label}"`);
      location.hash = '#/runs';
    }, { submit: 'Run', success: null, wide: true });
  };

  root.append(
    pageHeader('Scrapers', 'Scrapers are the building blocks of jobs. Built-in ones ship with the app; your own live in Scrapers/<name>/scraper.js and reload automatically when edited.',
      button('New scraper', () => formModal('New scraper', [{ name: 'name', label: 'Name', required: true, placeholder: 'e.g. linkedin-people-search' }], {}, async (v) => {
        const r = await api.post('/scrapers/new', v);
        toast(`Created ${r.file}. Open it in your editor to write the steps.`);
        ctx.refresh();
      }, { submit: 'Create', success: null }), { kind: 'primary' })),
    card(null, table([
      { label: 'Scraper', render: (s) => h('div', {}, h('strong', {}, s.label), h('div', { class: 'muted mono' }, s.name), s.error ? h('div', { class: 'badge fail' }, s.error) : null) },
      { label: 'What it does', render: (s) => h('div', {}, s.description, s.checkpoints?.length ? h('div', { class: 'muted' }, `Checkpoints: ${s.checkpoints.join(' → ')}`) : null) },
      { label: 'Site', render: (s) => s.site },
      { label: 'Source', render: (s) => h('div', {}, badge(s.source === 'builtin' ? 'built-in' : 'yours', s.source === 'builtin' ? '' : 'info'), s.file ? h('div', { class: 'muted mono' }, s.file) : null) },
      { label: '', render: (s) => (s.error ? '' : button('Run', () => runScraper(s), { small: true, kind: 'primary' })) },
    ], list)),
  );
}

// ---- Jobs --------------------------------------------------------------------------------
export async function jobs(root, ctx) {
  const [{ jobs: list, controllers, upcoming }, devices, scraperList, { projects }] = await Promise.all([
    api.get('/jobs'), api.get('/devices'), api.get('/scrapers'), api.get('/projects'),
  ]);
  const deviceName = (id) => (id ? devices.find((d) => d.machine_id === id)?.device_name || id.slice(0, 8) : 'This computer');

  const runJob = async (job) => {
    const computers = await computerOptions();
    formModal(`Run ${job.name}`, [{ name: 'machineId', label: 'Run on', type: 'select', options: computers }], { machineId: job.target_machine_id || '' }, async (v) => {
      await api.post(`/jobs/${job.id}/run`, { machineId: v.machineId || undefined });
      toast(`Queued "${job.name}"`);
      location.hash = '#/runs';
    }, { submit: 'Run now', success: null });
  };

  root.append(
    pageHeader('Jobs', 'A job is a browser setup plus a list of scraper steps, run one after another or side by side in separate tabs. Jobs can run on a schedule and on any computer on the same app version.',
      button('New job', action(() => editJob(null, { scraperList, projects, controllers, ctx })), { kind: 'primary' })),
    card(null, table([
      { label: 'Job', render: (j) => h('div', {}, h('strong', {}, j.name), j.description ? h('div', { class: 'muted' }, j.description) : null) },
      { label: 'Steps', render: (j) => h('div', {}, j.definition.steps.map((s) => s.label || s.scraper).join(' → '), h('div', { class: 'muted' }, `${j.definition.mode} · ${j.definition.controller}`)) },
      { label: 'Browser', render: (j) => (j.definition.browser?.profile ? `${j.definition.browser.browser} · ${j.definition.browser.profile}` : 'none') },
      { label: 'Schedule', render: (j) => {
        if (!j.schedule) return h('span', { class: 'muted' }, 'manual');
        const next = upcoming.find((u) => u.jobId === j.id)?.next;
        return h('div', {}, h('code', {}, j.schedule), h('div', { class: 'muted' }, next ? `next ${fmtDate(next)}` : j.enabled ? 'runs on its target computer' : 'paused'));
      } },
      { label: 'Runs on', render: (j) => deviceName(j.target_machine_id) },
      { label: 'Status', render: (j) => h('div', {}, badge(j.enabled ? j.status || 'idle' : 'disabled', j.status === 'running' ? 'info' : ''), j.last_heartbeat && j.status === 'running' ? h('div', { class: 'muted' }, `heartbeat ${timeAgo(j.last_heartbeat)}`) : null) },
      { label: '', render: (j) => h('div', { class: 'row' },
        button('Run', () => runJob(j), { small: true, kind: 'primary' }),
        button('Edit', action(() => editJob(j, { scraperList, projects, controllers, ctx })), { small: true }),
        button('Runs', () => { location.hash = '#/runs'; }, { small: true }),
        button('Delete', action(async () => {
          if (!(await confirmBox(`Delete job "${j.name}" and its run history?`))) return;
          await api.del(`/jobs/${j.id}`);
          ctx.refresh();
        }), { small: true, kind: 'danger' })) },
    ], list, { emptyText: 'No jobs yet. Create one from your scrapers.' })),
  );
  ctx.on((e) => { if (e.type === 'run.started' || e.type === 'run.finished') ctx.refresh(); });
}

async function editJob(job, { scraperList, projects, controllers, ctx }) {
  const [choices, computers] = await Promise.all([browserChoices(), computerOptions()]);
  const d = job?.definition || { mode: 'sequential', controller: 'basic', steps: [], browser: {} };
  const b = d.browser || {};
  const top = form([
    { name: 'name', label: 'Job name', required: true },
    { name: 'description', label: 'Description' },
    { name: 'project_id', label: 'Project', type: 'select', options: [['', 'None'], ...projects.map((p) => [p.id, p.name])] },
    { name: 'profile', label: 'Browser profile', type: 'select', options: choices.profileOptions, help: 'Needed when any step uses a browser.' },
    { name: 'proxyId', label: 'Proxy', type: 'select', options: choices.proxyOptions },
    { name: 'controller', label: 'Controller', type: 'select', options: Object.entries(controllers).map(([k, v]) => [k, `${k}: ${v}`]) },
    { name: 'mode', label: 'Steps run', type: 'select', options: [['sequential', 'One after another (same tab)'], ['parallel', 'At the same time (one tab each)']] },
    { name: 'target_machine_id', label: 'Runs on', type: 'select', options: computers },
    { name: 'schedule', label: 'Schedule (cron, optional)', placeholder: '0 9 * * 1-5  = 9:00 on weekdays', help: 'Leave blank to run manually.' },
    { name: 'maxRunMinutes', label: 'Max minutes per run', type: 'number', placeholder: 'Guardrail default' },
    { name: 'headless', label: 'Headless', type: 'checkbox' },
    { name: 'keepOpen', label: 'Keep the browser open afterwards', type: 'checkbox' },
    { name: 'enabled', label: 'Enabled', type: 'checkbox' },
  ], {
    ...job,
    profile: b.profile ? `${b.browser}/${b.profile}` : '',
    proxyId: b.proxyId === false ? 'none' : b.proxyId || '',
    headless: b.headless,
    controller: d.controller,
    mode: d.mode,
    keepOpen: d.keepOpen,
    maxRunMinutes: d.maxRunMinutes,
    target_machine_id: job?.target_machine_id || '',
    enabled: job ? job.enabled : true,
  });

  const stepsBox = h('div', { class: 'steps' });
  const steps = [];
  const addStep = (step = { scraper: scraperList.find((s) => !s.error)?.name, input: {} }) => {
    const entry = { el: h('div', { class: 'step' }) };
    const render = (current) => {
      const s = scraperList.find((x) => x.name === current.scraper) || scraperList[0];
      entry.head = form([
        { name: 'scraper', label: 'Scraper', type: 'select', options: scraperList.filter((x) => !x.error).map((x) => [x.name, x.label]) },
        { name: 'label', label: 'Step label (optional)' },
        { name: 'continueOnError', label: 'Keep going if this step fails', type: 'checkbox' },
      ], current);
      entry.inputs = form(inputFields(s), current.input || {});
      entry.head.el.querySelector('select').addEventListener('change', (e) => render({ ...entry.head.values(), scraper: e.target.value, input: {} }));
      clear(entry.el).append(
        h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } },
          h('strong', {}, `Step ${steps.indexOf(entry) + 1}: ${s.label}`),
          h('div', { class: 'row' },
            button('↑', () => move(entry, -1), { small: true, title: 'Move up' }),
            button('↓', () => move(entry, 1), { small: true, title: 'Move down' }),
            button('Remove', () => { steps.splice(steps.indexOf(entry), 1); redraw(); }, { small: true, kind: 'danger' }))),
        entry.head.el,
        s.description ? h('p', { class: 'muted' }, s.description) : null,
        Object.keys(s.inputs || {}).length ? h('div', { style: { marginTop: '8px' } }, entry.inputs.el) : null);
    };
    entry.render = render;
    entry.value = () => ({ ...entry.head.values(), input: entry.inputs.values() });
    steps.push(entry);
    render(step);
    redraw();
  };
  const move = (entry, dir) => {
    const i = steps.indexOf(entry);
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    redraw();
  };
  function redraw() {
    clear(stepsBox).append(...steps.map((s) => s.el));
    steps.forEach((s, i) => { const t = s.el.querySelector('strong'); if (t) t.textContent = t.textContent.replace(/^Step \d+/, `Step ${i + 1}`); });
  }
  (d.steps.length ? d.steps : [undefined]).forEach((s) => addStep(s));

  modal({
    title: job ? `Edit ${job.name}` : 'New job',
    wide: true,
    body: h('div', {}, top.el, h('h3', { style: { marginTop: '18px' } }, 'Steps'), stepsBox, button('Add step', () => addStep())),
    actions: [{
      label: 'Save job', kind: 'primary', success: 'Job saved',
      onClick: async () => {
        const v = top.values();
        if (v.schedule) {
          const check = await api.get(`/schedules/validate?expr=${encodeURIComponent(v.schedule)}`);
          if (!check.ok) throw new Error(`Schedule: ${check.error}`);
        }
        await api.post('/jobs', {
          id: job?.id,
          name: v.name,
          description: v.description,
          project_id: v.project_id || null,
          schedule: v.schedule || null,
          target_machine_id: v.target_machine_id || null,
          enabled: v.enabled,
          definition: {
            browser: browserSpec(v),
            controller: v.controller,
            mode: v.mode,
            keepOpen: v.keepOpen,
            maxRunMinutes: v.maxRunMinutes || null,
            steps: steps.map((s) => s.value()),
          },
        });
        ctx.refresh();
      },
    }],
  });
}

// ---- Runs --------------------------------------------------------------------------------
export async function runs(root, ctx) {
  const [{ runs: list }, devices] = await Promise.all([api.get('/runs?limit=100'), api.get('/devices')]);
  const deviceName = (id) => devices.find((d) => d.machine_id === id)?.device_name || id?.slice(0, 8);
  const open = ['queued', 'running', 'waiting_human', 'paused'];

  const details = action(async (r) => {
    const run = await api.get(`/runs/${r.id}`);
    const isHere = run.machine_id === ctx.status.machine.machineId;
    const logBox = h('div');
    modal({
      title: run.label,
      wide: true,
      body: h('div', { class: 'stack' },
        h('div', { class: 'row' }, badge(run.status, RUN_TONE[run.status]), badge(deviceName(run.machine_id)), badge(run.app_version || ''),
          h('span', { class: 'muted' }, `queued ${fmtDate(run.created_at)}${run.finished_at ? ` · finished ${fmtDate(run.finished_at)}` : ''}`)),
        run.error ? pre(`Error: ${run.error}`) : null,
        h('h3', {}, 'Checkpoints'),
        table([
          { label: 'Scraper', render: (c) => c.scraper },
          { label: 'Checkpoint', render: (c) => c.name },
          { label: 'Data', render: (c) => h('code', {}, JSON.stringify(c.data).slice(0, 300)) },
          { label: 'When', render: (c) => fmtDate(c.created_at) },
        ], run.checkpoints, { emptyText: 'No checkpoints saved.' }),
        h('h3', {}, 'Result'),
        pre(JSON.stringify(run.result ?? run.progress ?? {}, null, 2)),
        h('details', {}, h('summary', {}, 'Job definition used'), pre(JSON.stringify(run.spec, null, 2))),
        run.log_file && isHere ? button('Show run log', action(async () => {
          const r2 = await api.get(`/logs/file?name=${encodeURIComponent(run.log_file)}`);
          clear(logBox).append(pre(r2.text));
        }), { small: true }) : null,
        logBox),
    });
  });

  root.append(
    pageHeader('Runs', 'Every job execution on every computer, newest first. Stopping a run on another computer takes effect within its next heartbeat (30 seconds).'),
    card(null, table([
      { label: 'Run', render: (r) => h('a', { href: '#/runs', onclick: (e) => { e.preventDefault(); details(r); } }, r.label) },
      { label: 'Status', render: (r) => h('div', {}, badge(r.status, RUN_TONE[r.status]), r.error ? h('div', { class: 'muted' }, r.error.slice(0, 140)) : null) },
      { label: 'Progress', render: (r) => (r.progress?.scraper ? `step ${r.progress.step}/${r.progress.of} · ${r.progress.scraper}${r.progress.checkpoint ? ` · ${r.progress.checkpoint}` : ''}` : '') },
      { label: 'Computer', render: (r) => deviceName(r.machine_id) },
      { label: 'Started', render: (r) => timeAgo(r.started_at || r.created_at) },
      { label: '', render: (r) => h('div', { class: 'row' },
        button('Details', () => details(r), { small: true }),
        open.includes(r.status) ? button('Stop', action(async () => { await api.post(`/runs/${r.id}/stop`); ctx.refresh(); }), { small: true, kind: 'danger' }) : null,
        ['failed', 'stopped'].includes(r.status) ? button('Resume', action(async () => {
          await api.post(`/runs/${r.id}/resume`);
          toast('Queued again; scrapers can skip work saved at their checkpoints');
          ctx.refresh();
        }), { small: true }) : null) },
    ], list, { emptyText: 'No runs yet.' })),
  );
  ctx.on((e) => { if (['run.queued', 'run.started', 'run.finished', 'run.progress', 'runs.changed'].includes(e.type)) ctx.refresh(); });
}

// ---- Human help --------------------------------------------------------------------------
export async function hitl(root, ctx) {
  const [{ local, all }, devices] = await Promise.all([api.get('/hitl'), api.get('/devices')]);
  const deviceName = (id) => devices.find((d) => d.machine_id === id)?.device_name || 'another computer';
  const localIds = new Set(local.map((r) => r.id));
  root.append(
    pageHeader('Human help', 'When a scraper meets a CAPTCHA, a login wall or anything that needs a person, it pauses here and brings the browser to the front. Solve it in that browser window, then click Done and the run continues.'),
    card(null, table([
      { label: 'Needs', render: (r) => h('div', {}, h('strong', {}, r.message), r.url ? h('div', { class: 'muted mono' }, r.url) : null) },
      { label: 'Kind', render: (r) => badge(r.kind, 'warn') },
      { label: 'Computer', render: (r) => (localIds.has(r.id) ? badge('this computer', 'info') : deviceName(r.machine_id)) },
      { label: 'Since', render: (r) => timeAgo(r.created_at) },
      { label: '', render: (r) => h('div', { class: 'row' },
        button('Done', action(async () => { await api.post(`/hitl/${r.id}/resolve`, { resolution: 'done' }); await ctx.reloadStatus(); ctx.refresh(); }), { small: true, kind: 'primary' }),
        button('Skip', action(async () => { await api.post(`/hitl/${r.id}/cancel`, { reason: 'Skipped by a person' }); await ctx.reloadStatus(); ctx.refresh(); }), { small: true, kind: 'danger' })) },
    ], all, { emptyText: 'Nothing needs a human right now.' })),
  );
  ctx.on((e) => { if (e.type === 'hitl.request' || e.type === 'hitl.resolved') ctx.refresh(); });
}

// ---- Guardrails --------------------------------------------------------------------------
export async function guardrails(root, ctx) {
  const { settings, usage } = await api.get('/guardrails');
  const f = form([
    { name: 'maxConcurrentRuns', label: 'Runs at once on this computer', type: 'number' },
    { name: 'maxRunMinutes', label: 'Max minutes per run', type: 'number' },
    { name: 'minActionGapMs', label: 'Min gap between counted actions (ms)', type: 'number' },
    { name: 'limits', label: 'Daily limits per action and account', type: 'json', rows: 10, help: 'Scrapers call ctx.action("name") before each counted action. perDay is the daily budget; minGapMs is the least time after the previous counted action. "default" applies to names without their own limit.' },
  ], settings);
  root.append(
    pageHeader('Guardrails', 'Safety limits for every run on this computer. The kill switch in the top bar stops every job and closes every browser immediately.',
      button(settings.killSwitch ? 'Turn kill switch off' : 'Kill switch', action(async () => {
        const on = !settings.killSwitch;
        if (on && !(await confirmBox('Stop every running job and close every browser now?', { label: 'Stop everything' }))) return;
        await api.post('/guardrails/kill', { on });
        await ctx.reloadStatus();
        ctx.refresh();
      }), { kind: 'danger' })),
    settings.killSwitch ? card(null, h('p', {}, badge('Kill switch is ON', 'fail'), ' No job can start until it is turned off.')) : null,
    card('Limits', f.el, h('div', { class: 'row', style: { marginTop: '12px' } }, button('Save', action(async () => {
      await api.put('/guardrails', f.values());
      ctx.refresh();
    }, { success: 'Guardrails saved' }), { kind: 'primary' }))),
    card('Used today', table([
      { label: 'Account · action', render: ([k]) => k.replace('|', ' · ') },
      { label: 'Count', render: ([, v]) => v },
      { label: 'Limit', render: ([k]) => (settings.limits[k.split('|')[1]] || settings.limits.default)?.perDay ?? 'none' },
    ], Object.entries(usage), { emptyText: 'No counted actions today.' })),
  );
}
