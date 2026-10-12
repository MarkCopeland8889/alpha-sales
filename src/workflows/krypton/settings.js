// Krypton settings: the preset variables from the workflow doc, their defaults, and how
// a run's settings are resolved (defaults < project variables < values given to the run).

export const ICP_FIELDS = [
  ['industry', 'Industry'],
  ['geography', 'Geography'],
  ['company_size', 'Company size'],
  ['budget', 'Budget'],
  ['buying_process', 'Buying process'],
  ['decision_makers', 'Decision makers'],
  ['pain_points', 'Pain points'],
  ['business_goals', 'Business goals'],
  ['buying_intent', 'Buying intent (one per line)'],
];

// Model tiers per AI vendor. "reasoning" maps to each provider's effort/reasoning setting.
// Model names are editable per run; OpenAI and Gemini names follow the workflow doc.
export const MODEL_TIERS = {
  claude: {
    fast: { model: 'claude-haiku-5-5', reasoning: 'medium' },
    medium: { model: 'claude-sonnet-5-5', reasoning: 'medium' },
    power: { model: 'claude-opus-5-5', reasoning: 'high' },
  },
  oai: {
    fast: { model: 'gpt-6-luna', reasoning: 'high' },
    medium: { model: 'gpt-6.1-sol', reasoning: 'medium' },
    power: { model: 'gpt-6.1-sol', reasoning: 'high' },
  },
  gemini: {
    fast: { model: 'gemini-3.8-flash', reasoning: 'medium' },
    medium: { model: 'gemini-3.8-flash', reasoning: 'high' },
    power: { model: 'gemini-3.8-flash', reasoning: 'high' },
  },
};

// Which provider serves each vendor, in order of preference. The first one that is set up
// on this computer is used (API key first, then the subscription CLI login).
export const VENDOR_PROVIDERS = {
  claude: ['anthropic', 'claude-code'],
  oai: ['openai', 'codex'],
  gemini: ['gemini-api', 'gemini-cli'],
};

export const DEFAULTS = {
  // Required business variables
  business_type: '',
  business_name: '',
  business_description: '',
  // Optional ICP lines (blank = AI generates ICPs)
  ...Object.fromEntries(ICP_FIELDS.map(([k]) => [k, ''])),

  // Searches. Blank search_terms = AI generates them from the ICPs.
  search_terms: [],
  terms_per_icp: 50,
  locations: [], // job searches run once per location (blank = no location filter)

  // Batching for the AI classification prompts. Posts from one profile are always sent
  // together (all posts of that profile); post_batch_size applies to posts from searches.
  delimiter: '\n\n=====\n\n',
  profile_batch_size: 3,
  post_batch_size: 10,
  job_batch_size: 30,
  people_filter_batch_size: 10,

  // AI routing
  ai_vendor: 'claude', // claude | oai | gemini
  ai_provider: '', // force a provider id (e.g. "claude-code"); blank = automatic
  extra_power: false, // xhigh reasoning for Claude and OpenAI power prompts
  fast_model_oai: MODEL_TIERS.oai.fast.model,
  fast_model_claude: MODEL_TIERS.claude.fast.model,
  fast_model_gemini: MODEL_TIERS.gemini.fast.model,
  medium_model_oai: MODEL_TIERS.oai.medium.model,
  medium_model_claude: MODEL_TIERS.claude.medium.model,
  medium_model_gemini: MODEL_TIERS.gemini.medium.model,
  power_model_oai: MODEL_TIERS.oai.power.model,
  power_model_claude: MODEL_TIERS.claude.power.model,
  power_model_gemini: MODEL_TIERS.gemini.power.model,

  // What to collect
  collect_people: true,
  collect_profiles: true,
  collect_profile_posts: true,
  collect_jobs: true,
  collect_posts: true,
  collect_groups: true, // group names and links from the results only (never joins)
  use_sales_navigator: false, // one Sales Navigator search per ICP (needs a Sales Navigator seat)

  // How much to collect. 0 = no limit (the daily guardrail limits still apply).
  max_search_pages: 0,
  max_profiles_per_term: 0,
  profile_post_max_age_days: 30, // a profile's posts back to one month ("1mo")
  max_posts_per_profile: 0,
  activity_load_more: 10,
  posts_load_more: 20,
  max_jobs_per_search: 0,
  max_reactions_per_post: 200,
  max_comment_pages: 5,

  // Sales Navigator
  sales_nav_min_results: 100, // fewer results than this: ask the AI to broaden the ICP
  sales_nav_broaden_rounds: 2,
  sales_nav_max_pages: 0, // 0 = every page (Sales Navigator shows up to 100 pages of 25)
  max_profiles_per_icp: 0,

  delay_scale: 1, // multiplies every pause (1 = normal pace)
  linkedin_base_url: 'https://www.linkedin.com',
};

