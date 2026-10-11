// The AI functions from the blueprint, and which provider supports which.
// "web" providers drive a real chat website through a scraper (built in a later phase);
// "api" and "cli" providers are callable now for chat completions.
export const AI_FUNCTIONS = [
  ['chat', 'Chat completions'],
  ['plugins', 'Plugin injections (e.g. @Create-image)'],
  ['modelPicker', 'Model picker & reasoning levels'],
  ['attachFiles', 'Attach files'],
  ['deepResearch', 'Deep research'],
  ['createVideo', 'Create video'],
  ['createMusic', 'Create music'],
  ['canvas', 'Attach canvas'],
  ['copyChat', 'Copy chat'],
  ['copyCode', 'Copy code snippet in chat'],
  ['downloadImage', 'Download image'],
  ['downloadImageSet', 'Download multi-image set'],
  ['downloadFile', 'Download generated file'],
  ['retry', 'Retry'],
  ['fork', 'Fork'],
  ['sparkAction', 'Gemini spark action'],
  ['codexCloud', 'Codex cloud'],
  ['temporaryChat', 'Location: temporary chat'],
  ['inProject', 'Location: inside project'],
  ['inFolder', 'Location: inside folder/organization system'],
  ['createProject', 'Create project'],
  ['deleteChat', 'Delete chat'],
  ['moveChat', 'Move chat'],
];

// Status per function: 'ready' (works now), 'planned' (part of the web scraper phase), absent = not offered.
const WEB_COMMON = ['chat', 'plugins', 'modelPicker', 'attachFiles', 'deepResearch', 'canvas', 'copyChat', 'copyCode',
  'downloadImage', 'downloadImageSet', 'downloadFile', 'retry', 'fork', 'temporaryChat', 'inProject', 'inFolder',
  'createProject', 'deleteChat', 'moveChat'];

const planned = (list) => Object.fromEntries(list.map((f) => [f, 'planned']));

export const PROVIDER_CAPABILITIES = {
  anthropic: { chat: 'ready', modelPicker: 'ready', attachFiles: 'ready', retry: 'ready' },
  'gemini-api': { chat: 'ready', modelPicker: 'ready', attachFiles: 'ready', retry: 'ready' },
  zai: { chat: 'ready', modelPicker: 'ready', retry: 'ready' },
  'opencode-zen': { chat: 'ready', modelPicker: 'ready', retry: 'ready' },
  openai: { chat: 'ready', modelPicker: 'ready', retry: 'ready' },
  ollama: { chat: 'ready', modelPicker: 'ready', attachFiles: 'ready', retry: 'ready' },
  codex: { chat: 'ready', modelPicker: 'ready', attachFiles: 'ready', retry: 'ready', codexCloud: 'planned' },
  'claude-code': { chat: 'ready', modelPicker: 'ready', attachFiles: 'ready', retry: 'ready' },
  'gemini-cli': { chat: 'ready', modelPicker: 'ready', attachFiles: 'ready', retry: 'ready' },
  'opencode-cli': { chat: 'ready', modelPicker: 'ready', attachFiles: 'ready', retry: 'ready' },
  antigravity: { chat: 'planned' },
  jev: { chat: 'planned' },
  'chatgpt-web': planned(WEB_COMMON),
  'gemini-web': planned([...WEB_COMMON, 'createVideo', 'createMusic', 'sparkAction']),
  'claude-web': planned(WEB_COMMON),
  'google-web': planned(['chat', 'attachFiles', 'copyChat', 'retry']),
  mock: { chat: 'ready', modelPicker: 'ready', retry: 'ready' },
};
