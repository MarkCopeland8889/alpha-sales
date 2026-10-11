// REST API used by the control panel. Every system function has an endpoint here.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, readEnvForUi, saveEnv } from '../core/env.js';
import { PATHS, BROWSER_FOLDERS } from '../core/paths.js';
import { appVersion, updateApp, RESTART_EXIT_CODE } from '../core/version.js';
import { machineInfo } from '../core/machine.js';
import { recentLogs, listLogFiles, readLogFile, RUN_FILE, logger } from '../core/logbook.js';
import { shell, powershell, admin, ahk } from '../core/commands.js';
import { db } from '../db/index.js';
import * as auth from '../auth/session.js';
import { onLogin, onLogout, shutdown } from '../engine.js';
import * as devices from '../devices/registry.js';
import * as projects from '../projects/index.js';
import * as profiles from '../profiles/index.js';
import * as browsers from '../browsers/index.js';
import * as proxies from '../proxies/index.js';
import * as configs from '../configs/index.js';
import * as extensions from '../extensions/index.js';
import * as accounts from '../accounts/index.js';
import { ai } from '../ai/index.js';
import { listScrapers, createScraperTemplate } from '../scrapers/index.js';
import * as jobs from '../jobs/index.js';
import { queueRun, stopRun } from '../jobs/queue.js';
import { activeRuns, abortAllRuns } from '../jobs/runner.js';
import { validateSchedule, upcoming } from '../jobs/scheduler.js';
import * as hitl from '../scrapers/hitl.js';
import * as guardrails from '../guardrails/index.js';
import * as sync from '../sync/rclone.js';
import { softwareStatus, installSoftware } from '../software/index.js';
import { apiToken } from './security.js';
import { kryptonRouter } from '../workflows/krypton/api.js';

const log = logger('api');
export const api = express.Router();

// Wraps async handlers: JSON result, or { error } with a sensible status.
const h = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    const status = err.status || (/not found/i.test(err.message) ? 404 : 400);
    if (status >= 500 || status === 400) log.warn(`${req.method} ${req.path}: ${err.message}`);
    if (!res.headersSent) res.status(status).json({ error: err.message });
  }
};
const uid = () => auth.requireUser().id;

// ---- Status, auth ------------------------------------------------------------------------
api.get('/token', (req, res) => res.json({ token: apiToken() }));

api.get('/status', h(async () => {
  const v = await appVersion();
  const m = await machineInfo();
  return {
    version: v,
    machine: m,
    user: auth.currentUser(),
    authMode: auth.authMode(),
    dbMode: db.mode,
    deviceStatus: devices.currentStatus(),
    sessions: browsers.listSessions().length,
    activeRuns: activeRuns(),
    openHumanRequests: hitl.openRequests().length,
    killSwitch: guardrails.getGuardrails().killSwitch,
    logFile: path.relative(PATHS.root, RUN_FILE),
    dataRoot: PATHS.root,
  };
}));

api.post('/auth/google', h(async (req) => ({ url: await auth.startGoogleLogin(`http://${req.headers.host}/auth/callback`) })));
api.post('/auth/local', h(async (req) => {
  const user = await auth.localLogin(req.body?.name);
  await onLogin(user);
  return { user };
}));
api.post('/auth/logout', h(async () => {
  await onLogout();
  await auth.logout();
}));

// ---- Computers ---------------------------------------------------------------------------
api.get('/devices', h(async () => devices.listDevices(uid())));
api.post('/devices/status', h(async (req) => devices.setStatus(req.body.status, req.body.reason)));

// ---- Projects ----------------------------------------------------------------------------
api.get('/projects', h(async () => ({ projects: await projects.listProjects(uid()), suggested: projects.SUGGESTED_VARIABLES })));
api.post('/projects', h(async (req) => projects.saveProject(uid(), req.body)));
api.delete('/projects/:id', h(async (req) => projects.deleteProject(uid(), req.params.id)));

// ---- Browsers, profiles, sessions --------------------------------------------------------
api.get('/browsers', h(async () => ({ info: browsers.BROWSER_INFO, available: browsers.browserAvailability(), folders: BROWSER_FOLDERS })));
api.get('/profiles', h(async (req) => profiles.listProfiles(req.query.browser || undefined)));
api.post('/profiles', h(async (req) => profiles.createProfile(req.body)));
api.patch('/profiles/:browser/:name', h(async (req) => profiles.updateProfile(req.params.browser, req.params.name, req.body)));
api.delete('/profiles/:browser/:name', h(async (req) => profiles.deleteProfile(req.params.browser, req.params.name)));
api.post('/profiles/:browser/:name/open', h(async (req) => {
  const s = await browsers.openBrowser({ browser: req.params.browser, profile: req.params.name, createIfMissing: false, ...req.body });
  return s.info();
}));

