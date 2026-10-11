// AI for Krypton: picks the provider and model for a tier (fast / medium / power), runs a
// prompt, parses the JSON answer, and keeps a copy of every prompt and answer in AI Runs/.
import fs from 'node:fs';
import { ai } from '../../ai/index.js';
import { MODEL_TIERS, VENDOR_PROVIDERS } from './settings.js';

export function chooseProvider(settings) {
  if (settings.ai_provider) return settings.ai_provider;
  const candidates = VENDOR_PROVIDERS[settings.ai_vendor];
  const ready = candidates.find((id) => {
    try {
      return ai.getProvider(id).available();
    } catch {
      return false;
    }
  });
  if (!ready) {
    throw new Error(`No ${settings.ai_vendor} AI is set up on this computer. Add an API key in Settings or log in a CLI account (${candidates.join(' or ')}).`);
  }
  return ready;
}

export function modelFor(settings, tier) {
  const vendor = settings.ai_vendor;
  const base = MODEL_TIERS[vendor][tier];
  const model = settings[`${tier}_model_${vendor}`] || base.model;
  let { reasoning } = base;
  if (tier === 'power' && settings.extra_power && vendor !== 'gemini') reasoning = 'xhigh';
  return { model, reasoning };
}

export function createAi({ settings, store, log, onUsage }) {
  const provider = chooseProvider(settings);
  // Continue numbering when a run is resumed into the same folder.
  const dir = store.path(['AI Runs']);
  let counter = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;

  // `messages` continues a conversation ([{ role, content }]); otherwise `prompt` is sent.
  async function ask(name, tier, { system, prompt, messages, json = true }) {
    counter += 1;
    const { model, reasoning } = modelFor(settings, tier);
    const req = { provider, model, reasoning, system, ...(messages ? { messages } : { prompt }), retries: 2 };
    if (messages) prompt = messages.map((m) => `### ${m.role}\n\n${m.content}`).join('\n\n');
    const file = `${String(counter).padStart(3, '0')} ${name}.md`;
    const started = Date.now();
    let res;
    try {
      res = await ai.complete(req);
    } catch (err) {
      store.text(['AI Runs', file], record({ name, tier, provider, model, reasoning, system, prompt, error: err.message }));
      throw err;
    }
    onUsage?.(res.usage);
    store.text(['AI Runs', file], record({ name, tier, provider, model: res.model || model, reasoning, system, prompt, answer: res.text, ms: Date.now() - started }));
    log.info(`AI: ${name} (${tier}, ${res.model || model})`);
    if (!json) return res.text;
    try {
      return json === 'raw' ? { data: ai.parseJson(res.text), text: res.text } : ai.parseJson(res.text);
    } catch {
      // One repair attempt: ask the same model to return only the JSON.
      const fixed = await ai.complete({ provider, model, reasoning, retries: 2, system: 'Return only valid JSON. No commentary, no code fences.', prompt: `Convert this answer to the JSON that was requested:\n\n${res.text}` });
      return json === 'raw' ? { data: ai.parseJson(fixed.text), text: fixed.text } : ai.parseJson(fixed.text);
    }
  }

  return { provider, ask, modelFor: (tier) => modelFor(settings, tier) };
}

function record({ name, tier, provider, model, reasoning, system, prompt, answer, error, ms }) {
  return [
    `# ${name}`,
    '',
    `- Tier: ${tier}`,
    `- Provider: ${provider}`,
    `- Model: ${model}${reasoning ? ` (${reasoning})` : ''}`,
    ms != null ? `- Time: ${(ms / 1000).toFixed(1)}s` : null,
    '',
    system ? `## System\n\n${system}\n` : null,
    `## Prompt\n\n${prompt}\n`,
    error ? `## Error\n\n${error}\n` : `## Answer\n\n${answer}\n`,
  ].filter((l) => l !== null).join('\n');
}

// Splits a list into batches of `size` (at least 1).
export function batches(list, size) {
  const n = Math.max(1, Number(size) || 1);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
