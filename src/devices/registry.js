// Computers & management: registers this machine under the account, sends a heartbeat
// every 30 seconds with its status, and decides which computers can take delegated jobs.
import { db } from '../db/index.js';
import { config } from '../core/env.js';
import { machineInfo } from '../core/machine.js';
import { appVersion } from '../core/version.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';
import { DEVICE_STATUSES } from '../db/schema.js';

const log = logger('devices');

let timer = null;
let accountId = null;
let manualStatus = null; // set by the user: draining / maintenance / updating / error
let busyCount = 0;
let statusReason = null;

export function currentStatus() {
  if (manualStatus) return manualStatus;
  return busyCount > 0 ? 'busy' : 'available';
}

// Jobs call markBusy()/markIdle() so the status flips between available and busy automatically.
export function markBusy() {
  busyCount += 1;
  void beat();
}
export function markIdle() {
  busyCount = Math.max(0, busyCount - 1);
  void beat();
}

export async function setStatus(status, reason = null) {
  if (!DEVICE_STATUSES.includes(status)) throw new Error(`Unknown status ${status}`);
  manualStatus = status === 'available' || status === 'busy' ? null : status;
  statusReason = reason;
  log.ok(`Status set to ${currentStatus()}`, reason ? { reason } : undefined);
  await beat();
}

// Creates or refreshes this computer's row (its "sub-bucket") under the account.
export async function registerDevice(accId) {
  accountId = accId;
  const m = await machineInfo();
  const v = await appVersion();
  const now = new Date().toISOString();
  const row = await db.upsert('devices', {
    account_id: accId,
    machine_id: m.machineId,
    device_name: m.deviceName,
    platform: m.platform,
    os: m.os,
    app_version: v.full,
    status: currentStatus(),
    last_heartbeat: now,
    last_login: now,
    info: { cpus: m.cpus, memoryGb: m.memoryGb, arch: m.arch, user: m.user },
  }, ['account_id', 'machine_id']);
  log.ok(`Registered ${m.deviceName} (${v.full})`);
  return row;
}

async function beat() {
  if (!accountId) return;
  const m = await machineInfo();
  try {
    await db.update('devices', { account_id: accountId, machine_id: m.machineId }, {
      status: currentStatus(),
      status_reason: statusReason,
      last_heartbeat: new Date().toISOString(),
    });
    emit('device.heartbeat', { machineId: m.machineId, status: currentStatus() });
  } catch (err) {
    log.warn('Heartbeat failed', err);
  }
}

// Starts last on login and runs until the app closes.
export function startHeartbeat(accId) {
  accountId = accId;
  stopHeartbeat();
  timer = setInterval(beat, config.heartbeatSeconds * 1000);
  timer.unref?.();
  void beat();
}

export function stopHeartbeat() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function goOffline() {
  stopHeartbeat();
  if (!accountId) return;
  const m = await machineInfo();
  try {
    await db.update('devices', { account_id: accountId, machine_id: m.machineId }, { status: 'offline', last_heartbeat: new Date().toISOString() });
  } catch {
    // best effort on shutdown
  }
}

export function isOnline(device) {
  if (!device?.last_heartbeat || device.status === 'offline') return false;
  return Date.now() - new Date(device.last_heartbeat).getTime() < config.heartbeatSeconds * 1000 * 3;
}

export async function listDevices(accId) {
  const m = await machineInfo();
  const v = await appVersion();
  const rows = await db.select('devices', { account_id: accId }, { order: 'device_name' });
  return rows.map((d) => ({
    ...d,
    online: isOnline(d),
    isThisMachine: d.machine_id === m.machineId,
    sameVersion: d.app_version === v.full,
  }));
}

// Blueprint rule: computers cannot delegate between each other unless they run the same version.
export async function checkDelegationTarget(accId, machineId) {
  const devices = await listDevices(accId);
  const target = devices.find((d) => d.machine_id === machineId);
  if (!target) return { ok: false, reason: 'That computer is not registered on this account' };
  if (target.isThisMachine) return { ok: true, target };
  if (!target.online) return { ok: false, reason: `${target.device_name} is offline` };
  if (!target.sameVersion) return { ok: false, reason: `${target.device_name} runs ${target.app_version}; update both computers to the same version first` };
  if (!['available', 'busy'].includes(target.status)) return { ok: false, reason: `${target.device_name} is ${target.status}` };
  return { ok: true, target };
}