const LIST_KEYS = new Set(['search_terms', 'locations', 'buying_intent']);
const NUMBER_KEYS = new Set(Object.entries(DEFAULTS).filter(([, v]) => typeof v === 'number').map(([k]) => k));
const BOOL_KEYS = new Set(Object.entries(DEFAULTS).filter(([, v]) => typeof v === 'boolean').map(([k]) => k));

function normalize(key, value) {
  if (value === undefined || value === null) return undefined;
  if (LIST_KEYS.has(key)) {
    const list = Array.isArray(value) ? value : String(value).split(/\r?\n/);
    const clean = list.map((s) => String(s).trim()).filter(Boolean);
    return clean.length ? clean : undefined;
  }
  if (NUMBER_KEYS.has(key)) {
    if (value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (BOOL_KEYS.has(key)) return value === true || value === 'true';
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

// Merges defaults, then the project's variables, then the run's own inputs.
export function resolveSettings(projectVariables = {}, input = {}) {
  const out = { ...DEFAULTS };
  for (const source of [projectVariables, input]) {
    for (const [k, v] of Object.entries(source || {})) {
      const n = normalize(k, v);
      if (n !== undefined) out[k] = n;
    }
  }
  if (!['claude', 'oai', 'gemini'].includes(out.ai_vendor)) throw new Error(`ai_vendor must be claude, oai or gemini (got "${out.ai_vendor}")`);
  for (const k of ['business_type', 'business_name', 'business_description']) {
    if (!out[k]) throw new Error(`Krypton needs "${k}" (set it on the project or in the run)`);
  }
  if (!out.geography && out.locations.length) out.geography = out.locations.join(', ');
  out.linkedin_base_url = out.linkedin_base_url.replace(/\/$/, '');
  return out;
}

// True when at least one ICP line was given, so the AI does not need to invent ICPs.
export function hasIcp(s) {
  return ICP_FIELDS.some(([k]) => (Array.isArray(s[k]) ? s[k].length : Boolean(s[k])));
}

export function icpFromSettings(s) {
  return Object.fromEntries(ICP_FIELDS.map(([k]) => [k, s[k]]).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
}

// Form fields for the control panel and the job editor, grouped as in the workflow doc.
// Strings left blank fall back to the project's variables, then to DEFAULTS.
const num = (key, label, help) => ({ key, label, type: 'number', default: DEFAULTS[key], help });
const bool = (key, label, help) => ({ key, label, type: 'boolean', default: DEFAULTS[key], help });
export const FIELD_GROUPS = [
  ['Business', [
    { key: 'business_type', label: 'Business type', type: 'string', help: 'Required (here or on the project), e.g. Bookkeeping firm' },
    { key: 'business_name', label: 'Business name', type: 'string', help: 'Required' },
    { key: 'business_description', label: 'Business description', type: 'text', help: 'Required: what you offer and to whom' },
  ]],
  ['Ideal customer (optional, blank = the AI writes the ICPs)', ICP_FIELDS.map(([key, label]) => ({ key, label, type: key === 'buying_intent' ? 'text' : 'string' }))],
  ['Searches', [
    { key: 'search_terms', label: 'Search terms', type: 'text', help: 'One per line. Blank = the AI writes them for each ICP' },
    num('terms_per_icp', 'Search terms per ICP'),
    { key: 'locations', label: 'Job search locations', type: 'text', help: 'One per line; one job search per location. Blank = no location filter' },
    bool('collect_people', 'People search'),
    bool('collect_profiles', 'Read the kept profiles'),
    bool('collect_profile_posts', "Read each profile's recent posts"),
    num('profile_post_max_age_days', 'Profile posts back to (days)', '30 = posts dated up to "1mo"'),
    bool('collect_jobs', 'Job search'),
    bool('collect_posts', 'Post search'),
    bool('collect_groups', 'Group search (names and links only)'),
    bool('use_sales_navigator', 'Sales Navigator search per ICP (needs a Sales Navigator seat)'),
  ]],
  ['Limits (0 = no limit; daily guardrails still apply)', [
    num('max_search_pages', 'Search pages per term'),
    num('max_profiles_per_term', 'Profiles per term'),
    num('max_posts_per_profile', 'Posts per profile'),
    num('activity_load_more', 'Activity "load more" clicks'),
    num('posts_load_more', 'Post search "load more" clicks'),
    num('max_jobs_per_search', 'Jobs per search'),
    num('max_reactions_per_post', 'Reactions per post'),
    num('max_comment_pages', 'Comment pages per post'),
    num('sales_nav_min_results', 'Sales Navigator: broaden below'),
    num('sales_nav_broaden_rounds', 'Sales Navigator: broaden rounds'),
    num('sales_nav_max_pages', 'Sales Navigator: pages per search'),
    num('max_profiles_per_icp', 'Sales Navigator: profiles per ICP'),
    num('delay_scale', 'Pause length (x)', '1 = normal pace; higher is slower'),
  ]],
  ['AI', [
    { key: 'ai_vendor', label: 'AI', type: 'select', options: [['claude', 'Claude'], ['oai', 'OpenAI'], ['gemini', 'Gemini']], default: DEFAULTS.ai_vendor },
    { key: 'ai_provider', label: 'Connection', type: 'select', options: [['', 'Automatic (API key, then CLI login)'], ['anthropic', 'Claude API key'], ['claude-code', 'Claude Code login'], ['openai', 'OpenAI API key'], ['codex', 'Codex login'], ['gemini-api', 'Gemini API key'], ['gemini-cli', 'Gemini CLI login']], default: '' },
    bool('extra_power', 'Extra power (xhigh reasoning for Claude and OpenAI power prompts)'),
    num('profile_batch_size', 'Profile batch size'),
    num('post_batch_size', 'Post batch size (post search)', "A profile's posts always go in one batch"),
    num('job_batch_size', 'Job batch size'),
    num('people_filter_batch_size', 'People filter batch size'),
    { key: 'delimiter', label: 'Delimiter', type: 'string', help: 'Blank = a line of =====' },
    ...['fast', 'medium', 'power'].flatMap((tier) => ['claude', 'oai', 'gemini'].map((v) => ({ key: `${tier}_model_${v}`, label: `${tier[0].toUpperCase()}${tier.slice(1)} model (${v === 'oai' ? 'OpenAI' : v === 'claude' ? 'Claude' : 'Gemini'})`, type: 'string', help: `Blank = ${DEFAULTS[`${tier}_model_${v}`]}` }))),
    { key: 'linkedin_base_url', label: 'LinkedIn address', type: 'string', help: `Blank = ${DEFAULTS.linkedin_base_url}` },
  ]],
];
export const FIELDS = FIELD_GROUPS.flatMap(([, list]) => list);
