// AI command-line tools ("OAuth accounts"). Each tool keeps its login in a home folder;
// Alpha-Sales gives every saved account its own folder (Accounts/<Platform>/<user>/home)
// and points the CLI at it, so several logins of the same tool can be used side by side.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../core/paths.js';
import { IS_WINDOWS } from '../core/commands.js';

export const CLI_TOOLS = {
  codex: {
    label: 'Codex CLI',
    bin: 'codex',
    npm: '@openai/codex',
    login: 'codex login',
    home: { CODEX_HOME: '' },
  },
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    npm: '@anthropic-ai/claude-code',
    login: 'claude',
    home: { CLAUDE_CONFIG_DIR: '' },
  },
  gemini: {
    label: 'Gemini CLI',
    bin: 'gemini',
    npm: '@google/gemini-cli',
    login: 'gemini',
    // Gemini CLI keeps its login under ~/.gemini, so the whole home folder is redirected.
    home: { HOME: '', USERPROFILE: '' },
  },
  opencode: {
    label: 'OpenCode',
    bin: 'opencode',
    npm: 'opencode-ai',
    login: 'opencode auth login',
    home: { XDG_DATA_HOME: 'data', XDG_CONFIG_HOME: 'config' },
  },
  antigravity: {
    label: 'Antigravity (AGY)',
    bin: 'agy',
    npm: null,
    login: 'agy',
    home: { HOME: '', USERPROFILE: '' },
  },
};

// Finds a CLI installed into Software/Frameworks first, then on PATH.
export function cliPath(tool) {
  const t = CLI_TOOLS[tool];
  if (!t) throw new Error(`Unknown CLI tool ${tool}`);
  const local = path.join(PATHS.frameworks, 'node_modules', '.bin', IS_WINDOWS ? `${t.bin}.cmd` : t.bin);
  return fs.existsSync(local) ? local : t.bin;
}

// True when the CLI is installed in Software/Frameworks or anywhere on PATH.
export function cliInstalled(tool) {
  const p = cliPath(tool);
  if (path.isAbsolute(p)) return true;
  const exts = IS_WINDOWS ? ['.cmd', '.exe', '.bat', ''] : [''];
  return (process.env.PATH || '').split(path.delimiter).some((dir) => dir && exts.some((e) => fs.existsSync(path.join(dir, `${p}${e}`))));
}

// Environment variables that point a CLI at one account's login folder.
export function accountEnv(tool, homeDir) {
  const t = CLI_TOOLS[tool];
  if (!t || !homeDir) return {};
  fs.mkdirSync(homeDir, { recursive: true });
  const env = {};
  for (const [key, sub] of Object.entries(t.home)) {
    env[key] = sub ? path.join(homeDir, sub) : homeDir;
    fs.mkdirSync(env[key], { recursive: true });
  }
  return env;
}
