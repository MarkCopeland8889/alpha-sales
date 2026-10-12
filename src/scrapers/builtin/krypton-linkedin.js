// Krypton on LinkedIn: client generation and prospecting (see src/workflows/krypton).
// Business details can be set on the project (variables) or given to the run.
import { runKrypton } from '../../workflows/krypton/index.js';
import { FIELDS } from '../../workflows/krypton/settings.js';

export default {
  name: 'krypton-linkedin',
  label: 'Krypton: LinkedIn prospecting',
  site: 'linkedin.com',
  description: 'Writes ICPs and search terms with AI, reads LinkedIn people, profiles, posts, jobs and groups for each term (and Sales Navigator if turned on), classifies them with AI and writes a report. Read-only: never applies, connects, messages, follows or reacts.',
  // Numbers have no input default, so a project's variables can set them; blank = default.
  inputs: Object.fromEntries(FIELDS.map(({ key, ...spec }) => [key, spec.type === 'number'
    ? { ...spec, default: undefined, help: spec.help || `Blank = ${spec.default}` }
    : spec])),
  checkpoints: ['started', 'planned', 'term N done', 'sales navigator done', 'collected', 'classified', 'report'],
  run: (ctx, input) => runKrypton(ctx, input),
};
