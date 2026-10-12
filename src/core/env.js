// Loads .env and exposes typed settings. Also points third-party tools at the
// in-repo Software folder so every browser lives inside the project, not the OS.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { APP_ROOT, SOFTWARE } from './paths.js';

export const ENV_FILE = path.join(APP_ROOT, '.env');
dotenv.config({ path: ENV_FILE, quiet: true });

// Keep downloaded engines inside Software/ (blueprint: "not rely on outside software").
process.env.PLAYWRIGHT_BROWSERS_PATH ||= SOFTWARE.firefox;
process.env.CAMOUFOX_INSTALL_DIR ||= path.join(SOFTWARE.camoufox, 'browser');
process.env.INVISIBLE_PLAYWRIGHT_CACHE_DIR ||= path.join(SOFTWARE.invisible, 'engine');

const str = (k, d = '') => (process.env[k] ?? '').trim() || d;
const bool = (k, d = false) => {
  const v = str(k);
  return v ? ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()) : d;
};
const int = (k, d) => Number.parseInt(str(k), 10) || d;

export const config = {
  get port() { return int('ALPHA_PORT', 7300); },
  get host() { return str('ALPHA_HOST', '127.0.0.1'); },
  get secret() { return str('ALPHA_SECRET'); },
  get supabaseUrl() { return str('SUPABASE_URL'); },
  get supabaseKey() { return str('SUPABASE_ANON_KEY'); },
  get useSupabase() { return Boolean(this.supabaseUrl && this.supabaseKey); },
  get googleClientId() { return str('GOOGLE_OAUTH_CLIENT_ID'); },
  get googleClientSecret() { return str('GOOGLE_OAUTH_CLIENT_SECRET'); },
  get rcloneRemote() { return str('RCLONE_REMOTE', 'gdrive'); },
  get rcloneRoot() { return str('RCLONE_ROOT', 'Alpha-Sales'); },
  get rcloneAutoSync() { return bool('RCLONE_AUTO_SYNC', true); },
  get heartbeatSeconds() { return int('ALPHA_HEARTBEAT_SECONDS', 30); },
  get chromePath() { return str('CHROME_PATH'); },
  get vulpinePath() { return str('VULPINE_PATH'); },
  get ahkPath() { return str('AHK_PATH'); },
  get pythonPath() { return str('PYTHON_PATH'); },
  get(key, fallback = '') { return str(key, fallback); },
};

// Keys the Settings page is allowed to show and edit. Secret values are masked when read.
export const EDITABLE_KEYS = [
  ['ALPHA_PORT', 'Port the control panel listens on'],
  ['ALPHA_HOME', 'Optional folder that holds Accounts, Profiles, etc. (defaults to the app folder)'],
  ['ALPHA_SECRET', 'Passphrase used to encrypt saved account passwords', true],
  ['SUPABASE_URL', 'Supabase project URL (empty = local mode)'],
  ['SUPABASE_ANON_KEY', 'Supabase anon/public key', true],
  ['GOOGLE_OAUTH_CLIENT_ID', 'Google OAuth client id (Supabase Google provider / rclone)'],
  ['GOOGLE_OAUTH_CLIENT_SECRET', 'Google OAuth client secret', true],
  ['RCLONE_REMOTE', 'rclone remote name for Google Drive'],
  ['RCLONE_ROOT', 'Folder in Google Drive that holds Alpha-Sales data'],
  ['RCLONE_AUTO_SYNC', 'Push local edits to Drive automatically (true/false)'],
  ['CHROME_PATH', 'Override path to consumer Google Chrome'],
  ['VULPINE_PATH', 'Override path to the VulpineOS browser binary'],
  ['AHK_PATH', 'Override path to AutoHotkey v2 (AutoHotkey64.exe)'],
  ['PYTHON_PATH', 'Python 3.11+ used to create the Invisible Playwright venv'],
  ['WHISPER_MODELS_DIR', 'Folder of ggml Whisper models for GPU Whisper (for example Whisper Desktop\'s folder)'],
  ['WHISPER_GPU_URL', 'Download link for the GPU Whisper command line (Const-me Whisper cli.zip)'],
  ['ANTHROPIC_API_KEY', 'Claude API key', true],
  ['GEMINI_API_KEY', 'Gemini API key', true],
  ['ZAI_API_KEY', 'z.ai API key', true],
  ['OPENCODE_API_KEY', 'OpenCode Zen API key', true],
  ['OPENAI_API_KEY', 'OpenAI API key (optional, OpenAI-compatible provider)', true],
  ['OLLAMA_HOST', 'Ollama server URL'],
  ['JEV_API_KEY', 'TypeSafe Jev API key', true],
  ['JEV_BASE_URL', 'TypeSafe Jev API base URL'],
];

export function readEnvForUi() {
  return EDITABLE_KEYS.map(([key, help, secret]) => {
    const value = process.env[key] ?? '';
    return { key, help, secret: Boolean(secret), set: Boolean(value), value: secret ? '' : value };
  });
}

// Writes key=value pairs into .env (creating it if needed) and applies them to process.env.
export function saveEnv(updates) {
  const allowed = new Set(EDITABLE_KEYS.map(([k]) => k));
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  for (const [key, raw] of Object.entries(updates)) {
    if (!allowed.has(key)) throw new Error(`Setting ${key} cannot be edited from the UI`);
    const value = String(raw ?? '').replace(/[\r\n]/g, '');
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
    process.env[key] = value;
  }
  fs.writeFileSync(ENV_FILE, text);
}
