// Accounts: Accounts/<Platform>/<username>/account.json
//
//   web    a website login that lives in a browser profile (cookies, saved session).
//          Linked to { browser, profile, proxyId }. Optional saved email/password,
//          encrypted with ALPHA_SECRET when it is set.
//   oauth  a CLI login (Codex, Claude Code, Gemini CLI, OpenCode, ...). The CLI's
//          credentials live in Accounts/<Platform>/<username>/home.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, safeName, readJson, writeJson, ensureDir } from '../core/paths.js';
import { config } from '../core/env.js';
import { encryptSecret, decryptSecret } from '../core/utils.js';
import { openTerminal } from '../core/commands.js';
import { logger } from '../core/logbook.js';
import { CLI_TOOLS, cliPath, accountEnv } from '../ai/cli-tools.js';
import { removeWithArchive } from '../sync/rclone.js';

const log = logger('accounts');
export const ACCOUNT_STATUSES = ['active', 'needs_login', 'warming', 'restricted', 'banned', 'retired'];

const dirOf = (platform, username) => path.join(PATHS.accounts, safeName(platform), safeName(username));
const fileOf = (platform, username) => path.join(dirOf(platform, username), 'account.json');

function present(acc) {
  if (!acc) return null;
  const { password, ...rest } = acc;
  return { ...rest, hasPassword: Boolean(password), folder: dirOf(acc.platform, acc.username) };
}

export function listAccounts() {
  const out = [];
  if (!fs.existsSync(PATHS.accounts)) return out;
  for (const platform of fs.readdirSync(PATHS.accounts)) {
    const pdir = path.join(PATHS.accounts, platform);
    if (!fs.statSync(pdir).isDirectory()) continue;
    for (const user of fs.readdirSync(pdir)) {
      const acc = readJson(path.join(pdir, user, 'account.json'), null);
      if (acc) out.push(present(acc));
    }
  }
  return out;
}

export function getAccount(platform, username, { withSecret = false } = {}) {
  const acc = readJson(fileOf(platform, username), null);
  if (!acc) return null;
  if (!withSecret) return present(acc);
  return { ...acc, password: acc.password ? decryptSecret(acc.password, config.secret) : null };
}

export function saveAccount(data) {
  const { platform, username } = data;
  if (!platform || !username) throw new Error('Platform and username are required');
  if (!['web', 'oauth'].includes(data.type)) throw new Error('Account type must be "web" or "oauth"');
  if (data.type === 'oauth' && !CLI_TOOLS[data.tool]) throw new Error(`OAuth accounts need a CLI tool: ${Object.keys(CLI_TOOLS).join(', ')}`);
  const existing = readJson(fileOf(platform, username), {});
  const acc = {
    ...existing,
    type: data.type,
    platform: safeName(platform),
    username: safeName(username),
    tool: data.tool ?? existing.tool ?? null,
    email: data.email ?? existing.email ?? null,
    browser: data.browser ?? existing.browser ?? null,
    profile: data.profile ?? existing.profile ?? null,
    proxyId: data.proxyId ?? existing.proxyId ?? null,
    loginUrl: data.loginUrl ?? existing.loginUrl ?? null,
    status: data.status ?? existing.status ?? 'needs_login',
    notes: data.notes ?? existing.notes ?? '',
    createdAt: existing.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (data.password) acc.password = encryptSecret(data.password, config.secret);
  if (data.password && !config.secret) log.warn('ALPHA_SECRET is not set, so this password is stored as plain text');
  ensureDir(dirOf(platform, username));
  writeJson(fileOf(platform, username), acc);
  log.ok(`Saved ${acc.type} account ${acc.platform}/${acc.username}`);
  return present(acc);
}

export async function deleteAccount(platform, username) {
  const dir = dirOf(platform, username);
  if (!fs.existsSync(dir)) throw new Error('Account not found');
  await removeWithArchive(dir);
}

export function markAccount(platform, username, patch) {
  const acc = readJson(fileOf(platform, username), null);
  if (!acc) throw new Error('Account not found');
  writeJson(fileOf(platform, username), { ...acc, ...patch, updatedAt: new Date().toISOString() });
}

// Env vars that make a CLI use this OAuth account's login.
export function oauthEnv(platform, username) {
  const acc = getAccount(platform, username);
  if (!acc || acc.type !== 'oauth') throw new Error(`OAuth account ${platform}/${username} not found`);
  return { tool: acc.tool, env: accountEnv(acc.tool, path.join(dirOf(platform, username), 'home')) };
}

// Opens a terminal running the CLI's login command for this account.
export function startOAuthLogin(platform, username) {
  const { tool, env } = oauthEnv(platform, username);
  const t = CLI_TOOLS[tool];
  const bin = cliPath(tool);
  const cmd = t.login.replace(t.bin, `"${bin}"`);
  openTerminal(cmd, { env, title: `${t.label} login: ${username}` });
  return { command: t.login };
}
