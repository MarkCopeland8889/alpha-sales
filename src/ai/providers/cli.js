// AI through command-line tools logged in with a subscription (no per-token API cost).
// Pass `account: "<platform>/<username>"` to use a saved OAuth account's login.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, IS_WINDOWS } from '../../core/commands.js';
import { uid } from '../../core/utils.js';
import { cliPath, cliInstalled, CLI_TOOLS } from '../cli-tools.js';
import { oauthEnv } from '../../accounts/index.js';
import { flattenPrompt } from '../files.js';

function envFor(req, tool) {
  if (!req.account) return {};
  const [platform, username] = req.account.split('/');
  const res = oauthEnv(platform, username);
  if (res.tool !== tool) throw new Error(`Account ${req.account} is a ${res.tool} login, not ${tool}`);
  return res.env;
}

async function exec(tool, args, req, input) {
  const res = await run(cliPath(tool), args, {
    env: envFor(req, tool),
    input,
    timeout: req.timeoutMs || 15 * 60 * 1000,
    shell: IS_WINDOWS, // npm-installed CLIs are .cmd files on Windows
    cwd: req.cwd || os.tmpdir(),
  });
  if (!res.ok) throw new Error(`${CLI_TOOLS[tool].label} failed (exit ${res.code}): ${(res.stderr || res.stdout).slice(-800)}`);
  return res;
}

const base = (id, label, tool, models, defaultModel, reasoningLevels = []) => ({
  id, label, kind: 'cli', tool, models, defaultModel, reasoningLevels,
  available: () => cliInstalled(tool),
});

export const codex = {
  ...base('codex', 'Codex CLI', 'codex', ['gpt-5-codex', 'gpt-5'], 'gpt-5-codex', ['low', 'medium', 'high']),
  async complete(req) {
    const out = path.join(os.tmpdir(), `alpha-codex-${uid()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--color', 'never', '--output-last-message', out];
    if (req.model) args.push('-m', req.model);
    if (req.reasoning) args.push('-c', `model_reasoning_effort="${req.reasoning}"`);
    args.push('-');
    const res = await exec('codex', args, req, flattenPrompt(req));
    const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : res.stdout;
    fs.rm(out, { force: true }, () => {});
    return { text: text.trim(), model: req.model || this.defaultModel };
  },
};

export const claudeCode = {
  ...base('claude-code', 'Claude Code CLI', 'claude', ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], 'claude-sonnet-5-5'),
  async complete(req) {
    const args = ['-p', '--output-format', 'json'];
    if (req.model) args.push('--model', req.model);
    const res = await exec('claude', args, req, flattenPrompt(req));
    let data;
    try {
      data = JSON.parse(res.stdout);
    } catch {
      return { text: res.stdout.trim(), model: req.model };
    }
    if (data.is_error) throw new Error(data.result || 'Claude Code returned an error');
    return { text: data.result ?? '', model: req.model || this.defaultModel, usage: data.usage };
  },
};

export const geminiCli = {
  ...base('gemini-cli', 'Gemini CLI', 'gemini', ['gemini-2.5-pro', 'gemini-2.5-flash'], 'gemini-2.5-pro'),
  async complete(req) {
    const args = ['-p', flattenPrompt(req)];
    if (req.model) args.push('-m', req.model);
    const res = await exec('gemini', args, req);
    return { text: res.stdout.trim(), model: req.model || this.defaultModel };
  },
};

export const opencodeCli = {
  ...base('opencode-cli', 'OpenCode CLI', 'opencode', ['anthropic/claude-sonnet-5-5', 'opencode/grok-code'], 'anthropic/claude-sonnet-5-5'),
  async complete(req) {
    const args = ['run'];
    if (req.model) args.push('-m', req.model);
    args.push(flattenPrompt(req));
    const res = await exec('opencode', args, req);
    return { text: res.stdout.trim(), model: req.model || this.defaultModel };
  },
};

export const antigravity = {
  ...base('antigravity', 'Antigravity (AGY)', 'antigravity', [], null),
  available: () => false,
  async complete() {
    throw new Error('Antigravity has no headless prompt command wired up yet. Add its CLI command in src/ai/providers/cli.js once confirmed.');
  },
};
