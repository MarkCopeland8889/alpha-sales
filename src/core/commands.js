// Running commands from inside the app: plain processes, the system shell,
// PowerShell, elevated (administrator) PowerShell, AutoHotkey v2 scripts, and
// visible terminal windows for interactive logins.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './env.js';
import { logger } from './logbook.js';
import { uid } from './utils.js';

const log = logger('commands');
export const IS_WINDOWS = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

// Runs an executable with arguments (no shell). Resolves with { code, stdout, stderr, ok }.
export function run(command, args = [], opts = {}) {
  const { cwd, env, timeout = 0, input, onOutput, quiet = false, windowsHide = true, shell: useShell = false } = opts;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timer;
    let child;
    try {
      // .cmd/.bat files (npm.cmd, npx.cmd) need shell: true on Windows.
      child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide, shell: useShell });
    } catch (err) {
      resolve({ code: -1, stdout, stderr: err.message, ok: false });
      return;
    }
    child.stdout?.on('data', (d) => {
      stdout += d;
      onOutput?.(String(d), 'stdout');
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
      onOutput?.(String(d), 'stderr');
    });
    if (input != null) child.stdin.end(input);
    if (timeout) {
      timer = setTimeout(() => {
        stderr += `\n[timed out after ${timeout}ms]`;
        child.kill();
      }, timeout);
    }
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${err.message}`, ok: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const res = { code, stdout, stderr, ok: code === 0 };
      if (!quiet) {
        const label = `${path.basename(command)} ${args.join(' ')}`.slice(0, 160);
        if (res.ok) log.ok(`Ran: ${label}`);
        else log.warn(`Command exited ${code}: ${label}`, { stderr: stderr.slice(-2000) });
      }
      resolve(res);
    });
  });
}

// Runs a command line through the system shell (cmd.exe on Windows, /bin/sh elsewhere).
export function shell(commandLine, opts = {}) {
  return IS_WINDOWS
    ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], opts)
    : run('/bin/sh', ['-c', commandLine], opts);
}

function powershellExe() {
  if (IS_WINDOWS) return 'powershell.exe';
  return 'pwsh'; // PowerShell 7 on macOS/Linux, if installed
}

// Runs a PowerShell script (multi-line string). Output is forced to UTF-8.
export function powershell(script, opts = {}) {
  const prelude = '$ProgressPreference="SilentlyContinue"; [Console]::OutputEncoding=[Text.Encoding]::UTF8;\n';
  return run(powershellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
    ...opts,
    input: prelude + script,
  });
}

// Runs a PowerShell script as administrator. On Windows this shows the UAC prompt;
// the elevated process writes its output to a temp file that we read back.
export async function admin(script, opts = {}) {
  if (!IS_WINDOWS) {
    // sudo -n fails fast instead of hanging if a password would be needed.
    return run('sudo', ['-n', '/bin/sh', '-c', script], opts);
  }
  const id = uid();
  const tmp = os.tmpdir();
  const scriptFile = path.join(tmp, `alpha-admin-${id}.ps1`);
  const outFile = path.join(tmp, `alpha-admin-${id}.out`);
  const wrapped = `try {\n& {\n${script}\n} *>&1 | Out-File -FilePath '${outFile}' -Encoding utf8\nexit 0\n} catch {\n$_ | Out-File -FilePath '${outFile}' -Encoding utf8 -Append\nexit 1\n}`;
  fs.writeFileSync(scriptFile, wrapped, 'utf8');
  const launcher = `$p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${scriptFile}"'; exit $p.ExitCode`;
  const res = await powershell(launcher, opts);
  let output = '';
  try {
    output = fs.readFileSync(outFile, 'utf8');
  } catch {
    // The user may have declined the UAC prompt.
  }
  for (const f of [scriptFile, outFile]) fs.rm(f, { force: true }, () => {});
  return { ...res, stdout: output || res.stdout };
}

export function findAutoHotkey() {
  const candidates = [
    config.ahkPath,
    'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe',
    'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe',
    'C:\\Program Files\\AutoHotkey\\AutoHotkey64.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'AutoHotkey', 'v2', 'AutoHotkey64.exe'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Runs an AutoHotkey v2 script. `script` is either a path to a .ahk file or inline AHK code.
export async function ahk(script, args = [], opts = {}) {
  const exe = findAutoHotkey();
  if (!exe) throw new Error('AutoHotkey v2 is not installed (a blueprint prerequisite). Install it or set AHK_PATH.');
  let file = script;
  let temp = null;
  if (!fs.existsSync(script)) {
    temp = path.join(os.tmpdir(), `alpha-${uid()}.ahk`);
    fs.writeFileSync(temp, `#Requires AutoHotkey v2.0\n${script}`, 'utf8');
    file = temp;
  }
  const res = await run(exe, ['/ErrorStdOut', file, ...args.map(String)], opts);
  if (temp) fs.rm(temp, { force: true }, () => {});
  return res;
}

// Opens a visible terminal window running a command (used for CLI logins such as `codex login`).
export function openTerminal(commandLine, { cwd, env, title = 'Alpha-Sales' } = {}) {
  const fullEnv = { ...process.env, ...env };
  if (IS_WINDOWS) {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', `"${title}"`, 'cmd.exe', '/k', commandLine], {
      cwd, env: fullEnv, detached: true, stdio: 'ignore', windowsVerbatimArguments: true,
    }).unref();
  } else if (IS_MAC) {
    const exports = Object.entries(env || {}).map(([k, v]) => `export ${k}='${String(v).replace(/'/g, "'\\''")}'; `).join('');
    const cmd = `cd '${cwd || process.cwd()}'; ${exports}${commandLine}`;
    spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmd)}`], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('x-terminal-emulator', ['-e', `bash -lc ${JSON.stringify(`${commandLine}; exec bash`)}`], {
      cwd, env: fullEnv, detached: true, stdio: 'ignore',
    }).on('error', () => log.warn('No terminal emulator found to open'))
      .unref();
  }
  log.ok(`Opened terminal: ${commandLine}`);
}

// Checks whether an executable is reachable (PATH or absolute path).
export async function which(name) {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  const res = IS_WINDOWS ? await run('where', [name], { quiet: true }) : await run('/bin/sh', ['-c', `command -v ${name}`], { quiet: true });
  return res.ok ? res.stdout.split(/\r?\n/)[0].trim() : null;
}
