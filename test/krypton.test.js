import { HOME, HAS_BROWSER, waitUntil } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { localLogin } from '../src/auth/session.js';
import { onLogin, shutdown } from '../src/engine.js';
import { db } from '../src/db/index.js';
import { queueRun } from '../src/jobs/queue.js';
import { saveJob } from '../src/jobs/index.js';
import { createProfile } from '../src/profiles/index.js';
import { saveGuardrails } from '../src/guardrails/index.js';
import { freePort } from '../src/core/utils.js';
import { ai } from '../src/ai/index.js';
import { resolveSettings } from '../src/workflows/krypton/settings.js';
import { modelFor } from '../src/workflows/krypton/ai.js';
import { ageInDays } from '../src/workflows/krypton/linkedin/session.js';
import { markdownToHtml } from '../src/workflows/krypton/report.js';
import { startLinkedInSite } from './fixtures/linkedin-site.js';

// A scripted AI that answers each Krypton prompt the way a model would, so the whole flow can
// run without an API key. It records every call (model, reasoning, prompt).
const calls = [];
function answer(t) {
  if (/Broaden this ICP/.test(t)) return { name: 'Local owners', filters: { geography: ['United States'] } };
  if (/build the best possible ideal customer profiles/.test(t)) {
    return [{
      name: 'Local owners', summary: 'Owners of small local businesses', industry: 'Food and retail', geography: 'United States',
      pain_points: 'Messy books', buying_intent: ['need a bookkeeper'],
      filters: { geography: ['United States'], company_headcount: ['1-10'], seniority_level: ['Owner / Partner'], industry: ['Restaurants'] },
    }];
  }
  if (/Describe exactly which job listings qualify/.test(t)) return { exact_match: ['Remote bookkeeper'], similar: ['Staff accountant'], disqualifiers: ['Bookkeeping firms hiring'], signals: ['Remote'] };
  if (/Keep every person who does NOT appear to provide/.test(t)) {
    return [...t.matchAll(/^\[(\d+)\] (.+)$/gm)].filter((m) => !/Bookkeeper|CPA/.test(m[2])).map((m) => ({ id: Number(m[1]), intent: `Owner of a small business (${m[2]})` }));
  }
  if (/what are the key indicators/.test(t)) return ['Growing small business', 'Tax season stress'];
  if (/looking at LinkedIn profiles/.test(t)) {
    return [...t.matchAll(/^PROFILE (\d+): (.+)$/gm)].map((m) => ({ id: Number(m[1]), level: /Jane/.test(m[2]) ? 1 : /Dana/.test(m[2]) ? 2 : 0, evidence: `Read the profile of ${m[2]}` }));
  }
  if (/looking at LinkedIn posts/.test(t)) {
    const blocks = t.split(/^POST /m).slice(1);
    return blocks.map((b) => {
      const id = Number(b.match(/^(\d+)/)[1]);
      const needs = /need a bookkeeper|recommend a bookkeeper/i.test(b);
      const prospects = [];
      for (const [, name, url] of b.matchAll(/^- (Gina Grocer|Kim Kitchen) <([^>]+)>/gm)) prospects.push({ name, profileUrl: url, level: 1, evidence: 'Said they need a bookkeeper in the comments' });
      return { id, level: needs ? 1 : 0, evidence: needs ? 'Asks for a bookkeeper' : 'Nothing about bookkeeping', prospects };
    });
  }
  if (/LinkedIn job listings/.test(t)) {
    return [...t.matchAll(/^JOB (\d+): (.+)\n(.+)$/gm)].map((m) => ({ id: Number(m[1]), url: m[3], level: /Remote Bookkeeper/.test(m[2]) ? 1 : /Staff Accountant/.test(m[2]) ? 2 : 3, evidence: `Checked ${m[2]}` }));
  }
  if (/Visible controls:/.test(t)) {
    const steps = t.match(/Steps taken so far:\n([\s\S]*?)\n\nVisible controls/)[1];
    const done = steps === '(none)' ? 0 : steps.split('\n').filter((l) => /^\d+\./.test(l)).length;
    const controls = [...t.matchAll(/^(\d+)\. <(\w+)[^>]*> (.*)$/gm)].map((m) => ({ n: Number(m[1]), tag: m[2], text: m[3] }));
    if (done === 0) return { action: 'click', n: controls.find((c) => c.tag === 'button' && /^Industries/.test(c.text)).n, reason: 'open the filter' };
    if (done === 1) return { action: 'type', n: controls.find((c) => /placeholder: Add industries/.test(c.text)).n, text: 'Restaurants', reason: 'type the industry' };
    if (done === 2) {
      const at = controls.findIndex((c) => /^Restaurants/.test(c.text));
      return { action: 'click', n: controls.slice(at).find((c) => c.tag === 'button' && /^Include/.test(c.text)).n, reason: 'include it' };
    }
    return { action: 'done', reason: 'Restaurants is included' };
  }
  throw new Error(`Unexpected prompt: ${t.slice(0, 160)}`);
}
ai.registerProvider({
  id: 'krypton-test',
  label: 'Krypton test AI',
  kind: 'api',
  models: ['scripted'],
  defaultModel: 'scripted',
  available: () => true,
  async complete(req) {
    const text = req.prompt ?? req.messages.at(-1).content;
    calls.push({ model: req.model, reasoning: req.reasoning, text });
    return { text: JSON.stringify(answer(text)), model: req.model, usage: { input_tokens: 100, output_tokens: 20 } };
  },
});

