// Assisted login for a web account: opens the account's login page in its profile,
// waits for a person to sign in (and solve any check), then saves the session cookies
// and marks the account active. Run it with the account's browser + profile.
import path from 'node:path';
import { getAccount, markAccount } from '../../accounts/index.js';

export default {
  name: 'account-login',
  label: 'Account login (human assisted)',
  site: '*',
  description: 'Open a saved web account\'s login page, let a person sign in, then save cookies and mark it active.',
  inputs: {
    platform: { type: 'string', required: true, label: 'Platform (folder under Accounts)' },
    username: { type: 'string', required: true, label: 'Username' },
  },
  checkpoints: ['opened', 'logged-in'],

  async run(ctx, input) {
    const acc = getAccount(input.platform, input.username);
    if (!acc) throw new Error(`Account ${input.platform}/${input.username} not found`);
    if (acc.loginUrl) await ctx.page.goto(acc.loginUrl, { waitUntil: 'domcontentloaded' });
    await ctx.checkpoint('opened', { url: acc.loginUrl });
    await ctx.askHuman(`Log in to ${acc.platform} as ${acc.username} in profile "${ctx.session.profile}", then click Done`, { kind: 'login', url: acc.loginUrl });
    const file = path.join(acc.folder, 'cookies.json');
    const count = await ctx.session.exportCookies(file);
    markAccount(input.platform, input.username, { status: 'active', lastLogin: new Date().toISOString() });
    await ctx.checkpoint('logged-in', { cookies: count });
    return { cookies: count, file };
  },
};
