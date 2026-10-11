// HTTP API providers: OpenAI-compatible endpoints (z.ai, OpenCode Zen, OpenAI),
// the Gemini API and a local Ollama server. Model lists are suggestions; any model
// name the service accepts can be typed in.
import { readAttachments, toMessages } from '../files.js';

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${data?.error?.message || text.slice(0, 400)}`);
  return data;
}

function openAiCompatible({ id, label, baseEnv, baseDefault, keyEnv, models, defaultModel }) {
  return {
    id,
    label,
    kind: 'api',
    models,
    defaultModel,
    reasoningLevels: ['low', 'medium', 'high'],
    envKey: keyEnv,
    available: () => Boolean(process.env[keyEnv]),
    async complete(req) {
      const base = (process.env[baseEnv] || baseDefault).replace(/\/$/, '');
      const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...toMessages(req)];
      const body = { model: req.model || defaultModel, messages, ...(req.reasoning ? { reasoning_effort: req.reasoning } : {}) };
      const data = await postJson(`${base}/chat/completions`, body, { authorization: `Bearer ${process.env[keyEnv]}` });
      return { text: data.choices?.[0]?.message?.content ?? '', model: data.model, usage: data.usage };
    },
  };
}

export const zai = openAiCompatible({
  id: 'zai',
  label: 'z.ai (GLM)',
  baseEnv: 'ZAI_BASE_URL',
  baseDefault: 'https://api.z.ai/api/paas/v4',
  keyEnv: 'ZAI_API_KEY',
  models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
  defaultModel: 'glm-4.6',
});

export const opencodeZen = openAiCompatible({
  id: 'opencode-zen',
  label: 'OpenCode Zen',
  baseEnv: 'OPENCODE_BASE_URL',
  baseDefault: 'https://opencode.ai/zen/v1',
  keyEnv: 'OPENCODE_API_KEY',
  models: ['claude-sonnet-5-5', 'gpt-5', 'qwen3-coder'],
  defaultModel: 'claude-sonnet-5-5',
});

export const openai = openAiCompatible({
  id: 'openai',
  label: 'OpenAI API',
  baseEnv: 'OPENAI_BASE_URL',
  baseDefault: 'https://api.openai.com/v1',
  keyEnv: 'OPENAI_API_KEY',
  models: ['gpt-5', 'gpt-5-mini'],
  defaultModel: 'gpt-5',
});

export const geminiApi = {
  id: 'gemini-api',
  label: 'Gemini API',
  kind: 'api',
  models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  defaultModel: 'gemini-2.5-flash',
  reasoningLevels: ['low', 'high'],
  envKey: 'GEMINI_API_KEY',
  available: () => Boolean(process.env.GEMINI_API_KEY),
  async complete(req) {
    const model = req.model || this.defaultModel;
    const attachments = readAttachments(req.files);
    const msgs = toMessages(req);
    const contents = msgs.map((m, i) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(i === msgs.length - 1
          ? attachments.map((a) => (a.kind === 'text' ? { text: `${a.name}:\n${a.text}` } : { inline_data: { mime_type: a.mime, data: a.data } }))
          : []),
        { text: m.content },
      ],
    }));
    const body = {
      contents,
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      ...(req.reasoning ? { generationConfig: { thinkingConfig: { thinkingLevel: req.reasoning } } } : {}),
    };
    const data = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, body, {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    });
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return { text, model, usage: data.usageMetadata };
  },
};

export const ollama = {
  id: 'ollama',
  label: 'Ollama (local models)',
  kind: 'local',
  models: ['llama3.1', 'qwen2.5', 'mistral'],
  defaultModel: 'llama3.1',
  reasoningLevels: [],
  envKey: 'OLLAMA_HOST',
  available: () => true,
  async complete(req) {
    const host = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const images = readAttachments(req.files).filter((a) => a.kind === 'image').map((a) => a.data);
    const msgs = toMessages(req).map((m, i, all) => ({ ...m, ...(i === all.length - 1 && images.length ? { images } : {}) }));
    const data = await postJson(`${host}/api/chat`, {
      model: req.model || this.defaultModel,
      stream: false,
      messages: [...(req.system ? [{ role: 'system', content: req.system }] : []), ...msgs],
    });
    return { text: data.message?.content ?? '', model: data.model, usage: { input: data.prompt_eval_count, output: data.eval_count } };
  },
  async listModels() {
    const host = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  },
};
