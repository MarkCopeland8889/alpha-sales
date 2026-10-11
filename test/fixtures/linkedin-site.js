// A small LinkedIn-like website for testing Krypton end to end without touching LinkedIn.
// It mimics the structure the readers rely on (profile links, data-urn posts, job ids,
// "see more" buttons, a reactions dialog, Sales Navigator filters) and counts every click on
// a button Krypton must never press (apply, connect, message, follow, like, save, join, ...).
import http from 'node:http';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const PEOPLE = {
  'jane-owner': {
    name: 'Jane Owner', headline: "Owner at Jane's Bakery", location: 'Austin, Texas',
    about: 'I run a bakery with 12 staff.', aboutMore: 'Honestly the books are a mess and we need a bookkeeper who works online.',
    website: 'https://janesbakery.example/',
    posts: [
      { id: 1001, date: '2d', caption: 'We are growing fast and I am drowning in receipts.', more: ' Need a bookkeeper who works remote!', reactions: 15, comments: true },
      { id: 1002, date: '1w', caption: 'Our new sourdough is here.' },
      { id: 1003, date: '1mo', caption: 'Hiring two bakers for the new shop.' },
      { id: 1004, date: '2mo', caption: 'An old post that is too old to read.' },
    ],
  },
  'bob-bookkeeper': { name: 'Bob Bookkeeper', headline: 'Freelance Bookkeeper | QuickBooks ProAdvisor', location: 'Remote', about: 'I keep the books for small businesses.', posts: [] },
  'carl-cafe': { name: 'Carl Cafe', headline: "Founder at Carl's Cafe", location: 'Denver, Colorado', about: 'Coffee and community.', noActivity: true },
  'dana-dental': {
    name: 'Dana Dental', headline: 'Dentist and practice owner', location: 'Miami, Florida', about: 'Family dentistry.',
    posts: [{ id: 1101, date: '3w', caption: 'Patients first. Also: tax season stress is real for practice owners.' }],
  },
  'erin-cpa': { name: 'Erin CPA', headline: 'CPA at Numbers & Co', location: 'Chicago', about: 'Tax and audit.', posts: [] },
  'fiona-florist': { name: 'Fiona Florist', headline: "Owner, Fiona's Flowers", location: 'Austin, Texas', about: 'Flowers for every day.', noActivity: true },
  'gus-garage': { name: 'Gus Garage', headline: "Owner, Gus's Garage", location: 'Austin, Texas', about: 'Car repairs.', noActivity: true },
};
const LEADS = { ACwAA123: 'fiona-florist', ACwAA456: 'gus-garage' };
const SEARCH_PAGES = [['jane-owner', 'bob-bookkeeper', 'carl-cafe'], ['dana-dental', 'erin-cpa']];

const SEARCH_POSTS = [
  { id: 2001, author: 'Bob Bookkeeper', slug: 'bob-bookkeeper', date: '1d', caption: 'Offering bookkeeping for small businesses. Comment if you need help!', comments: [['kim-kitchen', 'Kim Kitchen', 'Owner, Kim’s Kitchen', 'Yes! I need a bookkeeper for my restaurant.']] },
  { id: 2002, author: 'Lou Lawn', slug: 'lou-lawn', date: '4d', caption: 'Anyone recommend a bookkeeper for a landscaping company?' },
  { id: 2003, author: 'Erin CPA', slug: 'erin-cpa', date: '5d', caption: 'Tax tips for 2026.' },
];
const JOBS = {
  3001: { title: 'Remote Bookkeeper (Part-time)', company: 'Acme Plumbing', slug: 'acme-plumbing', desc: 'Acme Plumbing is looking for a remote bookkeeper.', more: ' Fully online, 15 hours a week, QuickBooks.' },
  3002: { title: 'Staff Accountant', company: 'BigCorp', slug: 'bigcorp', desc: 'Month-end close and reconciliations.', more: ' Hybrid in Chicago.' },
  3003: { title: 'Bookkeeper (in office)', company: 'Numbers Bookkeeping LLC', slug: 'numbers-bookkeeping', desc: 'Join our bookkeeping firm.', more: ' On site in Dallas.' },
};

function allPosts() {
  const map = new Map();
  for (const [slug, p] of Object.entries(PEOPLE)) for (const post of p.posts || []) map.set(post.id, { ...post, author: p.name, slug });
  for (const post of SEARCH_POSTS) map.set(post.id, post);
  return map;
}

