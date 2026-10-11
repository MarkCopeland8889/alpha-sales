// Claude via the Anthropic API (official SDK). Reads ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { readAttachments, toMessages } from '../files.js';

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

let client = null;

function contentFor(text, attachments) {
  if (!attachments.length) return text;
  const blocks = attachments.map((a) => {
    if (a.kind === 'image') return { type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } };
    if (a.kind === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name };
    return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: a.text }, title: a.name };
  });
  return [...blocks, { type: 'text', text }];
}

export default {
  id: 'anthropic',
  label: 'Claude (Anthropic API)',
  kind: 'api',
  models: MODELS,
  defaultModel: 'claude-opus-5-5',
  reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  envKey: 'ANTHROPIC_API_KEY',

  available() {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  },

  async complete(req) {
    client ||= new Anthropic();
    const model = req.model || this.defaultModel;
    const messages = toMessages(req);
    const attachments = readAttachments(req.files);
    // Attachments ride on the last user message.
    const last = messages.length - 1;
    const apiMessages = messages.map((m, i) => ({
      role: m.role,
      content: i === last && m.role === 'user' ? contentFor(m.content, attachments) : m.content,
    }));
    const params = {
      model,
      max_tokens: req.maxTokens || 64000,
      messages: apiMessages,
      thinking: { type: 'adaptive' },
      output_config: { effort: req.reasoning || 'high' },
      ...(req.system ? { system: req.system } : {}),
    };
    // Streaming avoids HTTP timeouts on long answers; finalMessage() assembles the result.
    const stream = FALLBACK_MODELS.has(model)
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : client.messages.stream(params);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      throw new Error(`Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}`);
    }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, model: msg.model, usage: msg.usage, stopReason: msg.stop_reason };
  },
};
