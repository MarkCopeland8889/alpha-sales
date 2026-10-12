// Page readers that run inside the browser (page.evaluate). Each function is
// self-contained: it receives the selector set as its only argument and returns plain data.
// They prefer stable structure (profile links, data-urn ids, job ids) over class names.

export function pageState(sel) {
  const text = document.body ? document.body.innerText : '';
  const path = location.pathname;
  return {
    url: location.href,
    title: document.title,
    loginWall: /\/(login|authwall|checkpoint|uas\/login|signup)/.test(path) || Boolean(document.querySelector('#session_key, form[action*="login-submit"]')),
    noResults: new RegExp(sel.patterns.noResults, 'i').test(text.slice(0, 5000)),
  };
}

// Finds the first visible element matching the description, tags it with data-alpha-target
// so Playwright can click it for real, and refuses anything that would send, apply or react.
export function markTarget(spec) {
  const { scope, selectors = [], textPattern, ariaPattern, token, forbidden, nth = 0 } = spec;
  const roots = scope ? [...document.querySelectorAll(scope)] : [document];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const textRe = textPattern ? new RegExp(textPattern, 'i') : null;
  const ariaRe = ariaPattern ? new RegExp(ariaPattern, 'i') : null;
  const bad = new RegExp(forbidden, 'i');
  const found = [];
  for (const root of roots) {
    const pool = selectors.length ? root.querySelectorAll(selectors.join(',')) : root.querySelectorAll('button, a[role="button"], [role="button"], a');
    for (const el of pool) {
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const aria = el.getAttribute('aria-label') || '';
      const matches = (!textRe && !ariaRe)
        || (textRe && (textRe.test(text) || (!ariaRe && textRe.test(aria))))
        || (ariaRe && (ariaRe.test(aria) || ariaRe.test(text)));
      if (!matches) continue;
      if (bad.test(text) || bad.test(aria)) continue;
      if (el.getAttribute('aria-expanded') === 'true' && !spec.allowExpanded) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (!visible(el)) continue;
      found.push(el);
    }
  }
  const el = found[nth];
  if (!el) return null;
  document.querySelectorAll('[data-alpha-target]').forEach((e) => e.removeAttribute('data-alpha-target'));
  el.setAttribute('data-alpha-target', token);
  el.scrollIntoView({ block: 'center' });
  return { text: (el.innerText || '').trim().slice(0, 80), aria: el.getAttribute('aria-label') || '' };
}

export function countTargets(spec) {
  const { scope, textPattern, forbidden } = spec;
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return 0;
  const re = new RegExp(textPattern, 'i');
  const bad = new RegExp(forbidden, 'i');
  return [...root.querySelectorAll('button, [role="button"]')].filter((el) => {
    const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
    const r = el.getBoundingClientRect();
    return re.test(t) && !bad.test(t) && el.getAttribute('aria-expanded') !== 'true' && r.width > 0 && r.height > 0;
  }).length;
}

