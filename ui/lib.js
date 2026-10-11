// Small UI toolkit for the control panel (no build step, no framework).

let token = null;

async function getToken() {
  if (token) return token;
  const res = await fetch('/api/token');
  token = (await res.json()).token;
  return token;
}

async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-alpha-token': await getToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  patch: (u, b = {}) => request('PATCH', u, b),
  del: (u) => request('DELETE', u),
  token: getToken,
};

// ---- Live events -------------------------------------------------------------------------
const listeners = new Set();
export function onLive(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function connectLive(onStatus) {
  const t = await getToken();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${t}`);
  ws.onopen = () => onStatus?.(true);
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    for (const fn of listeners) fn(e);
  };
  ws.onclose = () => {
    onStatus?.(false);
    setTimeout(() => connectLive(onStatus), 2500);
  };
}

// ---- DOM helpers -------------------------------------------------------------------------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (el) => {
  el.replaceChildren();
  return el;
};

export function toast(message, tone = 'ok') {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${tone}` }, message);
  box.append(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4700);
}

// Runs an async action from a button, with a busy state and error toast.
export function action(fn, { success } = {}) {
  return async (e) => {
    const btn = e?.currentTarget;
    if (btn) btn.disabled = true;
    try {
      const res = await fn(e);
      if (success) toast(typeof success === 'function' ? success(res) : success);
      return res;
    } catch (err) {
      toast(err.message, 'fail');
      return undefined;
    } finally {
      if (btn) btn.disabled = false;
    }
  };
}

export function button(label, onClick, { kind = '', title, small } = {}) {
  return h('button', { class: `btn ${kind} ${small ? 'small' : ''}`.trim(), onclick: onClick, title, type: 'button' }, label);
}

export function badge(text, tone = '') {
  return h('span', { class: `badge ${tone}` }, text);
}

export function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...children);
}

export function pageHeader(title, subtitle, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    h('div', { class: 'actions' }, ...actions));
}

export function empty(text) {
  return h('div', { class: 'empty' }, text);
}

export function table(columns, rows, { emptyText = 'Nothing here yet.' } = {}) {
  if (!rows?.length) return empty(emptyText);
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', { 'data-label': c.label }, c.render ? c.render(r) : r[c.key] ?? '')))))));
}

export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '');

// ---- Forms & modals ----------------------------------------------------------------------
// fields: [{ name, label, type, options, value, help, placeholder, required }]
export function form(fields, values = {}) {
  const inputs = {};
  const el = h('div', { class: 'form' }, fields.map((f) => {
    const v = values[f.name] ?? f.value ?? '';
    let input;
    if (f.type === 'select') {
      input = h('select', { name: f.name }, (f.options || []).map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: val, selected: String(val) === String(v) }, lab);
      }));
    } else if (f.type === 'textarea' || f.type === 'json' || f.type === 'list') {
      const text = f.type === 'json' ? (typeof v === 'string' ? v : JSON.stringify(v ?? {}, null, 2)) : f.type === 'list' && Array.isArray(v) ? v.join('\n') : v;
      input = h('textarea', { name: f.name, rows: f.rows || (f.type === 'json' ? 8 : 4), placeholder: f.placeholder, spellcheck: 'false' }, text);
    } else if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', name: f.name, checked: Boolean(v) });
    } else if (f.type === 'multi') {
      input = h('div', { class: 'multi' }, (f.options || []).map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return h('label', { class: 'check' }, h('input', { type: 'checkbox', value: val, checked: (v || []).includes(val) }), lab);
      }));
    } else {
      input = h('input', { type: f.type || 'text', name: f.name, value: v, placeholder: f.placeholder, autocomplete: 'off' });
    }
    inputs[f.name] = { f, input };
    return h('label', { class: `field ${f.type === 'checkbox' ? 'inline' : ''} ${f.wide ? 'wide' : ''}` },
      h('span', { class: 'label' }, f.label, f.required ? h('b', { class: 'req' }, ' *') : null),
      input,
      f.help ? h('small', { class: 'muted' }, f.help) : null);
  }));
  return {
    el,
    values() {
      const out = {};
      for (const [name, { f, input }] of Object.entries(inputs)) {
        let val;
        if (f.type === 'checkbox') val = input.checked;
        else if (f.type === 'multi') val = [...input.querySelectorAll('input:checked')].map((i) => i.value);
        else if (f.type === 'number') val = input.value === '' ? null : Number(input.value);
        else if (f.type === 'json') {
          try {
            val = input.value.trim() ? JSON.parse(input.value) : {};
          } catch {
            throw new Error(`${f.label}: invalid JSON`);
          }
        } else if (f.type === 'list') val = input.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        else val = input.value;
        if (f.required && (val === '' || val == null)) throw new Error(`${f.label} is required`);
        out[name] = val;
      }
      return out;
    },
  };
}

export function modal({ title, body, actions = [], wide = false }) {
  const root = document.getElementById('modal-root');
  const close = () => wrap.remove();
  const wrap = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('header', {}, h('h2', {}, title), button('×', close, { kind: 'ghost', title: 'Close' })),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('footer', {}, actions.map((a) => button(a.label, action(async (e) => {
        const res = await a.onClick(e);
        if (res !== false) close();
      }, { success: a.success }), { kind: a.kind || '' }))) : null));
  root.append(wrap);
  wrap.querySelector('input, textarea, select')?.focus();
  return close;
}

// Opens a modal with a form; resolves when saved via onSave(values).
export function formModal(title, fields, values, onSave, { submit = 'Save', success = 'Saved', wide } = {}) {
  const f = form(fields, values);
  modal({ title, body: f.el, wide, actions: [{ label: submit, kind: 'primary', success, onClick: () => onSave(f.values()) }] });
}

export function confirmBox(message, { danger = true, label = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    const close = modal({
      title: 'Please confirm',
      body: h('p', {}, message),
      actions: [{ label, kind: danger ? 'danger' : 'primary', onClick: () => resolve(true) }],
    });
    document.querySelector('.modal-back:last-child')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-back')) resolve(false);
    });
    void close;
  });
}

export function pre(text) {
  return h('pre', { class: 'pre' }, text);
}

export function tabs(items, onPick, active) {
  return h('div', { class: 'tabs' }, items.map(([id, label]) => h('button', {
    class: `tab ${id === active ? 'active' : ''}`, type: 'button', onclick: () => onPick(id),
  }, label)));
}