api.get('/sessions', h(async () => browsers.listSessions()));
api.post('/sessions/:id/close', h(async (req) => browsers.closeSession(req.params.id)));
api.post('/sessions/:id/goto', h(async (req) => {
  const page = await browsers.getSession(req.params.id).goto(req.body.url);
  return { url: typeof page.url === 'function' ? await page.url() : null };
}));
api.get('/sessions/:id/screenshot', h(async (req, res) => {
  const file = await browsers.getSession(req.params.id).screenshot();
  res.type('png').send(fs.readFileSync(file));
}));
api.post('/sessions/:id/cookies/export', h(async (req) => {
  const s = browsers.getSession(req.params.id);
  const file = req.body.file || path.join(PATHS.localFiles, 'Cookies', `${s.browser}_${s.profile}.json`);
  return { count: await s.exportCookies(file), file };
}));

// ---- Proxies -----------------------------------------------------------------------------
api.get('/proxies', h(async () => proxies.listProxies(uid())));
api.post('/proxies', h(async (req) => proxies.saveProxy(uid(), req.body)));
api.post('/proxies/import', h(async (req) => proxies.importProxies(uid(), req.body.text || '', req.body.type)));
api.delete('/proxies/:id', h(async (req) => proxies.deleteProxy(uid(), req.params.id)));
api.post('/proxies/:id/test', h(async (req) => proxies.testProxy(uid(), req.params.id)));
api.post('/proxies/:id/check', h(async (req) => proxies.checkSites(uid(), req.params.id, req.body.websites || [])));

// ---- Configurations ----------------------------------------------------------------------
api.get('/configs/fields', h(async () => configs.CONFIG_FIELDS));
api.get('/configs/:browser', h(async (req) => configs.listConfigs(req.params.browser)));
api.post('/configs/:browser', h(async (req) => configs.saveConfig(req.params.browser, req.body.name, req.body.data || {})));
api.post('/configs/:browser/generate', h(async (req) => configs.generateConfig(req.params.browser, req.body || {})));
api.delete('/configs/:browser/:name', h(async (req) => configs.deleteConfig(req.params.browser, req.params.name)));

// ---- Extensions --------------------------------------------------------------------------
api.get('/extensions', h(async () => extensions.listExtensions()));
api.post('/extensions', h(async (req) => extensions.addExtension(req.body.kind, req.body.sourcePath, req.body.name)));
api.delete('/extensions/:kind/:name', h(async (req) => extensions.removeExtension(req.params.kind, req.params.name)));
api.post('/extensions/webstore', h(async (req) => {
  const ext = await extensions.addFromWebStore(req.body.id, req.body.name);
  if (req.body.default) extensions.setDefaultExtension('chrome', ext.name, true);
  return ext;
}));
api.post('/extensions/:kind/:name/default', h(async (req) => ({ defaults: extensions.setDefaultExtension(req.params.kind, req.params.name, req.body?.on !== false) })));

// ---- Accounts ----------------------------------------------------------------------------
api.get('/accounts', h(async () => accounts.listAccounts()));
api.post('/accounts', h(async (req) => accounts.saveAccount(req.body)));
api.delete('/accounts/:platform/:username', h(async (req) => accounts.deleteAccount(req.params.platform, req.params.username)));
api.post('/accounts/:platform/:username/open', h(async (req) => {
  const acc = accounts.getAccount(req.params.platform, req.params.username);
  if (!acc || acc.type !== 'web') throw new Error('Web account not found');
  if (!acc.browser || !acc.profile) throw new Error('Link this account to a browser profile first');
  const s = await browsers.openBrowser({ browser: acc.browser, profile: acc.profile, proxyId: acc.proxyId || undefined, startUrl: acc.loginUrl || undefined });
  return s.info();
}));
api.post('/accounts/:platform/:username/login', h(async (req) => accounts.startOAuthLogin(req.params.platform, req.params.username)));

// ---- AI ----------------------------------------------------------------------------------
api.get('/ai/providers', h(async () => ai.listProviders()));
api.get('/ai/capabilities', h(async () => ai.capabilityMatrix()));
api.post('/ai/complete', h(async (req) => ai.complete(req.body)));

// ---- Scrapers, jobs, runs ----------------------------------------------------------------
api.get('/scrapers', h(async () => listScrapers()));
api.post('/scrapers/new', h(async (req) => ({ file: createScraperTemplate(req.body.name) })));
api.post('/scrapers/run', h(async (req) => queueRun(uid(), {
  label: `${req.body.scraper} (ad-hoc)`,
  machineId: req.body.machineId,
  spec: {
    name: `${req.body.scraper} (ad-hoc)`,
    browser: req.body.browser || {},
    controller: req.body.controller || 'basic',
    mode: 'sequential',
    steps: [{ scraper: req.body.scraper, input: req.body.input || {} }],
    projectId: req.body.projectId || null,
  },
})));

api.get('/jobs', h(async () => ({ jobs: await jobs.listJobs(uid()), controllers: jobs.CONTROLLERS, upcoming: upcoming() })));
api.post('/jobs', h(async (req) => {
  if (req.body.schedule) {
    const v = validateSchedule(req.body.schedule);
    if (!v.ok) throw new Error(`Invalid schedule: ${v.error}`);
  }
  return jobs.saveJob(uid(), req.body);
}));
api.delete('/jobs/:id', h(async (req) => jobs.deleteJob(uid(), req.params.id)));
api.post('/jobs/:id/run', h(async (req) => queueRun(uid(), { jobId: req.params.id, machineId: req.body?.machineId })));
api.get('/schedules/validate', h(async (req) => validateSchedule(String(req.query.expr || ''))));

