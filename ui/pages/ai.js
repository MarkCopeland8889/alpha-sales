import { api, h, card, pageHeader, button, action, badge, table, tabs, form, pre, clear } from '../lib.js';

const KIND_LABEL = { api: 'API key', cli: 'CLI login', web: 'Chat website', local: 'Local', decision: 'Decision model', test: 'Test' };
let aiTab = 'playground';

export async function ai(root, ctx) {
  const [providers, matrix, accounts] = await Promise.all([api.get('/ai/providers'), api.get('/ai/capabilities'), api.get('/accounts')]);
  root.append(
    pageHeader('AI hub', 'One interface for every AI provider: API keys, CLI tools logged in with a subscription, and (in a later phase) chat websites driven through a browser to avoid token costs.'),
    tabs([['playground', 'Playground'], ['providers', 'Providers'], ['matrix', 'Function matrix']], (id) => { aiTab = id; ctx.refresh(); }, aiTab),
  );
  if (aiTab === 'providers') root.append(providersCard(providers));
  else if (aiTab === 'matrix') root.append(matrixCard(matrix));
  else root.append(playground(providers, accounts));
}

function providersCard(providers) {
  return card(null, table([
    { label: 'Provider', render: (p) => h('div', {}, h('strong', {}, p.label), h('div', { class: 'muted mono' }, p.id)) },
    { label: 'Type', render: (p) => badge(KIND_LABEL[p.kind] || p.kind) },
    { label: 'Status', render: (p) => (p.available ? badge('ready', 'ok') : badge(p.kind === 'web' || p.kind === 'decision' ? 'planned' : 'not set up', 'warn')) },
    { label: 'Models', render: (p) => (p.models || []).join(', ') },
    { label: 'Set up with', render: (p) => (p.envKey ? h('span', {}, 'Settings: ', h('code', {}, p.envKey)) : p.tool ? h('span', {}, 'Software: AI CLIs, then a CLI account') : '') },
  ], providers));
}

function matrixCard({ functions, providers }) {
  const mark = (v) => (v === 'ready' ? badge('✓', 'ok') : v === 'planned' ? badge('planned') : '');
  return card('Which provider supports which function', h('div', { class: 'table-wrap' },
    h('table', { class: 'matrix' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Function'), providers.map((p) => h('th', { title: p.id }, p.label)))),
      h('tbody', {}, functions.map(([id, label]) => h('tr', {}, h('td', {}, label), providers.map((p) => h('td', {}, mark(p.capabilities[id])))))))),
  h('p', { class: 'muted' }, '"Planned" functions belong to the chat-website phase, where Playwright drives chatgpt.com, gemini.google.com, claude.ai and google.com like a person would.'));
}

function playground(providers, accounts) {
  const usable = providers.filter((p) => p.kind !== 'web' && p.kind !== 'decision');
  const first = usable.find((p) => p.available) || usable[0];
  const out = h('div');
  const opts = h('div');

  const providerForm = form([
    { name: 'provider', label: 'Provider', type: 'select', options: usable.map((p) => [p.id, `${p.label}${p.available ? '' : ' (not set up)'}`]) },
  ], { provider: first.id });
  let f;
  const renderOptions = () => {
    const p = usable.find((x) => x.id === providerForm.values().provider);
    const oauth = accounts.filter((a) => a.type === 'oauth' && a.tool === p.tool);
    f = form([
      { name: 'model', label: 'Model', type: 'select', options: p.models || [] },
      ...(p.reasoningLevels?.length ? [{ name: 'reasoning', label: 'Reasoning', type: 'select', options: [['', 'Default'], ...p.reasoningLevels] }] : []),
      ...(p.kind === 'cli' ? [{ name: 'account', label: 'Login', type: 'select', options: [['', 'Default login on this computer'], ...oauth.map((a) => [`${a.platform}/${a.username}`, `${a.platform}/${a.username}`])] }] : []),
      { name: 'system', label: 'System instructions', type: 'textarea', rows: 3, wide: true },
      { name: 'prompt', label: 'Prompt', type: 'textarea', rows: 7, required: true, wide: true },
      { name: 'files', label: 'Attach files (paths on this computer, one per line)', type: 'list', rows: 2, wide: true },
      { name: 'json', label: 'Expect JSON back', type: 'checkbox' },
    ], { model: p.defaultModel });
    clear(opts).append(f.el);
  };
  providerForm.el.querySelector('select').addEventListener('change', renderOptions);
  renderOptions();

  const send = button('Send', action(async () => {
    const v = { provider: providerForm.values().provider, ...f.values() };
    if (!v.reasoning) delete v.reasoning;
    if (!v.account) delete v.account;
    clear(out).append(h('p', { class: 'muted' }, 'Waiting for the answer…'));
    const started = Date.now();
    const res = await api.post('/ai/complete', v).catch((err) => {
      clear(out).append(pre(`Error: ${err.message}`));
      throw err;
    });
    let text = res.text;
    if (v.json) {
      try {
        const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        text = `(Not valid JSON)\n\n${text}`;
      }
    }
    clear(out).append(
      h('div', { class: 'row', style: { marginBottom: '8px' } }, badge(res.model || v.model, 'info'), badge(`${((Date.now() - started) / 1000).toFixed(1)}s`),
        res.usage ? badge(`${res.usage.input_tokens ?? res.usage.prompt_tokens ?? '?'} in · ${res.usage.output_tokens ?? res.usage.completion_tokens ?? '?'} out`) : null,
        button('Copy', () => navigator.clipboard.writeText(res.text), { small: true })),
      pre(text));
  }), { kind: 'primary' });

  return h('div', {},
    card('Ask', providerForm.el, h('div', { style: { marginTop: '12px' } }, opts), h('div', { class: 'row', style: { marginTop: '12px' } }, send)),
    card('Answer', out));
}
