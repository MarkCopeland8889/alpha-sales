// Job reader: reads a job from the search list's side pane (or opens its page), expands the
// description and copies the whole text plus the company link. It never clicks Apply (or
// anything else that sends something).
import * as dom from './dom.js';
import { urls } from './selectors.js';

export async function readJob(li, id) {
  await li.visit(urls.job(li.base, id), 'linkedin.job_view');
  await li.expandAll('main', 3);
  const job = await li.evaluate(dom.jobDetails, { sel: li.sel });
  return { id, ...job };
}

// Reads a job from the search results' side pane: clicks its card in the list (no new page
// load), waits for the pane to show it, expands the description and reads the pane. Returns
// null when that doesn't work, so the caller can open the job page instead.
export async function readJobInPane(li, id) {
  await li.action('linkedin.job_view');
  try {
    const clicked = await li.clickText({ selectors: [`a[href*="/jobs/view/${id}"]`, `a[href*="currentJobId=${id}"]`, `[data-job-id="${id}"]`, `[data-occludable-job-id="${id}"]`] });
    if (!clicked) return null;
    await li.page.waitForFunction(({ jobId, panes }) => {
      if (location.pathname.includes('/jobs/view/')) return true; // the click opened the job page
      const pane = panes.map((s) => document.querySelector(s)).find(Boolean);
      return Boolean(pane) && (location.href.includes(`currentJobId=${jobId}`) || Boolean(pane.querySelector(`a[href*="/jobs/view/${jobId}"]`)));
    }, { jobId: id, panes: li.sel.jobPane }, { timeout: 10000 });
    if ((await li.currentUrl()).includes('/jobs/view/')) return null;
    await li.pause(600, 1200);
    await li.expandAll(li.sel.jobPane.join(','), 3);
    const job = await li.evaluate(dom.jobDetails, { sel: li.sel, roots: li.sel.jobPane });
    if (!job || !job.fullText) return null;
    return { id, ...job, url: urls.job(li.base, id) };
  } catch {
    return null;
  }
}

export function saveJob(store, parts, job) {
  store.text([...parts, 'Job text.txt'], job.fullText);
  store.text([...parts, 'Company URL.txt'], job.companyUrl || '(no company page linked)');
  store.json([...parts, 'job.json'], { ...job, savedAt: new Date().toISOString() });
}
