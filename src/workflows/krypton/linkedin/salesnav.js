// Sales Navigator: one lead search per ICP, built from the ICP's LinkedIn filters.
//
// Filters are applied two ways, as the workflow doc asks:
//   1. mapped: the known filter names (Geography, Industry, Company headcount, ...) are opened,
//      the value is typed, and the matching suggestion is included;
//   2. fallback: when a mapped step does not work (Sales Navigator changed its layout), a light
//      agent (fast model) is shown the visible controls and walks the menu one step at a time.
// Then every result page is read (lead name, link, card text). When a search finds fewer than
// `sales_nav_min_results` people, the ICP conversation goes back to the AI to broaden it.
// Each lead's profile then goes through the normal profile and post processors.
import * as dom from './dom.js';
import * as prompts from '../prompts.js';
import { safeName } from '../../../core/paths.js';

// ICP filter key -> Sales Navigator filter label. Booleans are toggles under Recent updates.
export const FILTER_LABELS = {
  geography: 'Geography',
  industry: 'Industry',
  company_headcount: 'Company headcount',
  company_type: 'Company type',
  company_headquarters_location: 'Company headquarters location',
  function: 'Function',
  current_job_title: 'Current job title',
  seniority_level: 'Seniority level',
  years_in_current_company: 'Years in current company',
  years_in_current_position: 'Years in current position',
  years_of_experience: 'Years of experience',
  profile_language: 'Profile language',
  changed_jobs: 'Changed jobs',
  posted_on_linkedin: 'Posted on LinkedIn',
};

const searchUrl = (base) => `${base}/sales/search/people`;

export async function salesNavigator({ ctx, li, store, brain, plan, settings: s, processPerson, guarded, note }) {
  const summary = { icps: [] };
  let conversation = plan.icpConversation
    ? [{ role: 'user', content: plan.icpConversation.prompt }, { role: 'assistant', content: plan.icpConversation.answer }]
    : null;
  for (const original of plan.icps) {
    ctx.throwIfStopped();
    const dir = ['Sales Navigator', safeName(original.name, 60)];
    let icp = original;
    let leads = store.readJson([...dir, 'People', '_results.json']);
    const row = { name: original.name, total: null, leads: 0, broadened: 0, profiles: 0 };
    if (!leads) {
      const byId = new Map();
      for (let round = 0; ; round += 1) {
        await ctx.progress({ checkpoint: `Sales Navigator: ${icp.name}${round ? ` (broadened ${round}x)` : ''}` });
        const found = await guarded(`Sales Navigator "${icp.name}"`, () => searchLeads(li, brain, icp, { maxPages: s.sales_nav_max_pages, log: ctx.log }));
        if (!found) break;
        for (const l of found.leads) if (!byId.has(l.leadId)) byId.set(l.leadId, { ...l, round });
        row.total = found.total;
        store.json([...dir, `Search ${round + 1}.json`], { icp, total: found.total, leads: found.leads.length, applied: found.applied });
        const count = found.total ?? found.leads.length;
        if (count >= s.sales_nav_min_results || round >= s.sales_nav_broaden_rounds || !conversation) break;
        ctx.log.info(`Sales Navigator "${icp.name}" found ${count} people; asking the AI to broaden the ICP`);
        const messages = [...conversation, { role: 'user', content: prompts.broadenIcp(icp, count, s.sales_nav_min_results) }];
        const { data, text } = await brain.ask(`Broaden ICP - ${icp.name}`, 'power', { system: plan.icpConversation.system, messages, json: 'raw' });
        conversation = [...messages, { role: 'assistant', content: text }];
        icp = { ...icp, ...(Array.isArray(data) ? data[0] : data), name: original.name };
        row.broadened += 1;
      }
      leads = [...byId.values()];
      store.json([...dir, 'ICP.json'], icp);
      store.json([...dir, 'People', '_results.json'], leads);
    }
    row.leads = leads.length;
    const todo = s.max_profiles_per_icp > 0 ? leads.slice(0, s.max_profiles_per_icp) : leads;
    if (s.collect_profiles) {
      for (const [n, lead] of todo.entries()) {
        ctx.throwIfStopped();
        await ctx.progress({ checkpoint: `Sales Navigator "${original.name}" profile ${n + 1}/${todo.length}` });
        const person = { slug: lead.leadId, name: lead.name, url: `${li.base}/in/${lead.leadId}/`, text: lead.text, page: lead.page };
        const rec = await processPerson([...dir, 'People'], person, { icp: original.name, salesUrl: lead.salesUrl });
        if (rec) row.profiles += 1;
      }
    }
    if (!leads.length) note(`Sales Navigator "${original.name}": no leads found`);
    summary.icps.push(row);
  }
  return summary;
}

