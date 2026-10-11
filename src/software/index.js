// Installs the browsers and tools into the project's Software folder, so the app does not
// depend on what is installed on the computer. Each installer is idempotent.
//
//   chrome      consumer Google Chrome, unpacked from Google's official installer (portable copy)
//   firefox     Playwright's Firefox build (the Firefox Playwright can drive)
//   camoufox    Camoufox browser (camoufox-js fetch)
//   invisible   Python venv + invisible-playwright + its patched Firefox engine
//   vulpineos   VulpineOS browser bundle (manual download for now)
//   rclone      rclone binary for Google Drive sync
//   ai-clis     Codex, Claude Code, Gemini CLI and OpenCode, installed into Software/Frameworks
//   autohotkey  prerequisite on Windows (checked, installed with winget on request)
//   claude-extension  Claude in Chrome, from the Chrome Web Store, added to every new Chrome profile
//   whisper     OpenAI Whisper speech to text, in its own Python venv with ffmpeg beside it
//   whisper-gpu Whisper on the GPU on Windows (Const-me's DirectCompute command line, ggml models)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { APP_ROOT, SOFTWARE, PATHS, ensureDir } from '../core/paths.js';
import { config } from '../core/env.js';
import { run, IS_WINDOWS, IS_MAC, which, findAutoHotkey, openTerminal } from '../core/commands.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';
import { findChrome, isInRepo } from '../browsers/chrome.js';
import { firefoxInstalled, camoufoxExecutable, vulpineExecutable } from '../browsers/firefox-family.js';
import { venvPython } from '../browsers/invisible.js';
import { rcloneExe } from '../sync/rclone.js';
import { cliInstalled, CLI_TOOLS } from '../ai/cli-tools.js';
import { addFromWebStore, findExtension, setDefaultExtension } from '../extensions/index.js';

const log = logger('software');
const running = new Map();