const layout = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} | LinkedIn</title>
<style>body{font-family:sans-serif;margin:0} main{padding:16px;max-width:900px} button{margin:3px} .spacer{height:1400px}</style></head>
<body><nav><a href="/feed/">Home</a></nav><main>${body}</main>
<script>function hit(w){fetch('/__click?what='+encodeURIComponent(w))}
${script}</script></body></html>`;

const peopleCard = (slug) => {
  const p = PEOPLE[slug];
  return `<li class="reusable-search__result-container"><div><a href="/in/${slug}/?miniProfileUrn=x"><span aria-hidden="true">${esc(p.name)}</span><span class="visually-hidden">View ${esc(p.name)}’s profile</span></a>
  <div>${esc(p.headline)}</div><div>${esc(p.location)}</div><button onclick="hit('connect')">Connect</button></div></li>`;
};

function profilePage(slug) {
  const p = PEOPLE[slug];
  return layout(p.name, `
<section class="top-card">
  <img id="profile-background-image-target-image" src="/img/header-${slug}.jpg" width="800" height="150" alt="">
  <img class="pv-top-card-profile-picture__image--show" src="/img/photo-${slug}.jpg" width="120" height="120" alt="${esc(p.name)}">
  <h1>${esc(p.name)}</h1>
  <div class="text-body-medium break-words">${esc(p.headline)}</div>
  <span>${esc(p.location)}</span>
  <button onclick="hit('connect')">Connect</button><button onclick="hit('message')">Message</button><button onclick="hit('follow')">Follow</button>
</section>
<section><div id="about"></div><h2>About</h2><div>${esc(p.about)}<span id="more" hidden>${esc(p.aboutMore || ' More about me.')}</span></div>
  <button onclick="document.getElementById('more').hidden=false;this.remove()">…see more</button></section>
${p.website ? `<section><div id="featured"></div><h2>Featured</h2><a href="${p.website}">My website</a> <a href="/feed/update/urn:li:activity:1001/">A post I wrote</a></section>` : ''}
${p.noActivity ? '' : `<section><div id="activity"></div><h2>Activity</h2><a href="/in/${slug}/recent-activity/all/">Show all posts</a></section>`}
<div class="spacer"></div><div id="lazy"></div>`, `
addEventListener('scroll', () => {
  if (!window.done && innerHeight + scrollY >= document.body.scrollHeight - 60) {
    window.done = true;
    document.getElementById('lazy').innerHTML = '<section><h2>Experience</h2><p>Lazy loaded experience for ${esc(p.name)}</p></section>';
  }
});`);
}

function activityPage(slug) {
  const p = PEOPLE[slug];
  const posts = (p.posts || []).map((x) => ({ urn: `urn:li:activity:${x.id}`, date: x.date, caption: x.caption }));
  return layout(`${p.name} activity`, '<div id="feed"></div><button id="more">Show more results</button>', `
const posts = ${JSON.stringify(posts)}; let shown = 0;
const feed = document.getElementById('feed'); const more = document.getElementById('more');
function render(n) {
  for (const p of posts.slice(shown, shown + n)) {
    feed.insertAdjacentHTML('beforeend', '<div class="feed-shared-update-v2" data-urn="' + p.urn + '" style="height:400px"><span class="update-components-actor__sub-description">' + p.date + ' • </span><div class="update-components-text">' + p.caption + '</div><button onclick="hit(\\'like\\')">Like</button></div>');
  }
  shown += n;
  if (shown >= posts.length) more.remove();
}
render(2); more.onclick = () => render(2);`);
}

function postPage(id) {
  const post = allPosts().get(Number(id));
  if (!post) return null;
  const reactions = post.reactions || 0;
  const comments = post.comments === true
    ? [['gina-grocer', 'Gina Grocer', "Owner, Gina's Grocery", 'I need this too! Who do you recommend?'], ['bob-bookkeeper', 'Bob Bookkeeper', 'Freelance Bookkeeper', 'I can help, send me a message.']]
    : post.comments || [];
  const extra = post.comments === true ? [['hank-hardware', 'Hank Hardware', 'Hardware store owner', 'Following this.'], ['ivy-interiors', 'Ivy Interiors', 'Interior designer', 'Same problem here.']] : [];
  const article = ([slug, name, headline, text]) => `<article class="comments-comment-entity"><a href="/in/${slug}/"><span class="comments-comment-meta__description-title">${esc(name)}</span></a><div class="comments-comment-meta__description-subtitle">${esc(headline)}</div><div class="comments-comment-item__main-content">${esc(text)}</div><button onclick="hit('like')">Like</button></article>`;
  return layout('Post', `