async function openSearch(li) {
  await li.visit(searchUrl(li.base), 'linkedin.search_page', { waitFor: 'body' });
  const url = await li.currentUrl();
  if (!/\/sales\/search/.test(url)) throw new Error(`Sales Navigator did not open (landed on ${url}). This LinkedIn account needs a Sales Navigator seat.`);
}

export async function searchLeads(li, brain, icp, { maxPages = 0, log }) {
  await openSearch(li);
  const filters = icp.filters || {};
  const applied = [];
  if (filters.keywords) applied.push({ filter: 'keywords', ok: await setKeywords(li, filters.keywords) });
  for (const [key, label] of Object.entries(FILTER_LABELS)) {
    const value = filters[key];
    if (value == null || value === '' || value === false || (Array.isArray(value) && !value.length)) continue;
    const values = value === true ? [true] : [].concat(value).map(String).filter(Boolean);
    for (const v of values) {
      let ok = await applyMapped(li, label, v);
      let how = 'mapped';
      if (!ok) {
        ok = await applyWithAgent(li, brain, label, v, log);
        how = 'agent';
      }
      applied.push({ filter: label, value: v, ok, how });
      if (!ok) log.warn(`Sales Navigator: could not set ${label} = ${v}`);
    }
  }
  // Read the results, page by page.
  await li.pause(1500, 2500);
  const total = await li.evaluate(dom.resultsTotal);
  const leads = [];
  const limit = maxPages > 0 ? Math.min(maxPages, 100) : 100;
  for (let page = 1; page <= limit; page += 1) {
    for (let i = 0; i < 12; i += 1) {
      const moved = await li.evaluate(dom.scrollInside, { selectors: ['#search-results-container', '[class*="search-results__result-list"]', '[class*="search-results-container"]'], near: 'a[href*="/sales/lead/"]' });
      if (!moved) break;
      await li.pause(400, 900);
    }
    const found = (await li.evaluate(dom.salesLeads)).filter((l) => !leads.some((x) => x.leadId === l.leadId));
    if (!found.length) break;
    leads.push(...found.map((l) => ({ ...l, page })));
    log.info(`Sales Navigator "${icp.name}" page ${page}: ${found.length} leads`);
    if (page === limit) break;
    await li.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    const next = await li.clickText({ ariaPattern: '^next$', textPattern: '^next$' });
    if (!next) break;
    await li.settle('body');
    await li.pause(1200, 2200);
  }
  return { total, leads, applied };
}

async function setKeywords(li, keywords) {
  const token = `kw${Date.now()}`;
  const found = await li.evaluate((t) => {
    const input = [...document.querySelectorAll('input')].find((i) => /search keywords|keywords/i.test(`${i.placeholder} ${i.getAttribute('aria-label') || ''}`) && i.getBoundingClientRect().width > 0);
    if (!input) return false;
    input.setAttribute('data-alpha-target', t);
    return true;
  }, token);
  if (!found) return false;
  await li.page.fill(`[data-alpha-target="${token}"]`, String(keywords));
  await li.page.press(`[data-alpha-target="${token}"]`, 'Enter');
  await li.settle('body');
  return true;
}

