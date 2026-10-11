// AI hub: one call for every provider.
//
//   import { ai } from '../ai/index.js';
//   const { text } = await ai.complete({ provider: 'anthropic', model: 'claude-sonnet-5-5',
//                                         reasoning: 'high', system: '...', prompt: '...', files: [] });
//   const items = await ai.json({ provider, prompt: 'Return 50 search terms as a JSON array' });
import anthropic from './providers/anthropic.js';
import { zai, opencodeZen, openai, geminiApi, ollama } from './providers/http.js';
import { codex, claudeCode, geminiCli, opencodeCli, antigravity } from './providers/cli.js';
import { chatgptWeb, geminiWeb, claudeWeb, googleWeb, jev, mock } from './providers/web.js';
import { AI_FUNCTIONS, PROVIDER_CAPABILITIES } from './capabilities.js';
import { logger } from '../core/logbook.js';

const log = logger('ai');

const PROVIDERS = [anthropic, geminiApi, zai, opencodeZen, openai, ollama, codex, claudeCode, geminiCli, opencodeCli, antigravity,
  chatgptWeb, geminiWeb, claudeWeb, googleWeb, jev, mock];
const byId = new Map(PROVIDERS.map((p) => [p.id, p]));

// Adds a provider at runtime (plugins, or a scripted provider in tests).
export function registerProvider(p) {
  if (!p?.id || typeof p.complete !== 'function') throw new Error('A provider needs an id and complete()');
  if (!byId.has(p.id)) PROVIDERS.push(p);
  else PROVIDERS.splice(PROVIDERS.indexOf(byId.get(p.id)), 1, p);
  byId.set(p.id, p);
}

export function getProvider(id) {
  const p = byId.get(id);
  if (!p) throw new Error(`Unknown AI provider "${id}"`);
  return p;
}

export function listProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    models: p.models,
    defaultModel: p.defaultModel,
    reasoningLevels: p.reasoningLevels,
    envKey: p.envKey ?? null,
    tool: p.tool ?? null,
    available: Boolean(p.available()),
    capabilities: PROVIDER_CAPABILITIES[p.id] || {},
  }));
}

export function capabilityMatrix() {
  return { functions: AI_FUNCTIONS, providers: listProviders().map(({ id, label, kind, capabilities }) => ({ id, label, kind, capabilities })) };
}

async function complete(req) {
  const provider = getProvider(req.provider || 'anthropic');
  const started = Date.now();
  const attempts = Math.max(1, req.retries ?? 1);
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await provider.complete(req);
      log.ok(`${provider.label} answered in ${Date.now() - started}ms`, { model: res.model, chars: res.text?.length, usage: res.usage });
      return { provider: provider.id, ...res };
    } catch (err) {
      lastErr = err;
      log.warn(`${provider.label} attempt ${i}/${attempts} failed`, { error: err.message });
    }
  }
  throw lastErr;
}

// Asks for JSON and parses it (tolerates ```json fences and surrounding prose).
export function parseJson(text) {
  const raw = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
  if (start < 0 || end < start) throw new Error('The AI did not return JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

async function json(req) {
  const res = await complete({ ...req, system: `${req.system ? `${req.system}\n\n` : ''}Reply with valid JSON only, no commentary.` });
  return parseJson(res.text);
}

export const ai = { complete, json, parseJson, listProviders, capabilityMatrix, getProvider, registerProvider };
