// Krypton: client generation and prospecting on LinkedIn.
//
//   1. Plan     ICPs (power), search terms (medium, unless given), job criteria (medium)
//   2. Collect  per search term: people (+ AI filter) -> profiles -> their recent posts,
//               jobs (one search per location), posts (content search), groups;
//               optionally one Sales Navigator search per ICP
//   3. Analyse  Agent 1 indicators, Agent 2 profiles, Agent 3 posts, Agent 4 jobs
//   4. Report   Report.md and Report.html in the run folder
//
// Everything is saved as it is collected, so a stopped run can be resumed into the same
// folder and skips what is already there.
import fs from 'node:fs';
import { resolveSettings, hasIcp, icpFromSettings } from './settings.js';
import { createAi, batches } from './ai.js';
import * as prompts from './prompts.js';
import { createStore, runFolderName, termFolder, personFolder, jobFolder, postFolder, groupFolder } from './store.js';
import { createLinkedIn } from './linkedin/session.js';
import { searchPeople, searchJobs, searchPosts, searchGroups } from './linkedin/search.js';
import { readProfile } from './linkedin/profile.js';
import { readPost, savePost } from './linkedin/post.js';
import { readJob, readJobInPane, saveJob } from './linkedin/job.js';
import { salesNavigator } from './linkedin/salesnav.js';
import { writeReport } from './report.js';

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

