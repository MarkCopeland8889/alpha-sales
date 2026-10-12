// Krypton's data store, following the layout in the workflow doc:
//
//   Local Files/Krypton/Run <date>/
//     Config/config.json                   settings, ICPs, search terms, job criteria
//     <Search term>/
//       People/_results.json               every search result with the page it was on
//       People/<Person>/Profile text.txt   + images, featured.json, websites.txt, Posts/<Post>/...
//       Jobs/<Job title - Company>/        Job text.txt, Company URL.txt, job.json
//       Posts/<Post>/                      Post caption.txt, media, Interactions.json
//                                          (reactions, then comments with profiles), Reactions.json, Comments.json
//       Groups/<Group>/                    Group text.txt, Group URL.txt
//     AI Runs/                             every prompt and answer
//     Results/                             People.json, Posts.json, Jobs.json (AI levels)
//     Report.md / Report.html
//
// Every unit writes a marker file last (profile.json, post.json, job.json), so a resumed run
// skips what is already saved.
import fs from 'node:fs';
import path from 'node:path';
import { datastore } from '../../scrapers/datastore.js';
import { safeName } from '../../core/paths.js';

const MEDIA_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'application/pdf': '.pdf' };

export function runFolderName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `Run ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

export function createStore(folder) {
  const base = datastore('Krypton', folder);

  // Downloads an image or file. Uses the browser's cookies when the page supports it.
  async function media(page, url, parts) {
    let buf;
    let type = '';
    if (page?.request) {
      const res = await page.request.get(url, { timeout: 30000 });
      if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
      type = res.headers()['content-type'] || '';
      buf = await res.body();
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      type = res.headers.get('content-type') || '';
      buf = Buffer.from(await res.arrayBuffer());
    }
    const list = [].concat(parts);
    const last = list.pop();
    const ext = MEDIA_EXT[type.split(';')[0].trim()] || path.extname(new URL(url).pathname).slice(0, 5) || '.bin';
    const file = base.path([...list, `${last}${ext}`]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return file;
  }

  // Copies a folder already saved under another search term (same person, job or post).
  function copy(fromParts, toParts) {
    const from = base.path(fromParts);
    const to = base.path(toParts);
    if (!fs.existsSync(from) || fs.existsSync(to)) return false;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
    return true;
  }

  return { ...base, folder, media, copy, relative: (file) => path.relative(base.root, file) };
}

// Folder names
export const termFolder = (term) => safeName(term, 80);
export const personFolder = (p) => safeName(`${p.name || p.slug} (${p.slug})`, 100);
export const jobFolder = (j) => safeName(`${j.title || 'Job'} - ${j.company || 'Unknown company'} (${j.id})`, 110);
export const groupFolder = (g) => safeName(`${g.name} (${g.id})`, 100);
export function postFolder(p) {
  const words = String(p.caption || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
  const id = String(p.urn || '').split(':').pop().slice(-6);
  return safeName(`${p.author || 'Post'} - ${words || 'no text'} (${id})`, 110);
}
