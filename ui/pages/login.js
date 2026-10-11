import { api, h, button, action, toast } from '../lib.js';

export async function login(root, ctx) {
  const { authMode, machine } = ctx.status;
  const google = button('Login with Google', action(async () => {
    const { url } = await api.post('/auth/google');
    location.href = url;
  }), { kind: 'primary' });
  const local = button('Continue on this computer', action(async () => {
    await api.post('/auth/local', {});
    toast('Signed in');
    await ctx.reloadStatus();
    location.hash = '#/';
    ctx.refresh();
  }), { kind: 'primary' });

  root.append(h('div', { class: 'login' },
    h('div', { class: 'card' },
      h('div', { class: 'logo' }, 'A'),
      h('h1', {}, 'Alpha-Sales'),
      h('p', { class: 'muted' }, `Signing in registers ${machine.deviceName} on your account and starts its heartbeat.`),
      h('div', { style: { margin: '20px 0 8px' } }, authMode === 'google' ? google : local),
      authMode === 'google'
        ? null
        : h('p', { class: 'muted' }, 'Local mode: Supabase is not configured yet, so data stays on this computer. Add SUPABASE_URL and SUPABASE_ANON_KEY in Settings to enable Google login and multi-computer sync.'),
      h('p', {}, h('a', { href: '#/settings' }, 'Settings'), ' · ', h('a', { href: '#/software' }, 'Software'), ' · ', h('a', { href: '#/logs' }, 'Logs')))));
}
