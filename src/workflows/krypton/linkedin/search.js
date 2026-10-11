// LinkedIn search result readers: people, jobs, posts (content) and groups.
// They page through results and return plain lists; saving is done by the workflow.
import * as dom from './dom.js';
import { urls } from './selectors.js';

const LINKEDIN_MAX_PAGES = 100; // LinkedIn stops at 100 pages of people results

// People: every result on every page, with the page number it was listed on.
export async function searchPeople(li, term, { maxPages = 0, onPage } = {}) {
  const seen = new Map();
  const limit = maxPages > 0 ? Math.min(maxPages, LINKEDIN_MAX_PAGES) : LINKEDIN_MAX_PAGES;
  for (let n = 1; n <= limit; n += 1) {
    const state = await li.visit(urls.peopleSearch(li.base, term, n), 'linkedin.search_page');
    if (state.noResults) break;
    await li.scrollToEnd(4);
    const results = await li.evaluate(dom.peopleResults, li.sel);
    const fresh = results.filter((r) => !seen.has(r.slug));
    await onPage?.(n, await li.evaluate(dom.mainText), results);
    if (!fresh.length) break; // an empty page, or LinkedIn repeating the last page
    for (const r of fresh) seen.set(r.slug, { ...r, page: n });
    li.log.info(`People "${term}" page ${n}: ${fresh.length} results`);
  }
  return [...seen.values()];
}

// Jobs: one search per location; pages of 25 (&start=25*n). Returns job ids in listed order.
export async function searchJobs(li, term, location, { maxJobs = 0, maxPages = 0 } = {}) {
  const ids = [];
  const limit = maxPages > 0 ? Math.min(maxPages, 40) : 40;
  for (let n = 0; n < limit; n += 1) {
    const state = await li.visit(urls.jobsSearch(li.base, term, location, n * 25), 'linkedin.search_page');
    if (state.noResults) break;
    // The job list is its own scrolling pane; cards load as it scrolls.
    for (let i = 0; i < 10; i += 1) {
      const moved = await li.evaluate(dom.scrollInside, { selectors: li.sel.jobsList, near: li.sel.jobCard[0] });
      if (!moved) break;
      await li.pause(500, 1100);
    }
    const found = await li.evaluate(dom.jobIds, li.sel);
    const fresh = found.filter((id) => !ids.includes(id));
    if (!fresh.length) break;
    ids.push(...fresh);
    li.log.info(`Jobs "${term}"${location ? ` in ${location}` : ''} page ${n + 1}: ${fresh.length} jobs`);
    if (maxJobs > 0 && ids.length >= maxJobs) return ids.slice(0, maxJobs);
    if (found.length < 25) break; // a short page is the last page
  }
  return ids;
}

// Posts (content search): load more results up to `loadMore` times, then return post ids.
export async function searchPosts(li, term, { loadMore = 20 } = {}) {
  const state = await li.visit(urls.contentSearch(li.base, term), 'linkedin.search_page');
  if (state.noResults) return [];
  let urns = await li.evaluate(dom.postUrns);
  let idle = 0;
  for (let i = 0; i < loadMore && idle < 2; i += 1) {
    await li.scrollToEnd(3);
    const clicked = await li.clickText({ textPattern: li.sel.patterns.showMoreResults });
    const next = await li.evaluate(dom.postUrns);
    idle = !clicked && next.length === urns.length ? idle + 1 : 0;
    urns = next;
  }
  li.log.info(`Posts "${term}": ${urns.length} posts`);
  return urns;
}

// Groups: names, links and the text shown in the results. Krypton never joins groups.
export async function searchGroups(li, term, { maxPages = 0 } = {}) {
  const seen = new Map();
  const limit = maxPages > 0 ? maxPages : 10;
  for (let n = 1; n <= limit; n += 1) {
    const state = await li.visit(urls.groupsSearch(li.base, term, n), 'linkedin.search_page');
    if (state.noResults) break;
    await li.scrollToEnd(3);
    const fresh = (await li.evaluate(dom.groupResults)).filter((g) => !seen.has(g.id));
    if (!fresh.length) break;
    for (const g of fresh) seen.set(g.id, { ...g, page: n });
  }
  return [...seen.values()];
}