export async function runKrypton(ctx, input) {
  const s = resolveSettings(ctx.variables, input);
  const folder = ctx.resume.started?.folder || runFolderName();
  const store = createStore(folder);
  const notes = [];
  const note = (msg) => {
    if (!notes.includes(msg)) notes.push(msg);
    ctx.log.warn(msg);
  };
  const usage = { input_tokens: 0, output_tokens: 0 };
  const brain = createAi({
    settings: s,
    store,
    log: ctx.log,
    onUsage: (u) => {
      usage.input_tokens += u?.input_tokens || 0;
      usage.output_tokens += u?.output_tokens || 0;
    },
  });
  ctx.log.info(`Krypton run folder: ${store.root}`);
  await ctx.checkpoint('started', { folder });

  // ---------- 1. Plan ----------
  let plan = store.readJson(['Config', 'plan.json']);
  if (!plan) {
    plan = await makePlan(s, brain);
    store.json(['Config', 'plan.json'], plan);
  }
  store.json(['Config', 'config.json'], { ...s, provider: brain.provider, models: { fast: brain.modelFor('fast'), medium: brain.modelFor('medium'), power: brain.modelFor('power') } });
  await ctx.checkpoint('planned', { icps: plan.icps.length, terms: plan.terms.length });

  // ---------- 2. Collect ----------
  const li = createLinkedIn(ctx, s);
  const seen = store.readJson(['Config', 'seen.json'], { people: {}, posts: {}, jobs: {} });
  const saveSeen = () => store.json(['Config', 'seen.json'], seen);
  const progress = store.readJson(['Config', 'progress.json'], { terms: [], salesNav: false });
  const stats = store.readJson(['Config', 'stats.json'], {});
  const limits = new Set();

  // Runs one unit of work. A daily guardrail limit skips the rest of that kind of work and is
  // noted in the report; the kill switch, a stop, or a login failure end the run.
  async function guarded(label, fn) {
    try {
      return await fn();
    } catch (err) {
      if (ctx.shouldStop() || err.fatal || /kill switch/i.test(err.message)) throw err;
      if (err.name === 'GuardrailError') {
        limits.add(err.message);
        note(`${label}: ${err.message}`);
      } else note(`${label} failed: ${err.message.split('\n')[0]}`);
      return null;
    }
  }

  // The post processor. A post already saved elsewhere in this run is copied, not re-read.
  async function processPost(dirParts, urn) {
    const prev = seen.posts[urn];
    if (prev) {
      const target = [...dirParts, prev.at(-1)];
      if (!store.exists([...target, 'post.json'])) store.copy(prev, target);
      return target;
    }
    const post = await guarded(`Post ${urn}`, () => readPost(li, urn, { maxCommentPages: s.max_comment_pages, maxReactions: s.max_reactions_per_post }));
    if (!post) return null;
    const parts = [...dirParts, postFolder(post)];
    await savePost(store, li.page, parts, post, ctx.log);
    seen.posts[urn] = parts;
    saveSeen();
    return parts;
  }

  // The profile processor: profile page, then its recent posts.
  async function processPerson(dirParts, person, extra = {}) {
    const parts = [...dirParts, personFolder(person)];
    if (store.exists([...parts, 'profile.json'])) return store.readJson([...parts, 'profile.json']);
    const prev = seen.people[person.slug];
    if (prev && store.copy(prev, parts)) return store.readJson([...parts, 'profile.json']);
    const profile = await guarded(`Profile ${person.name}`, () => readProfile(li, store, parts, person));
    if (!profile) return null;
    const posts = [];
    for (const urn of profile.postUrns) {
      const p = await processPost([...parts, 'Posts'], urn);
      if (p) posts.push(p.at(-1));
    }
    const record = { ...person, ...extra, ...profile, slug: person.slug, posts, savedAt: new Date().toISOString() };
    store.json([...parts, 'profile.json'], record);
    seen.people[person.slug] = parts;
    saveSeen();
    return record;
  }

  for (const [i, term] of plan.terms.entries()) {
    if (progress.terms.includes(term)) continue;
    ctx.throwIfStopped();
    await ctx.progress({ checkpoint: `term ${i + 1}/${plan.terms.length}: ${term}` });
    stats[term] = await collectTerm(term);
    store.json(['Config', 'stats.json'], stats);
    progress.terms.push(term);
    store.json(['Config', 'progress.json'], progress);
    await ctx.checkpoint(`term ${i + 1} done`, { term, ...stats[term] });
  }

  async function collectTerm(term) {
    const tf = termFolder(term);
    const st = { people: 0, kept: 0, profiles: 0, profilePosts: 0, jobs: 0, posts: 0, groups: 0 };

    if (s.collect_people) {
      let results = store.readJson([tf, 'People', '_results.json']);
      if (!results) {
        results = await guarded(`People search "${term}"`, () => searchPeople(li, term, {
          maxPages: s.max_search_pages,
          onPage: (n, text) => store.text([tf, 'People', '_search pages', `Page ${n}.txt`], text),
        })) || [];
        store.json([tf, 'People', '_results.json'], results);
      }
      st.people = results.length;
      let kept = store.readJson([tf, 'People', '_kept.json']);
      if (!kept) {
        kept = await filterPeople(term, results);
        store.json([tf, 'People', '_kept.json'], kept);
      }
      st.kept = kept.length;
      if (s.collect_profiles) {
        const todo = s.max_profiles_per_term > 0 ? kept.slice(0, s.max_profiles_per_term) : kept;
        for (const [n, person] of todo.entries()) {
          ctx.throwIfStopped();
          await ctx.progress({ checkpoint: `"${term}" profile ${n + 1}/${todo.length}` });
          const rec = await processPerson([tf, 'People'], person, { term, intent: person.intent, page: person.page });
          if (rec) {
            st.profiles += 1;
            st.profilePosts += rec.posts?.length || 0;
          }
        }
      }
    }

    if (s.collect_jobs) {
      for (const location of s.locations.length ? s.locations : ['']) {
        const key = location ? `_results ${location}.json` : '_results.json';
        // Reads each listed job once: from the results page's side pane while that page is
        // open (inPane), otherwise by opening the job's page.
        const readJobs = async (ids, inPane) => {
          let pane = inPane;
          for (const id of ids) {
            ctx.throwIfStopped();
            await ctx.progress({ checkpoint: `"${term}" job ${st.jobs + 1}` });
            const prev = seen.jobs[id];
            if (prev) {
              const target = [tf, 'Jobs', prev.parts.at(-1)];
              if (!store.exists([...target, 'job.json'])) store.copy(prev.parts, target);
              continue;
            }
            let job = pane ? await guarded(`Job ${id}`, () => readJobInPane(li, id)) : null;
            if (pane && !job) {
              pane = false; // the list may be gone now; open the rest of this page's jobs directly
              note('Some jobs could not be read in the search list\'s side pane, so their pages were opened instead.');
            }
            job ||= await guarded(`Job ${id}`, () => readJob(li, id));
            if (!job) continue;
            const parts = [tf, 'Jobs', jobFolder(job)];
            saveJob(store, parts, { ...job, term, location });
            seen.jobs[id] = { parts, term, location };
            saveSeen();
            st.jobs += 1;
          }
        };
        let ids = store.readJson([tf, 'Jobs', key]);
        if (!ids) {
          ids = await guarded(`Job search "${term}"${location ? ` in ${location}` : ''}`, () => searchJobs(li, term, location, { maxJobs: s.max_jobs_per_search, onPage: (page) => readJobs(page, true) })) || [];
          store.json([tf, 'Jobs', key], ids);
        }
        await readJobs(ids, false); // after a resume: any listed job not read yet
      }
    }

    if (s.collect_posts) {
      let urns = store.readJson([tf, 'Posts', '_results.json']);
      if (!urns) {
        urns = await guarded(`Post search "${term}"`, () => searchPosts(li, term, { loadMore: s.posts_load_more })) || [];
        store.json([tf, 'Posts', '_results.json'], urns);
      }
      for (const [n, urn] of urns.entries()) {
        ctx.throwIfStopped();
        await ctx.progress({ checkpoint: `"${term}" post ${n + 1}/${urns.length}` });
        if (await processPost([tf, 'Posts'], urn)) st.posts += 1;
      }
    }

    if (s.collect_groups) {
      let groups = store.readJson([tf, 'Groups', '_results.json']);
      if (!groups) {
        groups = await guarded(`Group search "${term}"`, () => searchGroups(li, term, { maxPages: s.max_search_pages })) || [];
        store.json([tf, 'Groups', '_results.json'], groups);
      }
      for (const g of groups) {
        store.text([tf, 'Groups', groupFolder(g), 'Group text.txt'], g.text);
        store.text([tf, 'Groups', groupFolder(g), 'Group URL.txt'], g.url);
      }
      st.groups = groups.length;
    }
    ctx.log.ok(`"${term}": ${st.people} people (${st.kept} kept, ${st.profiles} profiles, ${st.profilePosts} of their posts), ${st.jobs} jobs, ${st.posts} posts, ${st.groups} groups`);
    return st;
  }

  // Part B people filter: drop people who provide the service; keep the rest with an intent note.
  async function filterPeople(term, results) {
    const kept = [];
    for (const [b, batch] of batches(results, s.people_filter_batch_size).entries()) {
      const items = batch.map((p, i) => ({ id: i + 1, name: p.name, text: clip(p.text, 1200) }));
      const answer = await brain.ask(`People filter - ${term} - batch ${b + 1}`, 'medium', prompts.filterPeople(s, term, items));
      for (const a of Array.isArray(answer) ? answer : []) {
        const p = batch[Number(a.id) - 1];
        if (p) kept.push({ ...p, intent: a.intent || '' });
      }
    }
    ctx.log.info(`People filter "${term}": kept ${kept.length} of ${results.length}`);
    return kept;
  }

  if (s.use_sales_navigator && !progress.salesNav) {
    stats['Sales Navigator'] = await salesNavigator({ ctx, li, store, brain, plan, settings: s, processPerson, guarded, note });
    store.json(['Config', 'stats.json'], stats);
    progress.salesNav = true;
    store.json(['Config', 'progress.json'], progress);
    await ctx.checkpoint('sales navigator done', stats['Sales Navigator']);
  }
  await ctx.checkpoint('collected', { people: Object.keys(seen.people).length, posts: Object.keys(seen.posts).length, jobs: Object.keys(seen.jobs).length });

  // ---------- 3. Analyse ----------
  const results = await analyse({ s, store, brain, plan, seen, ctx });
  await ctx.checkpoint('classified', { people: results.people.length, posts: results.posts.length, jobs: results.jobs.length });

  // ---------- 4. Report ----------
  const report = writeReport({ store, settings: s, plan, stats, results, notes, limits: [...limits], usage, provider: brain.provider });
  await ctx.checkpoint('report', { report: report.md });
  ctx.log.ok(`Report saved: ${report.md}`);
  const count = (list, level) => list.filter((x) => x.level === level).length;
  return {
    folder: store.root,
    report: report.md,
    terms: plan.terms.length,
    people: { classified: results.people.length, level1: count(results.people, 1), level2: count(results.people, 2) },
    posts: { classified: results.posts.length, level1: count(results.posts, 1), level2: count(results.posts, 2) },
    jobs: { classified: results.jobs.length, exact: count(results.jobs, 1), similar: count(results.jobs, 2) },
    notes,
  };
}