<div class="feed-shared-update-v2" data-urn="urn:li:activity:${post.id}">
  <div class="update-components-actor"><a href="/in/${post.slug}/"><span class="update-components-actor__title"><span aria-hidden="true">${esc(post.author)}</span></span></a>
    <span class="update-components-actor__sub-description">${post.date} • </span></div>
  <div class="update-components-text">${esc(post.caption)}<span id="cmore" hidden>${esc(post.more || '')}</span></div>${post.more ? '<button onclick="cmore.hidden=false;this.remove()">…more</button>' : ''}
  <div class="update-components-image"><img src="/img/post-${post.id}.jpg" width="600" height="300" alt=""></div>
  <div class="social-details-social-counts">${reactions ? `<button data-reaction-details aria-label="${reactions} reactions" onclick="openReactions()">${reactions}</button>` : ''}<span>${comments.length + extra.length} comments</span> <span>1 repost</span></div>
  <button aria-label="React Like" onclick="hit('like')">Like</button><button onclick="hit('comment')">Comment</button><button onclick="hit('repost')">Repost</button><button onclick="hit('send')">Send</button>
  <div id="comments">${comments.map(article).join('')}</div>
  ${extra.length ? '<button id="lmc">Load more comments</button>' : ''}
</div>`, `
const extra = ${JSON.stringify(extra.map(article))};
const lmc = document.getElementById('lmc');
if (lmc) lmc.onclick = () => { document.getElementById('comments').insertAdjacentHTML('beforeend', extra.join('')); lmc.remove(); };
let loaded = 0;
function addReactors(list) {
  const n = Math.min(${reactions}, loaded + 6);
  for (let i = loaded + 1; i <= n; i += 1) list.insertAdjacentHTML('beforeend', '<li style="height:50px"><a href="/in/reactor-' + i + '/"><div>Reactor ' + i + '</div><div>Headline ' + i + '</div></a><img data-test-reactions-icon-type="LIKE" alt="like" src="/img/like.svg" width="16" height="16"></li>');
  loaded = n;
}
function openReactions() {
  document.body.insertAdjacentHTML('beforeend', '<div role="dialog" class="artdeco-modal" style="position:fixed;top:40px;left:40px;width:400px;background:#fff;border:1px solid #333"><div class="artdeco-modal__content" style="height:200px;overflow:auto"><ul id="rl"></ul></div></div>');
  const list = document.getElementById('rl');
  addReactors(list);
  document.querySelector('.artdeco-modal__content').addEventListener('scroll', (e) => { const el = e.target; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) addReactors(list); });
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('[role=dialog]')?.remove(); });`);
}

function contentSearch() {
  const item = (p) => `<div class="search-result" data-urn="urn:li:activity:${p.id}" style="height:300px"><b>${esc(p.author)}</b><p>${esc(p.caption)}</p><button onclick="hit('like')">Like</button></div>`;
  return layout('Posts search', `<div id="list">${SEARCH_POSTS.slice(0, 2).map(item).join('')}</div><button id="more">Show more results</button>`, `
const rest = ${JSON.stringify(SEARCH_POSTS.slice(2).map(item))};
document.getElementById('more').onclick = (e) => { document.getElementById('list').insertAdjacentHTML('beforeend', rest.join('')); e.target.remove(); };`);
}

function jobsSearch(start) {
  if (start > 0) return layout('Jobs', '<p>No matching jobs found. Try removing filters.</p>');
  const cards = Object.entries(JOBS).map(([id, j]) => `<li data-occludable-job-id="${id}" style="height:150px"><a href="/jobs/view/${id}/?trk=x">${esc(j.title)}</a><div>${esc(j.company)}</div><span>Easy Apply</span></li>`);
  return layout('Jobs', `<div class="jobs-search-results-list" style="height:200px;overflow:auto"><ul>${cards.join('')}</ul></div>`);
}

function jobPage(id) {
  const j = JOBS[id];
  if (!j) return null;
  return layout(j.title, `
<h1 class="job-details-jobs-unified-top-card__job-title">${esc(j.title)}</h1>
<a href="/company/${j.slug}/life/">${esc(j.company)}</a>
<button onclick="hit('apply')">Easy Apply</button><button onclick="hit('apply-external')" aria-label="Apply on company website">Apply</button><button onclick="hit('save')">Save</button>
<div id="job-details">${esc(j.desc)}<span id="jm" hidden>${esc(j.more)}</span></div><button onclick="jm.hidden=false;this.remove()">See more</button>`);
}

function groupsSearch(page) {
  if (page > 1) return layout('Groups', '<p>No results found</p>');
  return layout('Groups', `<ul>
<li><a href="/groups/555/">Small Business Owners Austin</a><div>12K members</div><div>Owners helping owners.</div><button onclick="hit('join')">Join</button></li>
<li><a href="/groups/777/">Restaurant Owners Network</a><div>3K members</div><button onclick="hit('join')">Join</button></li></ul>`);
}

function salesSearch() {
  const filter = (label, kind, options) => `<fieldset data-kind="${kind}">
  <button class="hdr" aria-expanded="false" onclick="toggle(this)"><span>${label}</span></button>
  <div class="body" hidden>${kind === 'typeahead' ? `<input type="text" placeholder="Add ${label.toLowerCase()}" data-options='${JSON.stringify(options)}' oninput="suggest(this)">` : ''}<ul role="listbox">${kind === 'list' ? options.map((o) => `<li role="option">${o} <button onclick="pick(this, '${o}')">Include</button></li>`).join('') : ''}</ul></div>
  <div class="pills"></div></fieldset>`;
  return layout('Sales Navigator', `