// The mapped path: open the filter by its label, type the value, include the suggestion.
async function applyMapped(li, label, value) {
  const token = `f${Date.now()}`;
  let block = await li.evaluate(dom.filterBlock, { label, token });
  if (!block.found) return false;
  const before = block.text.toLowerCase();
  if (value === 'true') {
    await li.page.click(`[data-alpha-target="${token}-head"]`).catch(() => {});
    await li.pause(900, 1600);
    return true;
  }
  if (!block.hasInput && block.expanded !== 'true') {
    await li.page.click(`[data-alpha-target="${token}-head"]`).catch(() => {});
    await li.pause(700, 1300);
    block = await li.evaluate(dom.filterBlock, { label, token });
  }
  if (block.hasInput) {
    const input = `[data-alpha-target="${token}-input"]`;
    await li.page.click(input).catch(() => {});
    await li.page.fill(input, '').catch(() => {});
    await li.page.type(input, value, { delay: 60 }).catch(() => li.page.fill(input, value));
    await li.pause(1200, 2000);
  }
  const option = await li.evaluate(dom.markOption, { token: `${token}-opt`, block: token, value, forbidden: li.sel.patterns.forbidden });
  if (!option) return false;
  await li.page.click(`[data-alpha-target="${token}-opt"]`).catch(() => {});
  await li.pause(900, 1600);
  const after = await li.evaluate(dom.filterBlock, { label, token });
  const want = value.toLowerCase();
  return after.found && after.text.toLowerCase().includes(want) && (!before.includes(want) || after.text.length !== before.length);
}

// The fallback path: a light agent picks one control at a time until the filter is set.
async function applyWithAgent(li, brain, label, value, log, maxSteps = 10) {
  const goal = value === 'true'
    ? `Turn on the "${label}" filter.`
    : `Set the "${label}" filter to include "${value}" (open the filter, type the value if there is a box, then choose Include on the matching suggestion).`;
  const history = [];
  for (let step = 1; step <= maxSteps; step += 1) {
    const controls = await li.evaluate(dom.controlsSnapshot, { forbidden: li.sel.patterns.forbidden });
    const list = controls.map((c) => `${c.n}. <${c.tag}${c.role ? ` role=${c.role}` : ''}> ${c.text || ''}${c.aria ? ` [aria: ${c.aria}]` : ''}${c.placeholder ? ` [placeholder: ${c.placeholder}]` : ''}${c.expanded ? ` [expanded=${c.expanded}]` : ''}${c.checked ? ` [checked=${c.checked}]` : ''}`).join('\n');
    const answer = await brain.ask(`Sales Navigator agent - ${label} - step ${step}`, 'fast', {
      system: 'You operate the search filters of LinkedIn Sales Navigator for a read-only lead search. You only open filters, type into filter boxes and include suggestions. Never save, message, connect, follow or send anything. Answer with one JSON object.',
      prompt: `Goal: ${goal}

Steps taken so far:
${history.length ? history.join('\n') : '(none)'}

Visible controls:
${list}

Choose the next step. Return one JSON object:
{ "action": "click" | "type" | "done" | "give_up", "n": <control number for click or type>, "text": "<text to type>", "reason": "<short>" }
Use "done" when the filter now includes the value, "give_up" if it cannot be done.`,
    });
    const act = answer && typeof answer === 'object' ? answer : {};
    history.push(`${step}. ${act.action}${act.n ? ` #${act.n}` : ''}${act.text ? ` "${act.text}"` : ''} (${act.reason || ''})`);
    if (act.action === 'done') return true;
    if (act.action !== 'click' && act.action !== 'type') return false;
    const target = controls.find((c) => c.n === Number(act.n));
    if (!target) continue;
    const forbidden = new RegExp(li.sel.patterns.forbidden, 'i');
    if (forbidden.test(target.text) || forbidden.test(target.aria)) {
      log.warn(`Sales Navigator agent picked "${target.text || target.aria}"; refused (read-only)`);
      continue;
    }
    const sel = `[data-alpha-snap="${target.n}"]`;
    try {
      if (act.action === 'click') await li.page.click(sel, { timeout: 8000 });
      else {
        await li.page.fill(sel, '');
        await li.page.type(sel, String(act.text || value), { delay: 60 });
      }
    } catch (err) {
      history.push(`   (that failed: ${err.message.split('\n')[0]})`);
    }
    await li.pause(900, 1600);
  }
  return false;
}