async function makePlan(s, brain) {
  const given = hasIcp(s) ? icpFromSettings(s) : null;
  let icps;
  let icpConversation = null;
  if (!given || s.use_sales_navigator) {
    const p = prompts.generateIcps(s, given);
    const { data, text } = await brain.ask('ICPs', 'power', { ...p, json: 'raw' });
    icps = (Array.isArray(data) ? data : data.icps || [data]).filter((x) => x && typeof x === 'object').slice(0, 5)
      .map((icp, i) => ({ ...icp, name: icp.name || `ICP ${i + 1}` }));
    icpConversation = { system: p.system, prompt: p.prompt, answer: text };
  } else {
    icps = [{ name: 'Given ICP', ...given }];
  }

  let terms = [...s.search_terms];
  const termSource = terms.length ? 'given' : 'ai';
  if (!terms.length) {
    for (const icp of icps) {
      const { filters, ...about } = icp;
      const list = await brain.ask(`Search terms - ${icp.name}`, 'medium', prompts.generateSearchTerms(s, about, s.terms_per_icp));
      terms.push(...(Array.isArray(list) ? list : []).map(String));
    }
    const lower = new Set();
    terms = terms.map((t) => t.trim()).filter((t) => t && !lower.has(t.toLowerCase()) && lower.add(t.toLowerCase()));
  }
  const criteria = s.collect_jobs ? await brain.ask('Job criteria', 'medium', prompts.jobCriteria(s)) : null;
  return { icps, icpConversation, terms, termSource, criteria, createdAt: new Date().toISOString() };
}

