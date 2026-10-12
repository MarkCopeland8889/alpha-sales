// Control panel API for Krypton: form fields, starting a run, and reading past run reports.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, readJson } from '../../core/paths.js';
import { FIELD_GROUPS, DEFAULTS } from './settings.js';

// Test 1 from the workflow doc: "Need a bookkeeper", remote bookkeeping firm, defaults.
export const TEST_1 = {
  business_type: 'Bookkeeping firm',
  business_name: 'Remote Bookkeeping Firm',
  business_description: 'A fully remote bookkeeping firm. We keep the books for small businesses online: monthly bookkeeping, bank and card reconciliations, payroll support and clean year-end files for their accountant.',
  search_terms: 'Need a bookkeeper',
};

// Long runs: LinkedIn pages are read at a human pace, and daily limits spread the work.
export const KRYPTON_MAX_RUN_MINUTES = 720;

const kryptonRoot = () => path.join(PATHS.localFiles, 'Krypton');

function runDir(name) {
  if (!/^Run [\w .-]+$/.test(name) || name.includes('..')) throw Object.assign(new Error('Unknown run'), { status: 404 });
  const dir = path.join(kryptonRoot(), name);
  if (!fs.existsSync(dir)) throw Object.assign(new Error('Run not found'), { status: 404 });
  return dir;
}

function summary(name) {
  const dir = path.join(kryptonRoot(), name);
  const cfg = readJson(path.join(dir, 'Config', 'config.json'), {});
  const plan = readJson(path.join(dir, 'Config', 'plan.json'), {});
  const lv = (file, level) => (readJson(path.join(dir, 'Results', file), []) || []).filter((x) => x.level === level).length;
  return {
    name,
    folder: dir,
    business: cfg.business_name || '',
    terms: plan.terms?.length ?? 0,
    created: fs.statSync(dir).birthtime || fs.statSync(dir).mtime,
    updated: fs.statSync(dir).mtime,
    hasReport: fs.existsSync(path.join(dir, 'Report.md')),
    people1: lv('People.json', 1),
    people2: lv('People.json', 2),
    jobs1: lv('Jobs.json', 1),
    posts1: lv('Posts.json', 1),
  };
}

export function kryptonRouter({ h, uid, queueRun }) {
  const r = express.Router();
  r.get('/fields', h(async () => ({ groups: FIELD_GROUPS, defaults: DEFAULTS, test1: TEST_1 })));
  r.get('/runs', h(async () => {
    if (!fs.existsSync(kryptonRoot())) return { runs: [] };
    const names = fs.readdirSync(kryptonRoot()).filter((n) => n.startsWith('Run ') && fs.statSync(path.join(kryptonRoot(), n)).isDirectory());
    return { runs: names.map(summary).sort((a, b) => String(b.name).localeCompare(String(a.name))) };
  }));
  r.get('/runs/:name/report', h(async (req) => {
    const dir = runDir(req.params.name);
    const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null);
    return { md: read('Report.md'), html: read('Report.html'), folder: dir };
  }));
  r.post('/run', h(async (req) => {
    const { input = {}, browser = {}, controller = 'basic', projectId = null, machineId } = req.body || {};
    if (!browser.profile) throw new Error('Choose a browser profile that is logged in to LinkedIn');
    return queueRun(uid(), {
      label: `Krypton: ${input.business_name || 'LinkedIn'}`,
      machineId,
      spec: {
        name: 'Krypton',
        browser,
        controller,
        mode: 'sequential',
        maxRunMinutes: KRYPTON_MAX_RUN_MINUTES,
        steps: [{ scraper: 'krypton-linkedin', input }],
        projectId,
      },
    });
  }));
  return r;
}
