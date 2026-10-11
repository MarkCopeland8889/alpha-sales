// Job reader: opens a job, expands the description and copies the whole page text plus the
// company link. It never clicks Apply (or anything else that sends something).
import * as dom from './dom.js';
import { urls } from './selectors.js';

export async function readJob(li, id) {
  await li.visit(urls.job(li.base, id), 'linkedin.job_view');
  await li.expandAll('main', 3);
  const job = await li.evaluate(dom.jobDetails, li.sel);
  return { id, ...job };
}

export function saveJob(store, parts, job) {
  store.text([...parts, 'Job text.txt'], job.fullText);
  store.text([...parts, 'Company URL.txt'], job.companyUrl || '(no company page linked)');
  store.json([...parts, 'job.json'], { ...job, savedAt: new Date().toISOString() });
}