let user;
test.before(async () => {
  user = await localLogin('tester');
  await onLogin(user);
  saveGuardrails({ minActionGapMs: 0 });
});
test.after(() => shutdown());

test('settings: defaults, required business details, model tiers', () => {
  assert.throws(() => resolveSettings({}, {}), /business_type/);
  const s = resolveSettings({ business_type: 'Bookkeeping firm', business_name: 'A', business_description: 'B' }, { search_terms: 'Need a bookkeeper\n\n', profile_batch_size: '' });
  assert.deepEqual(s.search_terms, ['Need a bookkeeper']);
  assert.equal(s.profile_batch_size, 3);
  assert.equal(s.post_batch_size, 10);
  assert.equal(s.job_batch_size, 30);
  assert.equal(s.profile_post_max_age_days, 30);
  assert.deepEqual(modelFor(s, 'fast'), { model: 'claude-haiku-5-5', reasoning: 'medium' });
  assert.deepEqual(modelFor(s, 'medium'), { model: 'claude-sonnet-5-5', reasoning: 'medium' });
  assert.deepEqual(modelFor(s, 'power'), { model: 'claude-opus-5-5', reasoning: 'high' });
  assert.deepEqual(modelFor({ ...s, extra_power: true }, 'power'), { model: 'claude-opus-5-5', reasoning: 'xhigh' });
  assert.deepEqual(modelFor({ ...s, ai_vendor: 'oai' }, 'fast'), { model: 'gpt-6-luna', reasoning: 'high' });
  assert.deepEqual(modelFor({ ...s, ai_vendor: 'oai' }, 'power'), { model: 'gpt-6.1-sol', reasoning: 'high' });
  assert.deepEqual(modelFor({ ...s, ai_vendor: 'gemini', extra_power: true }, 'power'), { model: 'gemini-3.8-flash', reasoning: 'high' });
});

test('post ages: LinkedIn date labels to days', () => {
  assert.equal(ageInDays('2d • '), 2);
  assert.equal(ageInDays('1w •'), 7);
  assert.equal(ageInDays('1mo • Edited'), 30);
  assert.equal(ageInDays('2mo'), 60);
  assert.equal(ageInDays('1yr'), 365);
  assert.ok(ageInDays('5h') < 1);
  assert.equal(ageInDays('3 days ago'), 3);
  assert.equal(ageInDays(''), null);
});

test('report HTML keeps links with underscores and escapes text', () => {
  const html = markdownToHtml('# R\n\n| A | B |\n| --- | --- |\n| [x](https://e.com/in/a_b/) | <b> |\n\n_None._', 'R');
  assert.match(html, /href="https:\/\/e.com\/in\/a_b\/"/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /<em>None.<\/em>/);
});