api.get('/runs', h(async (req) => ({ runs: await jobs.listRuns(uid(), { jobId: req.query.jobId, limit: Number(req.query.limit) || 50 }), active: activeRuns() })));
api.get('/runs/:id', h(async (req) => jobs.getRun(uid(), req.params.id)));
api.post('/runs/:id/stop', h(async (req) => stopRun(uid(), req.params.id)));
api.post('/runs/:id/resume', h(async (req) => {
  const run = await jobs.getRun(uid(), req.params.id);
  return queueRun(uid(), { jobId: run.job_id || undefined, spec: run.job_id ? undefined : run.spec, label: `${run.label} (resumed)`, resumeFrom: run.id });
}));

// ---- Workflows ---------------------------------------------------------------------------
api.use('/krypton', kryptonRouter({ h, uid, queueRun }));

// ---- Human-in-the-loop, guardrails -------------------------------------------------------
api.get('/hitl', h(async () => ({
  local: hitl.openRequests(),
  all: await db.select('hitl_requests', { account_id: uid(), status: 'open' }, { order: 'created_at', desc: true }),
})));
api.post('/hitl/:id/resolve', h(async (req) => hitl.resolveRequest(req.params.id, req.body?.resolution || 'done')));
api.post('/hitl/:id/cancel', h(async (req) => hitl.cancel(req.params.id, req.body?.reason || 'Cancelled')));

api.get('/guardrails', h(async () => ({ settings: guardrails.getGuardrails(), usage: guardrails.usageToday() })));
api.put('/guardrails', h(async (req) => guardrails.saveGuardrails(req.body)));
api.post('/guardrails/kill', h(async (req) => {
  const g = guardrails.setKillSwitch(req.body.on);
  if (req.body.on) {
    abortAllRuns('Kill switch');
    await browsers.closeAllSessions();
  }
  return g;
}));

// ---- Google Drive sync -------------------------------------------------------------------
api.get('/sync/status', h(async () => sync.status()));
api.post('/sync/connect', h(async () => sync.connectDrive()));
api.post('/sync/check', h(async (req) => sync.check(req.body.path || '')));
api.post('/sync/update', h(async (req) => sync.update(req.body.path)));
api.post('/sync/update-all', h(async () => sync.updateAll()));
api.post('/sync/pull', h(async () => sync.pull()));
api.post('/sync/archive', h(async (req) => {
  if (!req.body.path) throw new Error('Enter the path of a file or folder to archive');
  return req.body.mode === 'new' ? sync.archive.new(req.body.path) : sync.archive.exist(req.body.path);
}));

// ---- Commands ----------------------------------------------------------------------------
api.post('/commands/run', h(async (req) => {
  const { type = 'shell', command } = req.body;
  if (!command) throw new Error('Enter a command');
  log.warn(`Running ${type} command from the control panel`, { command });
  const runners = { shell, powershell, admin, ahk: (c) => ahk(c) };
  if (!runners[type]) throw new Error(`Unknown command type ${type}`);
  const res = await runners[type](command, { timeout: 10 * 60000 });
  return { code: res.code, ok: res.ok, stdout: res.stdout.slice(-100000), stderr: res.stderr.slice(-20000) };
}));

// ---- Logs --------------------------------------------------------------------------------
api.get('/logs/recent', h(async (req) => recentLogs({ limit: Number(req.query.limit) || 300, scope: req.query.scope, state: req.query.state })));
api.get('/logs/files', h(async () => listLogFiles()));
api.get('/logs/file', h(async (req) => ({ name: req.query.name, text: readLogFile(String(req.query.name || '')) })));

// ---- Software, settings, app -------------------------------------------------------------
api.get('/software', h(async () => softwareStatus()));
api.post('/software/:id/install', h(async (req) => {
  void installSoftware(req.params.id).catch(() => {});
  return { started: true };
}));

api.get('/settings', h(async () => ({ env: readEnvForUi(), dataRoot: PATHS.root, port: config.port })));
api.put('/settings', h(async (req) => {
  saveEnv(req.body || {});
  return { saved: true, restartNeeded: true };
}));

api.post('/app/update', h(async () => {
  await devices.setStatus('updating', 'Installing an update');
  try {
    const res = await updateApp();
    if (res.updated) setTimeout(() => restart(), 500);
    else await devices.setStatus('available');
    return res;
  } catch (err) {
    await devices.setStatus('available');
    throw err;
  }
}));
api.post('/app/restart', h(async () => {
  setTimeout(() => restart(), 300);
  return { restarting: true };
}));

async function restart() {
  await shutdown().catch(() => {});
  process.exit(RESTART_EXIT_CODE);
}