export function peopleResults(sel) {
  const root = document.querySelector('main') || document.body;
  // Screen-reader-only copies ("View Jane's profile") would otherwise show up in the text.
  const hidden = [...root.querySelectorAll('.visually-hidden, [class*="visually-hidden"]')];
  hidden.forEach((el) => el.setAttribute('data-alpha-hidden', el.style.display || '-'));
  hidden.forEach((el) => { el.style.display = 'none'; });
  const lines = (el) => (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const cards = new Map();
  for (const a of root.querySelectorAll('a[href*="/in/"]')) {
    const m = a.href.match(/\/in\/([^/?#]+)/);
    if (!m) continue;
    let card = null;
    for (const s of sel.peopleCard) {
      card = a.closest(s);
      if (card && card !== root) break;
      card = null;
    }
    if (!card || cards.has(card)) continue;
    const slug = decodeURIComponent(m[1]);
    // The name is the shortest first line among the card's links to this person: the newer
    // layout wraps the whole card in one link, with the bare name in a smaller link inside it.
    const names = [a, ...card.querySelectorAll('a[href*="/in/"]')]
      .filter((x) => (x.href.match(/\/in\/([^/?#]+)/) || [])[1] === m[1])
      .map((x) => lines(x.querySelector('span[aria-hidden="true"]') || x)[0] || '')
      .filter((n) => n && !/^view\b/i.test(n) && n.length <= 120)
      .sort((x, y) => x.length - y.length);
    const name = names[0] || lines(card)[0] || slug;
    const text = [...new Set(lines(card))].filter((l) => !/^(connect|message|follow|view .*profile)$/i.test(l)).join('\n');
    cards.set(card, { slug, name, url: `${location.origin}/in/${slug}/`, text: text.slice(0, 1500) });
  }
  hidden.forEach((el) => {
    const was = el.getAttribute('data-alpha-hidden');
    el.style.display = was === '-' ? '' : was;
    el.removeAttribute('data-alpha-hidden');
  });
  // One entry per person (a card can repeat across lazy-loaded sections).
  const bySlug = new Map();
  for (const r of cards.values()) if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
  return [...bySlug.values()];
}

export function profileTop(sel) {
  // Links on the 2026 pages go through /safety/go/?url=<real address>. (Each reader runs in the
  // page on its own, so helpers live inside it.)
  const outUrl = (href) => {
    try {
      const u = new URL(href, location.href);
      const real = /\/safety\/go\/?$/.test(u.pathname) && u.searchParams.get('url');
      return real ? (/^https?:\/\//i.test(real) ? real : `https://${real}`) : u.href;
    } catch {
      return null;
    }
  };
  // The largest copy in an <img>'s srcset (LinkedIn serves 100px to 800px versions).
  const bestSrc = (img) => {
    if (!img) return null;
    const set = (img.getAttribute('srcset') || '').split(',').map((x) => x.trim().split(/\s+/)).filter(([u]) => u)
      .map(([u, w]) => [u, Number.parseInt(w, 10) || 0]).sort((a, b) => b[1] - a[1]);
    const url = set[0]?.[0] || img.getAttribute('src');
    return url && !url.startsWith('data:') ? new URL(url, location.href).href : null;
  };
  const main = document.querySelector('main') || document.body;
  // 2026 layout (SDUI): obfuscated classes, the top card is [componentkey$="Topcard"] with an h2 name.
  const top = document.querySelector('[componentkey$="Topcard"]') || main.querySelector('section') || main;
  const pick = (list, scope = top) => {
    for (const s of list) {
      const el = scope.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const heading = top.querySelector('h1') || top.querySelector('h2');
  const name = ((heading?.innerText || '').trim() || document.title.split('|')[0]).replace(/^\(\d+\)\s*/, '').trim();
  const header = top.querySelector('img[alt="Cover photo"]') || pick(sel.headerImage);
  let photo = top.querySelector('[aria-label="Profile photo"] img, [componentkey="topcard-logo-image-referencekey"] img') || pick(sel.profileImage);
  if (!photo && name) photo = [...top.querySelectorAll('img')].find((i) => i !== header && i.alt && i.alt.includes(name)) || null;
  let headline = (pick(sel.headline)?.innerText || '').trim();
  if (!headline && heading) {
    // The first line after the name that is not pronouns ("She/Her") or the degree ("· 2nd").
    const skip = /^[·•]|^(she|he|they|ze|xe)\s*\/\s*\w+$|^\d+(st|nd|rd|th)\+?$/i;
    const after = [...top.querySelectorAll('p')].filter((el) => !heading.contains(el) && (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    headline = after.map((el) => (el.innerText || '').trim()).find((t) => t.length > 2 && !skip.test(t)) || '';
  }
  const websites = [...new Set([...top.querySelectorAll('a[href*="/safety/go/"]')].map((a) => outUrl(a.href)).filter(Boolean))];
  const hasActivity = Boolean(document.querySelector('#activity, a[href*="/recent-activity/"], [componentkey$="Activity"]'));
  return { name, headline, photoUrl: bestSrc(photo), headerUrl: bestSrc(header), websites, hasActivity };
}

export function hasActivity() {
  return Boolean(document.querySelector('#activity, a[href*="/recent-activity/"], [componentkey$="Activity"]'));
}

// The profile itself, without navigation, "People you may know" and the footer.
export function profileText() {
  const el = document.querySelector('section[aria-label="Primary content"]') || document.querySelector('main') || document.body;
  return (el.innerText || '').trim();
}

export function featured() {
  // Links on the 2026 pages go through /safety/go/?url=<real address>. (Each reader runs in the
  // page on its own, so helpers live inside it.)
  const outUrl = (href) => {
    try {
      const u = new URL(href, location.href);
      const real = /\/safety\/go\/?$/.test(u.pathname) && u.searchParams.get('url');
      return real ? (/^https?:\/\//i.test(real) ? real : `https://${real}`) : u.href;
    } catch {
      return null;
    }
  };
  const sections = [...document.querySelectorAll('main section, [componentkey$="Featured"]')];
  const sec = sections.find((s) => (s.getAttribute('componentkey') || '').endsWith('Featured') || s.querySelector('#featured') || /^\s*featured\s*$/im.test(s.querySelector('h2, h3')?.innerText || ''));
  if (!sec) return null;
  const seen = new Set();
  const items = [];
  for (const a of sec.querySelectorAll('a[href]')) {
    const url = a.href && !a.href.startsWith('javascript') ? outUrl(a.href) : null;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = (a.innerText || a.getAttribute('aria-label') || '').trim().split('\n')[0].slice(0, 200);
    const host = new URL(url).hostname;
    items.push({ title, url, external: !/(^|\.)linkedin\.com$/.test(host) && host !== location.hostname });
  }
  return { items };
}

export function postUrns() {
  const urns = new Set();
  for (const el of document.querySelectorAll('[data-urn], [data-id], [data-chameleon-result-urn]')) {
    const v = el.getAttribute('data-urn') || el.getAttribute('data-id') || el.getAttribute('data-chameleon-result-urn') || '';
    if (/^urn:li:(activity|ugcPost|share):\d+/.test(v)) urns.add(v.match(/^urn:li:\w+:\d+/)[0]);
  }
  for (const a of document.querySelectorAll('a[href*="/feed/update/urn:li:"]')) {
    const m = a.href.match(/urn:li:(activity|ugcPost|share):\d+/);
    if (m) urns.add(m[0]);
  }
  return [...urns];
}

export function postDetails(sel) {
  const pick = (list, scope) => {
    for (const s of list) {
      const el = scope.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  let post = null;
  for (const s of sel.postContainer) {
    post = document.querySelector(s);
    if (post) break;
  }
  post ||= document.querySelector('main') || document.body;
  const firstLine = (el) => ((el?.innerText || '').split('\n').map((s) => s.trim()).find(Boolean) || '');
  const actorEl = pick(sel.postActor, post);
  const links = [...post.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')];
  const actorLink = links.find((a) => firstLine(a)) || links[0] || null;
  const textEl = pick(sel.postText, post);
  const num = (s) => {
    const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KkMm])?/);
    if (!m) return null;
    return Math.round(Number(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1000 : 1000000) : 1));
  };
  const metrics = { reactions: null, comments: null, reposts: null };
  for (const el of post.querySelectorAll('button, a, span, li')) {
    if (el.closest('article, .comments-comment-item')) continue;
    const label = `${el.getAttribute('aria-label') || ''} ${(el.innerText || '').trim()}`.replace(/\s+/g, ' ');
    if (label.length > 80) continue;
    if (metrics.reactions == null && /[\d,.]+[KkMm]?\s+reactions?\b/i.test(label)) metrics.reactions = num(label.match(/[\d,.]+[KkMm]?(?=\s+reactions?)/i)[0]);
    if (metrics.comments == null && /[\d,.]+[KkMm]?\s+comments?\b/i.test(label)) metrics.comments = num(label.match(/[\d,.]+[KkMm]?(?=\s+comments?)/i)[0]);
    if (metrics.reposts == null && /[\d,.]+[KkMm]?\s+(reposts?|shares?)\b/i.test(label)) metrics.reposts = num(label.match(/[\d,.]+[KkMm]?(?=\s+(reposts?|shares?))/i)[0]);
  }
  if (metrics.reactions == null) {
    const others = post.innerText.match(/and ([\d,.]+[KkMm]?) others?/i);
    if (others) metrics.reactions = (num(others[1]) || 0) + 1;
  }
  // 2026 layout (SDUI): the counts sit inside the Like, Comment and Repost buttons themselves;
  // a zero is an empty (zero-width space) count. Read only, never clicked.
  const count = (selector) => {
    const b = post.querySelector(selector);
    if (!b) return null;
    const t = (b.innerText || '').replace(/[\u200B\s]+/g, ' ').trim();
    return t ? num(t) : 0;
  };
  metrics.reactions ??= count('button[aria-label^="Reaction button state"]');
  metrics.comments ??= count('button[aria-label="Comment"]');
  metrics.reposts ??= count('button[aria-label="Repost"]');
  const bestSrc = (i) => {
    const set = (i.getAttribute('srcset') || '').split(',').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]);
    set.sort((a, b) => (parseInt(b[1], 10) || 0) - (parseInt(a[1], 10) || 0));
    return set.length ? new URL(set[0][0], location.href).href : i.src;
  };
  const images = [...post.querySelectorAll('img')]
    .filter((i) => i.src && !i.src.startsWith('data:') && !i.closest('article, .comments-comment-item, .update-components-actor, [class*="actor"], a[href*="/in/"], a[href*="/company/"]'))
    .filter((i) => Math.max(i.naturalWidth, i.width, Number(i.getAttribute('width')) || 0) >= 200 || /update-components-image|feed-shared-image|carousel/i.test(i.className + (i.parentElement?.className || '')))
    .map(bestSrc);
  const video = post.querySelector('video');
  const doc = post.querySelector('.update-components-document__container, iframe[title*="document" i]');
  // SDUI: the date is a plain line under the actor ("Nov 13, 2022" or "2w").
  const sduiDate = () => {
    const DATE = /^(\d+\s*(s|m|h|d|w|mo|yr|y)\b|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b)/i;
    return [...post.querySelectorAll('p')].slice(1, 8).map((x) => (x.innerText || '').trim()).find((t) => DATE.test(t)) || '';
  };
  return {
    urn: post.getAttribute('data-urn') || null,
    url: location.href,
    author: firstLine(actorEl) || firstLine(actorLink),
    authorUrl: actorLink ? actorLink.href.split('?')[0] : null,
    date: firstLine(pick(sel.postDate, post)) || sduiDate(),
    caption: (textEl?.innerText || '').trim(),
    metrics,
    media: {
      images: [...new Set(images)],
      video: video ? (video.currentSrc || video.src || video.poster || 'video') : null,
      document: doc ? (doc.getAttribute('title') || 'document') : null,
    },
  };
}

export function comments(sel) {
  const items = [...document.querySelectorAll(sel.commentItem.join(','))];
  const pick = (list, scope) => {
    for (const s of list) {
      const el = scope.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    const link = item.querySelector('a[href*="/in/"], a[href*="/company/"]');
    const nameEl = pick(sel.commentAuthorName, item);
    const author = ((nameEl || link)?.innerText || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
    const textEl = pick(sel.commentText, item);
    out.push({
      author,
      profileUrl: link ? link.href.split('?')[0] : null,
      headline: (pick(sel.commentAuthorHeadline, item)?.innerText || '').trim().split('\n')[0],
      text: (textEl?.innerText || '').trim(),
      isReply: Boolean(item.parentElement?.closest(sel.commentItem.join(','))),
    });
  }
  return out;
}

export function reactionsDialog(sel) {
  let dialog = null;
  for (const s of sel.reactionsDialog) {
    dialog = document.querySelector(s);
    if (dialog) break;
  }
  if (!dialog) return null;
  const people = [];
  const seen = new Set();
  for (const li of dialog.querySelectorAll('li')) {
    const a = li.querySelector('a[href*="/in/"], a[href*="/company/"]');
    if (!a) continue;
    const url = a.href.split('?')[0];
    if (seen.has(url)) continue;
    seen.add(url);
    const lines = (a.innerText || li.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const icon = li.querySelector(sel.reactionIcon.join(','));
    people.push({
      name: lines[0] || '',
      headline: lines.find((l, i) => i > 0 && !/^·|^\d(st|nd|rd|th)$|degree connection/i.test(l)) || '',
      profileUrl: url,
      reaction: icon ? (icon.getAttribute('data-test-reactions-icon-type') || icon.getAttribute('alt') || '').toLowerCase() : null,
    });
  }
  return people;
}

// Scrolls the scrollable part of a dialog (or of the job list) once. Returns true if it moved.
export function scrollInside(spec) {
  const { selectors, near } = spec;
  let box = null;
  for (const s of selectors || []) {
    const el = document.querySelector(s);
    if (el && el.scrollHeight > el.clientHeight + 5) {
      box = el;
      break;
    }
  }
  if (!box && near) {
    let el = document.querySelector(near);
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 5) {
        box = el;
        break;
      }
      el = el.parentElement;
    }
  }
  if (!box) return false;
  const before = box.scrollTop;
  box.scrollTop = Math.min(box.scrollHeight, before + Math.max(300, box.clientHeight * 0.8));
  return box.scrollTop > before;
}

export function jobIds(sel) {
  const ids = [];
  const add = (v) => {
    if (v && /^\d+$/.test(v) && !ids.includes(v)) ids.push(v);
  };
  for (const el of document.querySelectorAll(sel.jobCard.join(','))) add(el.getAttribute('data-job-id') || el.getAttribute('data-occludable-job-id'));
  for (const a of document.querySelectorAll('a[href*="/jobs/view/"]')) add((a.href.match(/\/jobs\/view\/(\d+)/) || [])[1]);
  return ids;
}

// spec: { sel, roots } reads inside the first of `roots` found (the search list's side pane),
// or null when none is on the page; without roots it reads the whole job page.
export function jobDetails(spec) {
  const { sel, roots } = spec;
  let main = null;
  for (const s of roots || []) {
    main = document.querySelector(s);
    if (main) break;
  }
  if (roots && !main) return null;
  main ||= document.querySelector('main') || document.body;
  const pick = (list) => {
    for (const s of list) {
      const el = main.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const company = main.querySelector('a[href*="/company/"]');
  let companyUrl = null;
  if (company) {
    const m = company.href.match(/^(.*\/company\/[^/?#]+)/);
    companyUrl = m ? `${m[1]}/` : company.href;
  }
  return {
    title: (pick(sel.jobTitle)?.innerText || '').trim().split('\n')[0],
    company: ((company?.innerText || '').trim().split('\n')[0]) || '',
    companyUrl,
    details: (pick(sel.jobDetails)?.innerText || '').trim(),
    fullText: (main.innerText || '').trim(),
    url: location.href.split('?')[0],
  };
}

// Posts listed on a profile's activity page with their age label ("3d", "2w", "1mo", ...).
export function activityPosts(sel) {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('[data-urn], [data-id]')) {
    const v = el.getAttribute('data-urn') || el.getAttribute('data-id') || '';
    const m = v.match(/^urn:li:(activity|ugcPost|share):\d+/);
    if (!m || seen.has(m[0])) continue;
    seen.add(m[0]);
    let date = '';
    for (const s of sel.postDate) {
      const d = el.querySelector(s);
      if (d) {
        date = (d.innerText || '').trim().split('\n')[0];
        break;
      }
    }
    if (!date) {
      const t = el.querySelector('time');
      date = t ? (t.getAttribute('datetime') || t.innerText || '') : '';
    }
    const repost = /\breposted this\b/i.test((el.innerText || '').slice(0, 300));
    out.push({ urn: m[0], date, repost });
  }
  if (out.length) return out;
  // 2026 layout (SDUI): each post is a [role="listitem"] whose componentkey starts with
  // "update-card-focus"; the post id is not in the page (only some posts link to it), so each
  // card is marked for "Copy link to post". The date is a plain line: "Jun 17, 2023" or "2w".
  const DATE = /^(\d+\s*(s|m|h|d|w|mo|yr|y)\b|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b)/i;
  const cards = document.querySelectorAll('[role="listitem"][componentkey^="update-card-focus"], [data-sdui-screen*="RecentActivity"] [role="list"] > [role="listitem"]');
  for (const el of cards) {
    if (!el.hasAttribute('data-alpha-post')) el.setAttribute('data-alpha-post', `p${document.querySelectorAll('[data-alpha-post]').length + 1}`);
    const mark = el.getAttribute('data-alpha-post');
    if (seen.has(mark)) continue;
    seen.add(mark);
    const link = [...el.querySelectorAll('a[href*="/feed/update/urn:li:"]')].map((a) => a.href.match(/urn:li:(activity|ugcPost|share):\d+/)).find(Boolean);
    const lines = [...el.querySelectorAll('p')].slice(0, 8).map((x) => (x.innerText || '').trim());
    const date = lines.slice(1).find((t) => DATE.test(t)) || '';
    const repost = /\breposted this\b/i.test((el.innerText || '').slice(0, 300));
    out.push({ urn: link ? link[0] : null, mark, date, repost });
  }
  return out;
}

// Records links the page copies ("Copy link to post") without touching the real clipboard.
export function watchCopies() {
  if (window.__alphaCopies) return true;
  window.__alphaCopies = [];
  if (navigator.clipboard) navigator.clipboard.writeText = (t) => { window.__alphaCopies.push(String(t)); return Promise.resolve(); };
  window.addEventListener('copy', (e) => {
    const t = e.clipboardData?.getData('text/plain') || String(getSelection() || '');
    if (t) window.__alphaCopies.push(t);
  });
  return true;
}

export function lastCopied() {
  const list = window.__alphaCopies || [];
  return list.length ? list[list.length - 1] : null;
}

export function groupResults() {
  const root = document.querySelector('main') || document.body;
  const out = new Map();
  for (const a of root.querySelectorAll('a[href*="/groups/"]')) {
    const m = a.href.match(/\/groups\/(\d+)/);
    if (!m || out.has(m[1])) continue;
    const card = a.closest('li') || a.parentElement;
    const lines = (card.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean).filter((l) => !/^(join|request to join|joined|pending)$/i.test(l));
    out.set(m[1], { id: m[1], name: (a.innerText || '').trim().split('\n')[0] || lines[0] || m[1], url: `${location.origin}/groups/${m[1]}/`, text: lines.join('\n').slice(0, 1500) });
  }
  return [...out.values()];
}

export function mainText() {
  return ((document.querySelector('main') || document.body).innerText || '').trim();
}

export function pageText() {
  return (document.body ? document.body.innerText : '').trim();
}

export function scrollToBottom() {
  const before = document.scrollingElement.scrollTop;
  window.scrollTo(0, document.scrollingElement.scrollHeight);
  return { moved: document.scrollingElement.scrollTop > before, height: document.scrollingElement.scrollHeight };
}

// ---------- Sales Navigator ----------

export function salesLeads() {
  const out = new Map();
  for (const a of document.querySelectorAll('a[href*="/sales/lead/"], a[href*="/sales/people/"]')) {
    const m = a.href.match(/\/sales\/(?:lead|people)\/([^,/?#]+)/);
    if (!m || out.has(m[1])) continue;
    const name = (a.innerText || '').trim().split('\n')[0];
    if (!name) continue;
    const card = a.closest('li') || a.closest('[data-x-search-result]') || a.parentElement;
    const lines = (card.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean)
      .filter((l) => !/^(save|saved|message|connect|view profile|add note|more)$/i.test(l));
    out.set(m[1], { leadId: m[1], name, salesUrl: a.href, text: [...new Set(lines)].join('\n').slice(0, 1500) });
  }
  return [...out.values()];
}

// "1,234 results", "2.5K+ results" -> number (null when not shown).
export function resultsTotal() {
  const text = (document.querySelector('main') || document.body).innerText || '';
  const m = text.match(/([\d][\d,.]*)\s*([KkMm])?\+?\s+results?\b/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Math.round(n * (m[2] ? (/k/i.test(m[2]) ? 1000 : 1000000) : 1));
}

// Opens nothing: finds the filter block whose heading is `label` and reports what it shows,
// tagging its text input (if any) with `token` so it can be typed into.
export function filterBlock(spec) {
  const { label, token } = spec;
  const want = label.toLowerCase();
  const heads = [...document.querySelectorAll('legend, h3, h4, button, span, div[role="button"], label')]
    .filter((el) => (el.innerText || '').trim().split('\n')[0].trim().toLowerCase() === want);
  for (const head of heads) {
    const block = head.closest('fieldset, li, section, [class*="filter"]') || head.parentElement;
    if (!block) continue;
    const r = head.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    document.querySelectorAll('[data-alpha-target]').forEach((e) => e.removeAttribute('data-alpha-target'));
    const input = [...block.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]')].find((i) => i.getBoundingClientRect().width > 0);
    if (input) input.setAttribute('data-alpha-target', `${token}-input`);
    head.setAttribute('data-alpha-target', `${token}-head`);
    block.setAttribute('data-alpha-block', token);
    return { found: true, hasInput: Boolean(input), expanded: head.getAttribute('aria-expanded'), text: (block.innerText || '').trim().slice(0, 1500) };
  }
  return { found: false };
}

// Tags the option (or its "Include" button) that best matches `value` inside a filter block
// or the open suggestion list.
export function markOption(spec) {
  const { token, block, value, forbidden } = spec;
  const want = value.toLowerCase();
  const bad = new RegExp(forbidden, 'i');
  const scopes = [document.querySelector(`[data-alpha-block="${block}"]`), document.querySelector('[role="listbox"]'), document].filter(Boolean);
  for (const scope of scopes) {
    const options = [...scope.querySelectorAll('[role="option"], li, button, label')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({ el, text: (el.innerText || '').trim().replace(/\s+/g, ' ') }))
      .filter((o) => o.text && o.text.length < 120 && !bad.test(o.text));
    const exact = options.find((o) => o.text.toLowerCase().replace(/^include\s*|\s*(include|exclude)$/gi, '').trim() === want);
    const partial = options.find((o) => o.text.toLowerCase().includes(want));
    const hit = exact || partial;
    if (!hit) continue;
    const include = [...hit.el.querySelectorAll('button, [role="button"]')].find((b) => /^include$/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()) || /^include/i.test(b.getAttribute('aria-label') || ''));
    const target = include || hit.el;
    document.querySelectorAll('[data-alpha-target]').forEach((e) => e.removeAttribute('data-alpha-target'));
    target.setAttribute('data-alpha-target', token);
    target.scrollIntoView({ block: 'center' });
    return { text: hit.text };
  }
  return null;
}

// Numbered list of the visible controls, for the light navigation agent. Each one is tagged
// with data-alpha-snap so the agent's choice can be clicked or typed into.
export function controlsSnapshot(spec) {
  const bad = new RegExp(spec.forbidden, 'i');
  document.querySelectorAll('[data-alpha-snap]').forEach((e) => e.removeAttribute('data-alpha-snap'));
  const els = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="option"], [role="checkbox"], [role="tab"], label')];
  const out = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight * 3) continue;
    const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const aria = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    if (!text && !aria && !placeholder) continue;
    if (bad.test(text) || bad.test(aria)) continue;
    const n = out.length + 1;
    el.setAttribute('data-alpha-snap', String(n));
    out.push({ n, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', text, aria: aria.slice(0, 80), placeholder, expanded: el.getAttribute('aria-expanded'), checked: el.getAttribute('aria-checked') || (el.checked ? 'true' : null) });
    if (out.length >= 160) break;
  }
  return out;
}
