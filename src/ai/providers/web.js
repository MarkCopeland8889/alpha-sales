// AI through the chat websites themselves, driven by Playwright in a logged-in profile.
// This removes token costs. The interface is defined now so jobs can be written against
// it; the page automation for each site is a later phase (see docs/ROADMAP.md).
//
// Each web provider will: open the account's profile (Accounts/<Platform>/<user>),
// pick the model/reasoning level, attach files, send the prompt, wait for the answer,
// and copy it back, plus the extra functions listed in src/ai/capabilities.js.

function webProvider(id, label, url, models = []) {
  return {
    id,
    label,
    kind: 'web',
    url,
    models,
    defaultModel: models[0] ?? null,
    reasoningLevels: [],
    available: () => false,
    async complete() {
      throw new Error(`${label} automation is planned for a later phase. Use an API or CLI provider for now.`);
    },
  };
}

export const chatgptWeb = webProvider('chatgpt-web', 'ChatGPT.com (web)', 'https://chatgpt.com/');
export const geminiWeb = webProvider('gemini-web', 'Gemini (web)', 'https://gemini.google.com/');
export const claudeWeb = webProvider('claude-web', 'Claude.ai (web)', 'https://claude.ai/');
export const googleWeb = webProvider('google-web', 'Google AI Mode (web)', 'https://www.google.com/');

// TypeSafe Jev is a decision model (it chooses among options with probabilities) rather than
// a text generator. It powers the experimental "jev" controller: given the page state and a
// list of candidate actions, it picks the next one. The HTTP contract is not wired yet.
export const jev = {
  id: 'jev',
  label: 'TypeSafe Jev (decision model)',
  kind: 'decision',
  models: ['jev'],
  defaultModel: 'jev',
  reasoningLevels: [],
  envKey: 'JEV_API_KEY',
  available: () => false,
  async complete() {
    throw new Error('Jev returns choices, not text. Use ai.choose() once the Jev API is configured.');
  },
  async choose() {
    throw new Error('The Jev controller is experimental and not connected yet (set JEV_BASE_URL/JEV_API_KEY and implement choose()).');
  },
};

// Offline test provider: echoes the prompt. Lets jobs and the UI be tested without keys.
export const mock = {
  id: 'mock',
  label: 'Test provider (echo, no AI)',
  kind: 'test',
  models: ['echo'],
  defaultModel: 'echo',
  reasoningLevels: [],
  available: () => true,
  async complete(req) {
    const last = req.prompt || req.messages?.at(-1)?.content || '';
    return { text: `echo: ${last}`, model: 'echo' };
  },
};