async function download(url, dest, { method = 'GET', body, headers } = {}) {
  ensureDir(path.dirname(dest));
  log.ok(`Downloading ${url}`);
  const res = await fetch(url, { method, body, headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}

async function sevenZip() {
  const { path7za } = await import('7zip-bin');
  if (!IS_WINDOWS) fs.chmodSync(path7za, 0o755);
  return path7za;
}

async function extract7z(archive, outDir) {
  const exe = await sevenZip();
  const res = await run(exe, ['x', '-y', archive, `-o${outDir}`], { quiet: true });
  if (!res.ok) throw new Error(`Could not extract ${path.basename(archive)}: ${res.stderr || res.stdout}`);
}

const tmpDir = () => ensureDir(path.join(os.tmpdir(), `alpha-install-${crypto.randomUUID()}`));

// ---- Chrome ------------------------------------------------------------------------------
// Asks Google's update server (Omaha) for the current stable Chrome installer.
async function chromeWindowsInstallerUrl() {
  const id = () => `{${crypto.randomUUID().toUpperCase()}}`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<request protocol="3.0" updater="Omaha" updaterversion="1.3.36.372" shell_version="1.3.36.352" ismachine="0" sessionid="${id()}" installsource="ondemand" requestid="${id()}" dedup="cr">
  <hw physmemory="16" sse="1" sse2="1" sse3="1" ssse3="1" sse41="1" sse42="1" avx="1"/>
  <os platform="win" version="10.0.19045.0" sp="" arch="x64"/>
  <app appid="{8A69D345-D564-463C-AFF1-A69D9E530F96}" version="" nextversion="" ap="x64-stable-multi-chrome" lang="en" brand="GGLS" installage="-1" installdate="-1">
    <updatecheck/>
  </app>
</request>`;
  const res = await fetch('https://tools.google.com/service/update2', { method: 'POST', body, headers: { 'content-type': 'application/xml' } });
  const xml = await res.text();
  const codebases = [...xml.matchAll(/codebase="([^"]+)"/g)].map((m) => m[1]);
  const pkg = xml.match(/<package[^>]*name="([^"]+)"/)?.[1];
  const version = xml.match(/<manifest[^>]*version="([^"]+)"/)?.[1];
  const base = codebases.find((c) => c.startsWith('https://dl.google.com')) || codebases.find((c) => c.startsWith('https://'));
  if (!base || !pkg) throw new Error('Google update server did not return a Chrome installer');
  return { url: `${base}${pkg}`, version };
}

async function installChrome() {
  const dest = SOFTWARE.chrome;
  const tmp = tmpDir();
  try {
    if (IS_WINDOWS) {
      const { url, version } = await chromeWindowsInstallerUrl();
      const installer = await download(url, path.join(tmp, 'chrome_installer.exe'));
      // The official installer is a 7-Zip archive holding chrome.7z, which holds Chrome-bin/.
      await extract7z(installer, path.join(tmp, 'outer'));
      const inner = path.join(tmp, 'outer', 'chrome.7z');
      if (!fs.existsSync(inner)) throw new Error('chrome.7z was not found inside the installer');
      fs.rmSync(dest, { recursive: true, force: true });
      await extract7z(inner, dest);
      log.ok(`Installed Google Chrome ${version} into Software/Chrome`);
    } else if (IS_MAC) {
      const dmg = await download('https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg', path.join(tmp, 'chrome.dmg'));
      const mount = path.join(tmp, 'mnt');
      ensureDir(mount);
      const attach = await run('hdiutil', ['attach', '-nobrowse', '-mountpoint', mount, dmg]);
      if (!attach.ok) throw new Error('Could not open the Chrome disk image');
      fs.rmSync(dest, { recursive: true, force: true });
      ensureDir(dest);
      await run('cp', ['-R', path.join(mount, 'Google Chrome.app'), dest]);
      await run('hdiutil', ['detach', mount]);
      log.ok('Installed Google Chrome into Software/Chrome');
    } else {
      const deb = await download('https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb', path.join(tmp, 'chrome.deb'));
      fs.rmSync(dest, { recursive: true, force: true });
      ensureDir(dest);
      if (await which('dpkg-deb')) {
        await run('dpkg-deb', ['-x', deb, dest]);
      } else {
        await extract7z(deb, path.join(tmp, 'deb'));
        const data = fs.readdirSync(path.join(tmp, 'deb')).find((f) => f.startsWith('data.tar'));
        await extract7z(path.join(tmp, 'deb', data), path.join(tmp, 'data'));
        const tar = fs.readdirSync(path.join(tmp, 'data')).find((f) => f.endsWith('.tar'));
        await extract7z(path.join(tmp, 'data', tar), dest);
      }
      log.ok('Installed Google Chrome into Software/Chrome');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- Others ------------------------------------------------------------------------------
async function installFirefox() {
  const cli = path.join(APP_ROOT, 'node_modules', 'playwright-core', 'cli.js');
  const res = await run(process.execPath, [cli, 'install', 'firefox'], { env: { PLAYWRIGHT_BROWSERS_PATH: SOFTWARE.firefox }, timeout: 20 * 60000 });
  if (!res.ok) throw new Error(`Playwright could not install Firefox: ${res.stderr.slice(-800)}`);
  log.ok('Installed Playwright Firefox into Software/Firefox');
}

async function installCamoufox() {
  const cli = path.join(APP_ROOT, 'node_modules', 'camoufox-js', 'dist', '__main__.js');
  const res = await run(process.execPath, [cli, 'fetch'], { env: { CAMOUFOX_INSTALL_DIR: process.env.CAMOUFOX_INSTALL_DIR }, timeout: 20 * 60000 });
  if (!res.ok) throw new Error(`Camoufox download failed: ${res.stderr.slice(-800)}`);
  log.ok('Installed Camoufox into Software/Camoufox');
}

async function findPython() {
  const candidates = [config.pythonPath, ...(IS_WINDOWS ? ['py'] : []), 'python3.13', 'python3.12', 'python3.11', 'python3', 'python'].filter(Boolean);
  for (const c of candidates) {
    const args = c === 'py' ? ['-3', '--version'] : ['--version'];
    const res = await run(c, args, { quiet: true });
    const m = `${res.stdout}${res.stderr}`.match(/Python (\d+)\.(\d+)/);
    if (res.ok && m && (Number(m[1]) > 3 || Number(m[2]) >= 11)) return c === 'py' ? ['py', '-3'] : [c];
  }
  throw new Error('Python 3.11 or newer is required (Invisible Playwright and Whisper). Install it or set PYTHON_PATH.');
}

async function installInvisible() {
  const venv = path.join(SOFTWARE.invisible, 'venv');
  if (!venvPython()) {
    const [py, ...pre] = await findPython();
    ensureDir(SOFTWARE.invisible);
    const res = await run(py, [...pre, '-m', 'venv', venv]);
    if (!res.ok) throw new Error(`Could not create the Python venv: ${res.stderr}`);
  }
  const python = venvPython();
  let res = await run(python, ['-m', 'pip', 'install', '--upgrade', 'pip', 'invisible-playwright'], { timeout: 20 * 60000 });
  if (!res.ok) throw new Error(`pip install failed: ${res.stderr.slice(-800)}`);
  res = await run(python, ['-m', 'invisible_playwright', 'fetch'], { timeout: 30 * 60000, env: { INVISIBLE_PLAYWRIGHT_CACHE_DIR: process.env.INVISIBLE_PLAYWRIGHT_CACHE_DIR } });
  if (!res.ok) throw new Error(`Engine download failed: ${res.stderr.slice(-800)}`);
  log.ok('Installed Invisible Playwright into Software/Invisible-Playwright');
}

async function installRclone() {
  const osName = IS_WINDOWS ? 'windows' : IS_MAC ? 'osx' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const tmp = tmpDir();
  try {
    const zip = await download(`https://downloads.rclone.org/rclone-current-${osName}-${arch}.zip`, path.join(tmp, 'rclone.zip'));
    await extract7z(zip, tmp);
    const folder = fs.readdirSync(tmp).find((f) => f.startsWith('rclone-') && fs.statSync(path.join(tmp, f)).isDirectory());
    const bin = IS_WINDOWS ? 'rclone.exe' : 'rclone';
    ensureDir(SOFTWARE.rclone);
    fs.copyFileSync(path.join(tmp, folder, bin), path.join(SOFTWARE.rclone, bin));
    if (!IS_WINDOWS) fs.chmodSync(path.join(SOFTWARE.rclone, bin), 0o755);
    log.ok('Installed rclone into Software/rclone');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function installAiClis() {
  ensureDir(PATHS.frameworks);
  const pkgFile = path.join(PATHS.frameworks, 'package.json');
  if (!fs.existsSync(pkgFile)) fs.writeFileSync(pkgFile, JSON.stringify({ name: 'alpha-frameworks', private: true }, null, 2));
  const pkgs = Object.values(CLI_TOOLS).map((t) => t.npm).filter(Boolean);
  const res = await run(IS_WINDOWS ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', ...pkgs], { cwd: PATHS.frameworks, shell: IS_WINDOWS, timeout: 20 * 60000 });
  if (!res.ok) throw new Error(`npm install failed: ${res.stderr.slice(-800)}`);
  log.ok('Installed AI command-line tools into Software/Frameworks', { packages: pkgs });
}

async function installVulpine() {
  openTerminal(IS_WINDOWS ? 'start https://github.com/VulpineOS/VulpineOS/releases' : 'echo "Download the Vulpine browser bundle from https://github.com/VulpineOS/VulpineOS/releases and extract it into Software/VulpineOS"', { title: 'VulpineOS' });
  throw new Error('VulpineOS has no automatic installer for this platform yet. Download its browser bundle from the VulpineOS releases page and extract it into Software/VulpineOS (or set VULPINE_PATH).');
}

async function installAutoHotkey() {
  if (!IS_WINDOWS) throw new Error('AutoHotkey is Windows-only');
  openTerminal('winget install --id AutoHotkey.AutoHotkey -e', { title: 'Install AutoHotkey v2' });
}

// Claude in Chrome. Override the id with CLAUDE_EXTENSION_ID if the store listing changes.
export const CLAUDE_EXTENSION_ID = process.env.CLAUDE_EXTENSION_ID || 'fcoeoabgfenejglbffodgkkbkcdhcgfn';

async function installClaudeExtension() {
  const ext = await addFromWebStore(CLAUDE_EXTENSION_ID, 'Claude');
  if (!/claude/i.test(ext.title)) log.warn(`The downloaded extension is called "${ext.title}"; check CLAUDE_EXTENSION_ID`);
  setDefaultExtension('chrome', ext.name, true);
}

// OpenAI Whisper (speech to text). Its own venv in Software/Whisper, with an ffmpeg binary
// (from imageio-ffmpeg) copied into the venv, and a `whisper` launcher that puts both on PATH.
const whisperBin = () => path.join(SOFTWARE.whisper, 'venv', IS_WINDOWS ? 'Scripts' : 'bin');
export const whisperLauncher = () => path.join(SOFTWARE.whisper, IS_WINDOWS ? 'whisper.cmd' : 'whisper');

function whisperStatus() {
  const bin = whisperBin();
  const ready = [IS_WINDOWS ? 'whisper.exe' : 'whisper', IS_WINDOWS ? 'ffmpeg.exe' : 'ffmpeg'].every((f) => fs.existsSync(path.join(bin, f)));
  return { installed: ready && fs.existsSync(whisperLauncher()), path: ready ? whisperLauncher() : null };
}

async function installWhisper() {
  const bin = whisperBin();
  const python = path.join(bin, IS_WINDOWS ? 'python.exe' : 'python');
  if (!fs.existsSync(python)) {
    const [py, ...pre] = await findPython();
    ensureDir(SOFTWARE.whisper);
    const res = await run(py, [...pre, '-m', 'venv', path.join(SOFTWARE.whisper, 'venv')]);
    if (!res.ok) throw new Error(`Could not create the Python venv: ${res.stderr}`);
  }
  let res = await run(python, ['-m', 'pip', 'install', '--upgrade', 'pip', 'openai-whisper', 'imageio-ffmpeg'], { timeout: 40 * 60000 });
  if (!res.ok) throw new Error(`pip install failed: ${res.stderr.slice(-800)}`);
  // Whisper calls `ffmpeg` by name, so the bundled binary is copied in under that name.
  res = await run(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { quiet: true });
  if (!res.ok) throw new Error(`ffmpeg was not found: ${res.stderr.slice(-800)}`);
  const ffmpeg = path.join(bin, IS_WINDOWS ? 'ffmpeg.exe' : 'ffmpeg');
  fs.copyFileSync(res.stdout.trim(), ffmpeg);
  if (IS_WINDOWS) {
    fs.writeFileSync(whisperLauncher(), '@echo off\r\nset "PATH=%~dp0venv\\Scripts;%PATH%"\r\n"%~dp0venv\\Scripts\\whisper.exe" %*\r\n');
  } else {
    fs.chmodSync(ffmpeg, 0o755);
    fs.writeFileSync(whisperLauncher(), '#!/bin/sh\nd="$(cd "$(dirname "$0")" && pwd)"\nPATH="$d/venv/bin:$PATH" exec "$d/venv/bin/whisper" "$@"\n', { mode: 0o755 });
  }
  log.ok('Installed Whisper into Software/Whisper', { launcher: whisperLauncher() });
}

// Whisper on the GPU (Windows): Const-me's Whisper command line (main.exe and Whisper.dll, the
// engine behind Whisper Desktop). It runs ggml models through DirectCompute on any DirectX 11
// GPU, Intel Arc included. Models come from WHISPER_MODELS_DIR (such as Whisper Desktop's
// folder), else Software/Whisper-GPU/models, where the installer puts ggml-base.en if empty.
const WHISPER_GPU_URL = () => config.get('WHISPER_GPU_URL', 'https://github.com/Const-me/Whisper/releases/download/1.12.0/cli.zip');
const WHISPER_GPU_MODEL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

function findFile(dir, name, depth = 3) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory() && depth > 0) {
      const found = findFile(p, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

export const whisperGpuExe = () => findFile(path.join(SOFTWARE.whisperGpu, 'cli'), 'main.exe');
export const whisperModelsDir = () => config.get('WHISPER_MODELS_DIR') || path.join(SOFTWARE.whisperGpu, 'models');
export function whisperGpuModels() {
  const dir = whisperModelsDir();
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^ggml-.+\.bin$/i.test(f)).map((f) => path.join(dir, f)) : [];
}

async function installWhisperGpu() {
  if (!IS_WINDOWS) throw new Error('GPU Whisper uses DirectCompute and runs on Windows only. Use Whisper (CPU) on this computer.');
  const tmp = tmpDir();
  try {
    const zip = await download(WHISPER_GPU_URL(), path.join(tmp, 'cli.zip'));
    const dest = path.join(SOFTWARE.whisperGpu, 'cli');
    fs.rmSync(dest, { recursive: true, force: true });
    await extract7z(zip, dest);
    if (!whisperGpuExe()) throw new Error(`main.exe was not found in ${WHISPER_GPU_URL()}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!whisperGpuModels().length) {
    await download(WHISPER_GPU_MODEL, path.join(SOFTWARE.whisperGpu, 'models', 'ggml-base.en.bin'));
  }
  log.ok('Installed GPU Whisper into Software/Whisper-GPU', { exe: whisperGpuExe(), models: whisperGpuModels().map((m) => path.basename(m)) });
}

export const SOFTWARE_ITEMS = {
  chrome: { label: 'Google Chrome', install: installChrome, status: () => { const p = findChrome(); return { installed: Boolean(p), path: p, inRepo: isInRepo(p) }; } },
  firefox: { label: 'Firefox (Playwright build)', install: installFirefox, status: () => ({ installed: firefoxInstalled() }) },
  camoufox: { label: 'Camoufox', install: installCamoufox, status: () => { const p = camoufoxExecutable(); return { installed: Boolean(p), path: p }; } },
  invisible: { label: 'Invisible Playwright', install: installInvisible, status: () => { const p = venvPython(); return { installed: Boolean(p) && fs.existsSync(process.env.INVISIBLE_PLAYWRIGHT_CACHE_DIR), path: p }; } },
  vulpineos: { label: 'VulpineOS', install: installVulpine, status: () => { const p = vulpineExecutable(); return { installed: Boolean(p), path: p, manual: true }; } },
  rclone: { label: 'rclone', install: installRclone, status: () => { const p = rcloneExe(); return { installed: Boolean(p), path: p }; } },
  'ai-clis': {
    label: 'AI CLIs (Codex, Claude Code, Gemini, OpenCode)',
    install: installAiClis,
    status: () => {
      const tools = Object.fromEntries(Object.keys(CLI_TOOLS).map((t) => [t, cliInstalled(t)]));
      return { installed: tools.codex && tools.claude, tools };
    },
  },
  autohotkey: { label: 'AutoHotkey v2 (prerequisite)', install: installAutoHotkey, status: () => { const p = findAutoHotkey(); return { installed: Boolean(p), path: p, windowsOnly: true }; } },
  'claude-extension': {
    label: 'Claude in Chrome (extension, added to every new Chrome profile)',
    install: installClaudeExtension,
    status: () => { const e = findExtension('chrome', 'Claude'); return { installed: Boolean(e), path: e?.path ?? null, version: e?.version ?? null }; },
  },
  whisper: { label: 'Whisper (OpenAI speech to text)', install: installWhisper, status: whisperStatus },
  'whisper-gpu': {
    label: 'Whisper on the GPU (Windows, DirectX 11)',
    install: installWhisperGpu,
    status: () => { const p = whisperGpuExe(); return { installed: Boolean(p) && whisperGpuModels().length > 0, path: p, models: whisperGpuModels().map((m) => path.basename(m)), windowsOnly: true }; },
  },
};

export function softwareStatus() {
  return Object.entries(SOFTWARE_ITEMS).map(([id, item]) => {
    let st;
    try {
      st = item.status();
    } catch (err) {
      st = { installed: false, error: err.message };
    }
    return { id, label: item.label, installing: running.has(id), ...st };
  });
}

export async function installSoftware(id) {
  const item = SOFTWARE_ITEMS[id];
  if (!item) throw new Error(`Unknown software ${id}`);
  if (running.has(id)) return running.get(id);
  emit('software.installing', { id });
  const p = (async () => {
    try {
      await item.install();
      emit('software.installed', { id });
    } catch (err) {
      log.fail(`Installing ${item.label} failed`, err);
      emit('software.failed', { id, error: err.message });
      throw err;
    } finally {
      running.delete(id);
    }
  })();
  running.set(id, p);
  return p;
}

export async function installAll() {
  for (const id of ['rclone', 'chrome', 'firefox', 'camoufox', 'invisible', 'ai-clis', 'claude-extension']) {
    try {
      await installSoftware(id);
    } catch {
      // keep going; each failure is logged
    }
  }
  return softwareStatus();
}
