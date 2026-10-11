// Identifies this computer: a stable machine id and a readable device name.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS, ensureDir } from './paths.js';
import { run, IS_WINDOWS, IS_MAC } from './commands.js';

let cached = null;

async function rawMachineId() {
  try {
    if (IS_WINDOWS) {
      const res = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { quiet: true });
      const m = res.stdout.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
      if (m) return m[1];
    } else if (IS_MAC) {
      const res = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { quiet: true });
      const m = res.stdout.match(/"IOPlatformUUID" = "([\w-]+)"/);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(f)) {
          const v = fs.readFileSync(f, 'utf8').trim();
          if (v) return v;
        }
      }
    }
  } catch {
    // fall through to the stored id
  }
  // Fallback: a random id stored once for this install.
  const file = path.join(ensureDir(PATHS.state), 'machine-id');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomUUID());
  return fs.readFileSync(file, 'utf8').trim();
}

export async function machineInfo() {
  if (cached) return cached;
  const raw = await rawMachineId();
  cached = {
    // Hashed so the raw OS GUID never leaves the machine; still stable across runs.
    machineId: crypto.createHash('sha256').update(`alpha-sales:${raw}`).digest('hex').slice(0, 32),
    deviceName: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()}`,
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    user: os.userInfo().username,
  };
  return cached;
}