test('Krypton runs test 1 end to end on a LinkedIn-like site', { skip: !HAS_BROWSER && 'no Chrome or Chromium available', timeout: 240000 }, async (t) => {
  const port = await freePort();
  const site = await startLinkedInSite(port);
  t.after(() => site.close());
  createProfile({ browser: 'chrome', name: 'krypton-test' });

  const job = await saveJob(user.id, {
    name: 'Krypton test 1',
    definition: {
      browser: { browser: 'chrome', profile: 'krypton-test', headless: true },
      steps: [{
        scraper: 'krypton-linkedin',
        input: {
          business_type: 'Bookkeeping firm',
          business_name: 'Test Books',
          business_description: 'Fully remote, online bookkeeping for small businesses.',
          search_terms: 'Need a bookkeeper',
          locations: 'United States',
          ai_provider: 'krypton-test',
          use_sales_navigator: true,
          sales_nav_broaden_rounds: 1,
          delay_scale: 0.02,
          linkedin_base_url: `http://127.0.0.1:${port}`,
        },
      }],
    },
  });
  const run = await queueRun(user.id, { jobId: job.id });
  const done = await waitUntil(async () => {
    const r = await db.get('job_runs', run.id);
    return ['completed', 'failed', 'stopped'].includes(r.status) ? r : null;
  }, { timeout: 220000, every: 500 });
  assert.equal(done.status, 'completed', done.error);
  const result = done.result.steps[0].result;
  const root = result.folder;
  const at = (...p) => path.join(root, ...p);
  const read = (...p) => fs.readFileSync(at(...p), 'utf8');
  const json = (...p) => JSON.parse(read(...p));
  const term = at('Need a bookkeeper');

  // Never pressed anything that sends, applies, connects, follows, reacts, saves or joins.
  assert.deepEqual(site.clicks, {});

  // Plan and config
  const plan = json('Config', 'plan.json');
  assert.deepEqual(plan.terms, ['Need a bookkeeper']);
  assert.equal(plan.icps[0].name, 'Local owners');
  assert.equal(json('Config', 'config.json').business_type, 'Bookkeeping firm');

  // People: every result with its page, provider-looking people filtered out by the AI.
  const people = json('Need a bookkeeper', 'People', '_results.json');
  assert.deepEqual(people.map((p) => [p.slug, p.page]), [['jane-owner', 1], ['bob-bookkeeper', 1], ['carl-cafe', 1], ['dana-dental', 2], ['erin-cpa', 2]]);
  // Page 2 is the 2026 layout: names come out bare, and mutual connections are not results.
  assert.deepEqual(people.filter((p) => p.page === 2).map((p) => p.name), ['Dana Dental', 'Erin CPA']);
  assert.match(people.find((p) => p.slug === 'dana-dental').text, /Dentist and practice owner\nMiami, Florida/);
  assert.ok(fs.existsSync(path.join(term, 'People', '_search pages', 'Page 2.txt')));
  const kept = json('Need a bookkeeper', 'People', '_kept.json');
  assert.deepEqual(kept.map((p) => p.slug), ['jane-owner', 'carl-cafe', 'dana-dental']);
  assert.match(kept[0].intent, /Owner/);

  // Profile: images, every word after "see more" and scrolling, featured website, posts back one month.
  const jane = path.join(term, 'People', 'Jane Owner (jane-owner)');
  const text = fs.readFileSync(path.join(jane, 'Profile text.txt'), 'utf8');
  assert.match(text, /we need a bookkeeper who works online/);
  assert.match(text, /Lazy loaded experience/);
  assert.ok(fs.existsSync(path.join(jane, 'Profile image.jpg')));
  assert.ok(fs.existsSync(path.join(jane, 'Header image.jpg')));
  assert.match(fs.readFileSync(path.join(jane, 'websites.txt'), 'utf8'), /janesbakery\.example/);
  const janeRec = JSON.parse(fs.readFileSync(path.join(jane, 'profile.json'), 'utf8'));
  assert.equal(janeRec.posts.length, 3, 'posts dated 2d, 1w and 1mo; the 2mo post is skipped');
  assert.ok(!fs.readdirSync(path.join(jane, 'Posts')).some((f) => f.includes('too old')));

  // Post processor: full caption, media, metrics, all comments with profile links, reactions.
  const postDir = path.join(jane, 'Posts', fs.readdirSync(path.join(jane, 'Posts')).find((f) => f.includes('growing fast')));
  assert.match(fs.readFileSync(path.join(postDir, 'Post caption.txt'), 'utf8'), /Need a bookkeeper who works remote!/);
  assert.ok(fs.existsSync(path.join(postDir, 'Media 1.jpg')));
  const post = JSON.parse(fs.readFileSync(path.join(postDir, 'post.json'), 'utf8'));
  assert.deepEqual(post.metrics, { reactions: 15, comments: 4, reposts: 1 });
  const comments = JSON.parse(fs.readFileSync(path.join(postDir, 'Comments.json'), 'utf8'));
  assert.equal(comments.length, 4);
  assert.equal(comments[0].author, 'Gina Grocer');
  assert.match(comments[0].profileUrl, /\/in\/gina-grocer\/$/);
  const reactions = JSON.parse(fs.readFileSync(path.join(postDir, 'Reactions.json'), 'utf8'));
  assert.equal(reactions.length, 15);
  assert.deepEqual(reactions[0], { name: 'Reactor 1', headline: 'Headline 1', profileUrl: `http://127.0.0.1:${port}/in/reactor-1/`, reaction: 'like' });
  const interactions = JSON.parse(fs.readFileSync(path.join(postDir, 'Interactions.json'), 'utf8'));
  assert.equal(interactions.length, 19, '15 reactions then 4 comments');
  assert.deepEqual(interactions.slice(14, 16).map((x) => x.type), ['reaction', 'comment']);
  assert.deepEqual(interactions[15], { type: 'comment', name: 'Gina Grocer', headline: "Owner, Gina's Grocery", profileUrl: `http://127.0.0.1:${port}/in/gina-grocer/`, comment: 'I need this too! Who do you recommend?', isReply: false });

  // Jobs: one search per location, full text and company link saved, Apply never clicked.
  assert.deepEqual(json('Need a bookkeeper', 'Jobs', '_results United States.json'), ['3001', '3002', '3003']);
  const jobDir = path.join(term, 'Jobs', fs.readdirSync(path.join(term, 'Jobs')).find((f) => f.startsWith('Remote Bookkeeper')));
  assert.match(fs.readFileSync(path.join(jobDir, 'Job text.txt'), 'utf8'), /Fully online, 15 hours a week/);
  assert.equal(fs.readFileSync(path.join(jobDir, 'Company URL.txt'), 'utf8'), `http://127.0.0.1:${port}/company/acme-plumbing/`);

  // Post search (with "load more") and groups (names and links only).
  assert.equal(json('Need a bookkeeper', 'Posts', '_results.json').length, 3);
  assert.equal(fs.readdirSync(path.join(term, 'Posts')).filter((f) => !f.startsWith('_')).length, 3);
  assert.equal(fs.readFileSync(path.join(term, 'Groups', 'Small Business Owners Austin (555)', 'Group URL.txt'), 'utf8'), `http://127.0.0.1:${port}/groups/555/`);

  // Sales Navigator: mapped filters, agent fallback for the unmapped one, broaden, then profiles.
  const sn = at('Sales Navigator', 'Local owners');
  const search1 = JSON.parse(fs.readFileSync(path.join(sn, 'Search 1.json'), 'utf8'));
  assert.deepEqual(search1.applied.map((a) => [a.filter, a.ok, a.how]), [['Geography', true, 'mapped'], ['Industry', true, 'agent'], ['Company headcount', true, 'mapped'], ['Seniority level', true, 'mapped']]);
  assert.equal(search1.total, 2);
  assert.ok(fs.existsSync(path.join(sn, 'Search 2.json')), 'fewer than 100 results: the ICP was broadened and searched again');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sn, 'ICP.json'), 'utf8')).filters, { geography: ['United States'] });
  const leads = JSON.parse(fs.readFileSync(path.join(sn, 'People', '_results.json'), 'utf8'));
  assert.deepEqual(leads.map((l) => l.leadId), ['ACwAA123', 'ACwAA456']);
  const fiona = JSON.parse(fs.readFileSync(path.join(sn, 'People', 'Fiona Florist (ACwAA123)', 'profile.json'), 'utf8'));
  assert.equal(fiona.profileSlug, 'fiona-florist');

  // AI agents and models
  const peopleLv = json('Results', 'People.json');
  assert.equal(peopleLv.find((p) => p.slug === 'jane-owner').level, 1);
  assert.equal(peopleLv.find((p) => p.slug === 'dana-dental').level, 2);
  assert.equal(peopleLv.length, 5);
  const postsLv = json('Results', 'Posts.json');
  assert.ok(postsLv.some((p) => p.level === 1 && p.prospects.some((x) => x.name === 'Kim Kitchen')));
  const jobsLv = json('Results', 'Jobs.json');
  assert.deepEqual(jobsLv.map((j) => [j.id, j.level]), [['3001', 1], ['3002', 2], ['3003', 3]]);
  const tierOf = (re) => calls.filter((c) => re.test(c.text)).map((c) => `${c.model}/${c.reasoning}`);
  assert.deepEqual([...new Set(tierOf(/build the best possible ideal customer profiles/))], ['claude-opus-5-5/high']);
  assert.deepEqual([...new Set(tierOf(/Keep every person who does NOT/))], ['claude-sonnet-5-5/medium']);
  assert.deepEqual([...new Set(tierOf(/looking at LinkedIn profiles/))], ['claude-opus-5-5/high']);
  assert.deepEqual([...new Set(tierOf(/Visible controls:/))], ['claude-haiku-5-5/medium']);
  const profilePrompt = calls.find((c) => /looking at LinkedIn profiles/.test(c.text)).text;
  assert.match(profilePrompt, /=====/, 'profiles in a batch are separated by the delimiter');
  assert.ok(fs.readdirSync(at('AI Runs')).length >= 10);

  // Report
  const report = read('Report.md');
  assert.match(report, /## People actively looking \(level 1\)\n\n\| Person[^\n]*\n[^\n]*\n\| \[Jane Owner\]/);
  assert.match(report, /Remote Bookkeeper \(Part-time\)/);
  assert.match(report, /Kim Kitchen/);
  assert.match(report, /## Sales Navigator/);
  assert.ok(fs.existsSync(at('Report.html')));
  assert.equal(result.people.level1, 1);
  assert.equal(result.jobs.exact, 1);
  assert.match(people[0].text, /^Jane Owner\nOwner at Jane's Bakery/, 'screen-reader-only text is left out');

  // Resume: only the missing profile is read again, and Agent 2 runs again; nothing else.
  const dana = path.join(term, 'People', 'Dana Dental (dana-dental)');
  fs.rmSync(path.join(dana, 'profile.json'));
  fs.rmSync(at('Results', 'People.json'));
  const before = site.visits.length;
  const callsBefore = calls.length;
  const progress = json('Config', 'progress.json');
  fs.writeFileSync(at('Config', 'progress.json'), JSON.stringify({ ...progress, terms: [] }));
  const again = await queueRun(user.id, { jobId: job.id, resumeFrom: run.id });
  const done2 = await waitUntil(async () => {
    const r = await db.get('job_runs', again.id);
    return ['completed', 'failed', 'stopped'].includes(r.status) ? r : null;
  }, { timeout: 120000, every: 500 });
  assert.equal(done2.status, 'completed', done2.error);
  assert.equal(done2.result.steps[0].result.folder, root);
  const pages = site.visits.slice(before).filter((v) => !/^\/(img\/|__|favicon)/.test(v));
  assert.deepEqual(pages, ['/in/dana-dental/', '/in/dana-dental/recent-activity/all/']);
  assert.deepEqual(calls.slice(callsBefore).map((c) => (c.text.match(/looking at LinkedIn (\w+)/) || [])[1]), ['profiles', 'profiles']);
  assert.equal(json('Results', 'People.json').find((p) => p.slug === 'dana-dental').level, 2);
});
