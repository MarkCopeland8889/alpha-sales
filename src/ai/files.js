// Reads attachments once and describes them in a provider-neutral way.
import fs from 'node:fs';
import path from 'node:path';

const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const TEXT = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xml', '.js', '.ts', '.py', '.log', '.yaml', '.yml']);

export function readAttachments(files = []) {
  return files.map((file) => {
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file);
    if (IMAGE[ext]) return { kind: 'image', name, mime: IMAGE[ext], data: fs.readFileSync(file).toString('base64') };
    if (ext === '.pdf') return { kind: 'pdf', name, mime: 'application/pdf', data: fs.readFileSync(file).toString('base64') };
    if (TEXT.has(ext)) return { kind: 'text', name, mime: 'text/plain', text: fs.readFileSync(file, 'utf8') };
    throw new Error(`Unsupported attachment type: ${name}`);
  });
}

// Normalizes { prompt } / { messages } into a message list.
export function toMessages(req) {
  if (Array.isArray(req.messages) && req.messages.length) return req.messages.map((m) => ({ role: m.role, content: String(m.content) }));
  if (req.prompt) return [{ role: 'user', content: String(req.prompt) }];
  throw new Error('Send a prompt or a list of messages');
}

// Single prompt string for tools that take one block of text (CLIs, web chats).
export function flattenPrompt(req) {
  const parts = [];
  if (req.system) parts.push(`Instructions:\n${req.system}`);
  const msgs = toMessages(req);
  if (msgs.length === 1) parts.push(msgs[0].content);
  else parts.push(msgs.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n'));
  if (req.files?.length) parts.push(`Attached files:\n${req.files.map((f) => `- ${f}`).join('\n')}`);
  return parts.join('\n\n');
}
