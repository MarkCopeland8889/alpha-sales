// Local data sink for scraped results: folders of plain files under "Local Files".
// Folder and file names are made safe automatically, so scraped names can be used as is.
//
//   const store = datastore('LinkedIn', `Run ${date}`);
//   store.text(['accounting software', 'People', 'Jane Doe', 'Profile text.txt'], pageText);
//   store.json(['accounting software', 'Jobs', 'Bookkeeper - Acme', 'job.json'], job);
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, safeName, ensureDir } from '../core/paths.js';

export function datastore(...rootParts) {
  const root = path.join(PATHS.localFiles, ...rootParts.map((p) => safeName(p, 120)));
  const resolve = (parts) => path.join(root, ...[].concat(parts).map((p) => safeName(p, 120)));

  return {
    root,
    path: resolve,
    dir(parts) {
      return ensureDir(resolve(parts));
    },
    exists(parts) {
      return fs.existsSync(resolve(parts));
    },
    text(parts, content) {
      const file = resolve(parts);
      ensureDir(path.dirname(file));
      fs.writeFileSync(file, String(content ?? ''));
      return file;
    },
    json(parts, data) {
      const file = resolve(parts);
      ensureDir(path.dirname(file));
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      return file;
    },
    append(parts, line) {
      const file = resolve(parts);
      ensureDir(path.dirname(file));
      fs.appendFileSync(file, `${typeof line === 'string' ? line : JSON.stringify(line)}\n`);
      return file;
    },
    readJson(parts, fallback = null) {
      try {
        return JSON.parse(fs.readFileSync(resolve(parts), 'utf8'));
      } catch {
        return fallback;
      }
    },
    // Downloads a URL (image, video, file) using the page's cookies when a page is given.
    async download(url, parts, page) {
      const file = resolve(parts);
      ensureDir(path.dirname(file));
      let buf;
      if (page?.request) {
        const res = await page.request.get(url);
        buf = await res.body();
      } else {
        const res = await fetch(url);
        buf = Buffer.from(await res.arrayBuffer());
      }
      fs.writeFileSync(file, buf);
      return file;
    },
    async screenshot(page, parts, opts = {}) {
      const file = resolve(parts);
      ensureDir(path.dirname(file));
      await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
      return file;
    },
  };
}