<input placeholder="Search keywords" aria-label="Search keywords">
<div class="filters">
${filter('Geography', 'typeahead', ['United States', 'United Kingdom'])}
${filter('Company headcount', 'list', ['Self-employed', '1-10', '11-50'])}
${filter('Seniority level', 'list', ['Owner / Partner', 'CXO'])}
${filter('Industries', 'typeahead', ['Restaurants', 'Retail'])}
</div>
<div id="search-results-container" style="height:250px;overflow:auto"><p>2 results</p><ol>
<li style="height:150px"><a href="/sales/lead/ACwAA123,NAME_SEARCH,x1?_ntb=1">Fiona Florist</a><div>Owner · Fiona's Flowers</div><div>Austin, Texas</div><button onclick="hit('save')">Save</button><button onclick="hit('message')">Message</button></li>
<li style="height:150px"><a href="/sales/lead/ACwAA456,NAME_SEARCH,x2?_ntb=1">Gus Garage</a><div>Owner · Gus's Garage</div><div>Austin, Texas</div><button onclick="hit('save')">Save</button></li>
</ol></div>
<button aria-label="Next" disabled>Next</button>`, `
function toggle(b) { const body = b.parentElement.querySelector('.body'); body.hidden = !body.hidden; b.setAttribute('aria-expanded', String(!body.hidden)); }
function suggest(input) {
  const ul = input.parentElement.querySelector('ul');
  const opts = JSON.parse(input.dataset.options).filter((o) => o.toLowerCase().includes(input.value.toLowerCase()) && input.value);
  ul.innerHTML = opts.map((o) => '<li role="option">' + o + ' <button onclick="pick(this, \\'' + o + '\\')">Include</button></li>').join('');
}
function pick(btn, value) {
  const fs = btn.closest('fieldset');
  fs.querySelector('.pills').insertAdjacentHTML('beforeend', '<span class="pill">' + value + '</span>');
  if (fs.dataset.kind === 'typeahead') { fs.querySelector('ul').innerHTML = ''; fs.querySelector('input').value = ''; }
  window.applied = (window.applied || []).concat(value);
}`);
}

export function startLinkedInSite(port) {
  const clicks = {};
  const visits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (html, status = 200) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    };
    visits.push(u.pathname + u.search);
    if (u.pathname === '/__click') {
      const w = u.searchParams.get('what');
      clicks[w] = (clicks[w] || 0) + 1;
      return res.end('ok');
    }
    if (u.pathname.startsWith('/img/')) {
      res.writeHead(200, { 'content-type': u.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg' });
      return res.end(u.pathname.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]));
    }
    if (u.pathname === '/search/results/people/') {
      const n = Number(u.searchParams.get('page') || 1);
      const slugs = SEARCH_PAGES[n - 1];
      return send(slugs ? layout('People search', `<ul>${slugs.map(peopleCard).join('')}</ul><div class="spacer"></div>`) : layout('People search', '<h2>No results found</h2>'));
    }
    if (u.pathname === '/search/results/content/') return send(contentSearch());
    if (u.pathname === '/search/results/groups/') return send(groupsSearch(Number(u.searchParams.get('page') || 1)));
    if (u.pathname === '/jobs/search/') return send(jobsSearch(Number(u.searchParams.get('start') || 0)));
    if (u.pathname === '/sales/search/people') return send(salesSearch());
    let m = u.pathname.match(/^\/jobs\/view\/(\d+)\/$/);
    if (m) return send(jobPage(m[1]) || layout('Not found', 'Not found'), JOBS[m[1]] ? 200 : 404);
    m = u.pathname.match(/^\/feed\/update\/urn:li:activity:(\d+)\/$/);
    if (m) {
      const html = postPage(m[1]);
      return send(html || layout('Not found', 'Not found'), html ? 200 : 404);
    }
    m = u.pathname.match(/^\/in\/([^/]+)\/(recent-activity\/all\/)?$/);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      if (LEADS[slug]) {
        res.writeHead(302, { location: `/in/${LEADS[slug]}/${m[2] || ''}` });
        return res.end();
      }
      if (!PEOPLE[slug]) return send(layout('Not found', 'This page doesn’t exist'), 404);
      return send(m[2] ? activityPage(slug) : profilePage(slug));
    }
    return send(layout('Feed', '<p>Feed</p>'));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, clicks, visits, close: () => new Promise((r) => server.close(r)) })));
}
