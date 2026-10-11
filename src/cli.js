#!/usr/bin/env node
// Alpha-Sales command line.
//   node src/cli.js start              start the engine and open the control panel
//   node src/cli.js update             pull the latest version (quick update command)
//   node src/cli.js install <item|all> install browsers/tools into Software/
//   node src/cli.js software           show what is installed
//   node src/cli.js sync               run the Google Drive sync now
//   node src/cli.js status             show version, machine and login
//   node src/cli.js transcribe <file> [--model base] [--language en] [--cpu|--gpu]   Whisper speech to text
import './core/env.js';
import { spawn } from 'node:child_process';
import { ensureFolders } from './core/paths.js';
import { config } from './core/env.js';
import { IS_WINDOWS, IS_MAC } from './core/commands.js';
import { appVersion, updateApp } from './core/version.js';
import { machineInfo } from './core/machine.js';

const [cmd = 'start', ...args] = process.argv.slice(2);

function openBrowser(url) {
  const opener = IS_WINDOWS ? ['cmd', ['/c', 'start', '', url]] : IS_MAC ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // no desktop browser available
  }
}

async function main() {
  ensureFolders();
  switch (cmd) {
    case 'start': {
      const { boot, shutdown } = await import('./engine.js');
      const { startServer } = await import('./server/index.js');
      await boot();
      await startServer();
      if (!args.includes('--no-open')) openBrowser(`http://localhost:${config.port}`);
      let closing = false;
      const stop = async () => {
        if (closing) return;
        closing = true;
        await shutdown();
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      break;
    }
    case 'update': {
      const res = await updateApp({ onOutput: (t) => process.stdout.write(t) });
      console.log(res.updated ? `Updated ${res.from} -> ${res.to}. Restart Alpha-Sales.` : `Already up to date (${res.to}).`);
      break;
    }
    case 'install': {
      const { installSoftware, installAll, softwareStatus } = await import('./software/index.js');
      if (!args[0] || args[0] === 'all') await installAll();
      else await installSoftware(args[0]);
      console.table(softwareStatus().map(({ id, installed, path }) => ({ id, installed, path })));
      break;
    }
    case 'software': {
      const { softwareStatus } = await import('./software/index.js');
      console.table(softwareStatus().map(({ id, label, installed, path }) => ({ id, label, installed, path })));
      break;
    }
    case 'sync': {
      const { restoreSession } = await import('./auth/session.js');
      const { updateAll } = await import('./sync/rclone.js');
      if (!(await restoreSession())) throw new Error('Log in from the control panel first');
      console.log(await updateAll());
      break;
    }
    case 'status': {
      const v = await appVersion();
      const m = await machineInfo();
      const { restoreSession } = await import('./auth/session.js');
      const user = await restoreSession();
      console.log({ version: v.full, device: m.deviceName, machineId: m.machineId, user: user?.email ?? null, db: config.useSupabase ? 'supabase' : 'local' });
      break;
    }
    case 'transcribe': {
      const { transcribe } = await import('./ai/whisper.js');
      const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
      const file = args.find((a, i) => !a.startsWith('--') && !['--model', '--language'].includes(args[i - 1]));
      if (!file) throw new Error('Usage: node src/cli.js transcribe <file> [--model base] [--language en] [--cpu|--gpu]');
      const engine = args.includes('--gpu') ? 'gpu' : args.includes('--cpu') ? 'cpu' : 'auto';
      const res = await transcribe(file, { model: opt('model', 'base'), language: opt('language', 'en'), engine });
      console.log(res.text);
      console.error(`\n(${res.engine.toUpperCase()} Whisper, ${res.model}, ${(res.ms / 1000).toFixed(1)}s, ${res.segments.length} segments)`);
      break;
    }
    default:
      console.log('Usage: node src/cli.js [start|update|install <item|all>|software|sync|status|transcribe <file>]');
  }
  if (cmd !== 'start') process.exit(0);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