// Agents 1 to 4. Each saves its results to Results/, so a resumed run skips finished agents.
async function analyse({ s, store, brain, plan, seen, ctx }) {
  const once = async (name, fn) => {
    const saved = store.readJson(['Results', `${name}.json`]);
    if (saved) return saved;
    const value = await fn();
    store.json(['Results', `${name}.json`], value);
    return value;
  };
  const people = Object.values(seen.people).map((parts) => ({ parts, ...store.readJson([...parts, 'profile.json'], {}) })).filter((p) => p.slug);
  const readPostAt = (parts) => store.readJson([...parts, 'post.json']);
  const profilePosts = (p) => (p.posts || []).map((f) => readPostAt([...p.parts, 'Posts', f])).filter(Boolean);
  const searchPostParts = Object.values(seen.posts).filter((parts) => parts.length === 3 && parts[1] === 'Posts');
  const jobs = Object.entries(seen.jobs).map(([id, j]) => ({ id, ...j, ...store.readJson([...j.parts, 'job.json'], {}) }));

  const needed = people.length || searchPostParts.length;
  const signs = needed ? await once('Indicators', () => brain.ask('Agent 1 - indicators', 'medium', prompts.indicators(s))) : [];
  const indicators = Array.isArray(signs) ? signs.map(String) : [];

  // Agent 2: profiles with their posts, profile_batch_size at a time.
  const peopleResults = await once('People', async () => {
    const out = [];
    for (const [b, batch] of batches(people, s.profile_batch_size).entries()) {
      ctx.throwIfStopped();
      const items = batch.map((p, i) => ({
        id: i + 1,
        name: p.name,
        profileText: clip(readText(store, [...p.parts, 'Profile text.txt']), 14000),
        posts: profilePosts(p).map((post) => ({ caption: clip(post.caption, 1500) })),
      }));
      const answer = await brain.ask(`Agent 2 - profiles batch ${b + 1}`, 'power', prompts.classifyProfiles(s, indicators, items, s.delimiter));
      const byId = new Map((Array.isArray(answer) ? answer : []).map((a) => [Number(a.id), a]));
      batch.forEach((p, i) => {
        const a = byId.get(i + 1) || {};
        out.push({
          name: p.name, slug: p.slug, url: p.url, headline: p.headline, term: p.term || null, icp: p.icp || null,
          page: p.page ?? null, intent: p.intent || '', websites: p.websites || [], posts: (p.posts || []).length,
          level: [0, 1, 2].includes(Number(a.level)) ? Number(a.level) : null, evidence: a.evidence || (a.level == null ? 'No answer from the AI for this profile' : ''),
          folder: store.relative(store.path(p.parts)),
        });
      });
    }
    return out;
  });

  // Agent 3: posts with comments and reactions. A profile's posts go in one batch together;
  // posts from searches go post_batch_size at a time.
  const postResults = await once('Posts', async () => {
    const groups = [];
    for (const p of people) {
      const list = (p.posts || []).map((f) => [...p.parts, 'Posts', f]);
      for (const chunk of batches(list, 25)) if (chunk.length) groups.push({ source: `Profile: ${p.name}`, parts: chunk });
    }
    for (const chunk of batches(searchPostParts, s.post_batch_size)) if (chunk.length) groups.push({ source: 'Post search', parts: chunk });
    const out = [];
    for (const [b, group] of groups.entries()) {
      ctx.throwIfStopped();
      const posts = group.parts.map(readPostAt).filter(Boolean);
      if (!posts.length) continue;
      const items = posts.map((post, i) => ({
        id: i + 1,
        author: post.author,
        url: post.url,
        caption: clip(post.caption, 3000),
        comments: (post.comments || []).slice(0, 60).map((c) => ({ author: c.author, profileUrl: c.profileUrl, text: clip(c.text, 600) })),
        reactions: post.reactions || [],
      }));
      const answer = await brain.ask(`Agent 3 - posts batch ${b + 1}`, 'power', prompts.classifyPosts(s, indicators, items, s.delimiter));
      const byId = new Map((Array.isArray(answer) ? answer : []).map((a) => [Number(a.id), a]));
      posts.forEach((post, i) => {
        const a = byId.get(i + 1) || {};
        const parts = group.parts[i];
        out.push({
          urn: post.urn, url: post.url, author: post.author, authorUrl: post.authorUrl, date: post.date,
          source: group.source === 'Post search' ? `Post search: ${parts[0]}` : group.source,
          metrics: post.metrics, caption: clip(post.caption, 300),
          level: [0, 1, 2].includes(Number(a.level)) ? Number(a.level) : null, evidence: a.evidence || '',
          prospects: Array.isArray(a.prospects) ? a.prospects : [],
          folder: store.relative(store.path(parts)),
        });
      });
    }
    return out;
  });

  // Agent 4: jobs, job_batch_size at a time, against the job criteria from the plan.
  const jobResults = await once('Jobs', async () => {
    const out = [];
    if (!jobs.length) return out;
    for (const [b, batch] of batches(jobs, s.job_batch_size).entries()) {
      ctx.throwIfStopped();
      const items = batch.map((j, i) => ({ id: i + 1, title: j.title, company: j.company, url: j.url, text: clip(j.details || j.fullText, 5000) }));
      const answer = await brain.ask(`Agent 4 - jobs batch ${b + 1}`, 'medium', prompts.matchJobs(s, plan.criteria || {}, items, s.delimiter));
      const byId = new Map((Array.isArray(answer) ? answer : []).map((a) => [Number(a.id), a]));
      batch.forEach((j, i) => {
        const a = byId.get(i + 1) || {};
        out.push({
          id: j.id, title: j.title, company: j.company, companyUrl: j.companyUrl, url: j.url, term: j.term, location: j.location || '',
          level: [1, 2, 3].includes(Number(a.level)) ? Number(a.level) : null, evidence: a.evidence || '',
          folder: store.relative(store.path(j.parts)),
        });
      });
    }
    return out;
  });

  return { indicators, people: peopleResults, posts: postResults, jobs: jobResults };
}

function readText(store, parts) {
  try {
    return fs.readFileSync(store.path(parts), 'utf8');
  } catch {
    return '';
  }
}
