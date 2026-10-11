// Scraper registry. A scraper is a module that exports a definition:
//
//   export default {
//     name: 'page-snapshot',             // unique id
//     label: 'Page snapshot',
//     site: '*',                          // website(s) it works on
//     description: '...',
//     inputs: { url: { type: 'string', required: true, label: 'Page URL' } },
//     checkpoints: ['opened', 'saved'],   // named progress points saved to the DB
//     async run(ctx, input) { ... return result; },
//   };
//
// Built-in scrapers live in src/scrapers/builtin. Your own scrapers live in the synced
// Scrapers folder as Scrapers/<name>/scraper.js (or Scrapers/<name>.js) and are reloaded
// every time they run, so edits take effect without restarting.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PATHS } from '../core/paths.js';
import { logger } from '../core/logbook.js';

const log = logger('scrapers');
const BUILTIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'builtin');

function scraperFiles() {
  const files = [];
  for (const f of fs.readdirSync(BUILTIN_DIR)) if (f.endsWith('.js')) files.push({ file: path.join(BUILTIN_DIR, f), source: 'built-in' });
  if (fs.existsSync(PATHS.scrapers)) {
    for (const entry of fs.readdirSync(PATHS.scrapers)) {
      const full = path.join(PATHS.scrapers, entry);
      if (entry.endsWith('.js')) files.push({ file: full, source: 'user' });
      else if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'scraper.js'))) {
        files.push({ file: path.join(full, 'scraper.js'), source: 'user' });
      }
    }
  }
  return files;
}

async function load({ file, source }) {
  const version = fs.statSync(file).mtimeMs;
  const mod = await import(`${pathToFileURL(file).href}?v=${version}`);
  const def = mod.default || mod.scraper;
  if (!def?.name || typeof def.run !== 'function') throw new Error(`${file} does not export a scraper ({ name, run })`);
  return { ...def, source, file };
}

export async function listScrapers() {
  const out = [];
  for (const f of scraperFiles()) {
    try {
      const def = await load(f);
      out.push({
        name: def.name,
        label: def.label || def.name,
        site: def.site || '*',
        description: def.description || '',
        inputs: def.inputs || {},
        checkpoints: def.checkpoints || [],
        needsBrowser: def.needsBrowser !== false,
        source: def.source,
        file: path.relative(PATHS.root, def.file),
      });
    } catch (err) {
      log.warn(`Could not load scraper ${f.file}`, err);
      out.push({ name: path.basename(path.dirname(f.file)), label: path.basename(f.file), error: err.message, source: f.source });
    }
  }
  return out;
}

export async function getScraper(name) {
  for (const f of scraperFiles()) {
    try {
      const def = await load(f);
      if (def.name === name) return def;
    } catch {
      // a broken file should not hide the others
    }
  }
  throw new Error(`Scraper "${name}" not found`);
}

// Fills defaults and checks required inputs.
export function prepareInput(def, input = {}) {
  const out = { ...input };
  for (const [key, spec] of Object.entries(def.inputs || {})) {
    if (out[key] === undefined || out[key] === '') {
      if (spec.default !== undefined) out[key] = spec.default;
      else if (spec.required) throw new Error(`Scraper "${def.name}" needs input "${key}"`);
    }
    if (spec.type === 'number' && out[key] !== undefined) out[key] = Number(out[key]);
    if (spec.type === 'boolean' && typeof out[key] === 'string') out[key] = out[key] === 'true';
    if (spec.type === 'list' && typeof out[key] === 'string') out[key] = out[key].split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

// Starter file for a new user scraper.
export function createScraperTemplate(name) {
  const clean = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const dir = path.join(PATHS.scrapers, clean);
  const file = path.join(dir, 'scraper.js');
  if (fs.existsSync(file)) throw new Error(`Scraper "${clean}" already exists`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `// ${clean}: describe what this scraper does.
export default {
  name: '${clean}',
  label: '${clean}',
  site: 'example.com',
  description: 'Opens a page and saves its title.',
  inputs: {
    url: { type: 'string', required: true, label: 'Page URL', default: 'https://example.com' },
  },
  checkpoints: ['opened', 'saved'],

  async run(ctx, input) {
    const { page } = ctx;
    await page.goto(input.url, { waitUntil: 'domcontentloaded' });
    await ctx.guardCaptcha();                 // pauses for a human if a CAPTCHA shows up
    await ctx.checkpoint('opened', { url: input.url });

    const title = await page.title();
    ctx.store('${clean}').json([ctx.run.label, 'result.json'], { url: input.url, title });
    await ctx.checkpoint('saved', { title });
    ctx.log.ok(\`Saved title: \${title}\`);
    return { title };
  },
};
`);
  log.ok(`Created scraper ${clean}`);
  return path.relative(PATHS.root, file);
}
