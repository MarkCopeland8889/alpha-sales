// Runs one AI request and keeps the answer for the next steps of the job
// (ctx.shared[saveAs]) and in Local Files/AI/<run>/<saveAs>.txt.
// Placeholders like {{business_name}} are filled from the project variables and earlier steps.
export default {
  name: 'ai-prompt',
  label: 'AI prompt',
  site: null,
  needsBrowser: false,
  description: 'Send a prompt to any AI provider and keep the answer for later steps. Supports {{variable}} placeholders.',
  inputs: {
    provider: { type: 'string', default: 'anthropic', label: 'Provider id' },
    model: { type: 'string', default: '', label: 'Model (blank = provider default)' },
    reasoning: { type: 'string', default: '', label: 'Reasoning level' },
    system: { type: 'text', default: '', label: 'System instructions' },
    prompt: { type: 'text', required: true, label: 'Prompt' },
    json: { type: 'boolean', default: false, label: 'Expect JSON' },
    saveAs: { type: 'string', default: 'answer', label: 'Save answer as' },
  },
  checkpoints: ['answered'],

  async run(ctx, input) {
    const vars = { ...ctx.variables, ...ctx.shared };
    const fill = (s) => String(s || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => {
      const v = vars[k];
      return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    });
    const req = {
      provider: input.provider,
      model: input.model || undefined,
      reasoning: input.reasoning || undefined,
      system: fill(input.system) || undefined,
      prompt: fill(input.prompt),
    };
    const answer = input.json ? await ctx.ai.json(req) : (await ctx.ai.complete(req)).text;
    ctx.shared[input.saveAs] = answer;
    const store = ctx.store('AI', ctx.run.label);
    store.text([`${input.saveAs}.txt`], typeof answer === 'string' ? answer : JSON.stringify(answer, null, 2));
    await ctx.checkpoint('answered', { saveAs: input.saveAs });
    return { saveAs: input.saveAs, preview: (typeof answer === 'string' ? answer : JSON.stringify(answer)).slice(0, 500) };
  },
};
