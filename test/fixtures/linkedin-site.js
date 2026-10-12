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
    name: 'Dana Dental', headline: 'Dentist and practice owner', location: 'Miami, Florida', about: 'Family dentistry.', aboutMore: ' We are opening a second office and the paperwork is piling up.', sdui: true,
    posts: [
      { id: 1101, date: '3w', caption: 'Patients first. Also: tax season stress is real for practice owners.' },
      { id: 1102, date: '2mo', caption: 'Our spring open day, a while back.' },
    ],
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
  for (const [slug, p] of Object.entries(PEOPLE)) for (const post of p.posts || []) map.set(post.id, { ...post, author: p.name, slug, headline: p.headline, sdui: p.sdui });
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

// The 2026 search page: obfuscated classes, [role="listitem"] cards, the whole card wrapped in
// one link with the name in a smaller link inside it (built by script, as LinkedIn does, since
// HTML cannot nest links), an "is open to work" photo label and a mutual-connection link.
const sduiPeople = (slugs) => `<div data-sdui-screen="com.linkedin.sdui.flagshipnav.search.SearchResultsPeople"><div role="list" id="sdui"></div></div><div class="spacer"></div>`;
const sduiScript = (slugs) => `
const el = (tag, text) => { const e = document.createElement(tag); if (text) e.textContent = text; return e; };
for (const c of ${JSON.stringify(slugs.map((slug) => ({ slug, ...PEOPLE[slug] })))}) {
  const item = el('div'); item.setAttribute('role', 'listitem'); item.className = 'gfllid gflanj';
  const wrap = el('div'); wrap.setAttribute('data-display-contents', 'true');
  const card = el('a'); card.href = '/in/' + c.slug + '/';
  const label = el('div', c.name + ' is open to work');
  const body = el('div');
  const p = el('p'); const name = el('a', c.name); name.href = '/in/' + c.slug + '/'; p.append(name, el('span', ' • 2nd'));
  const head = el('div'); head.append(el('p')); head.firstChild.append(el('span', c.headline));
  const loc = el('div'); loc.append(el('p')); loc.firstChild.append(el('span', c.location));
  body.append(p, head, loc);
  card.append(label, body);
  const pile = el('div'); const mutual = el('a', 'Zed Mutual'); mutual.href = '/in/zed-mutual/';
  const connect = el('button', 'Connect'); connect.onclick = () => hit('connect');
  pile.append(mutual, el('span', ' is a mutual connection'), connect);
  wrap.append(card, pile); item.append(wrap);
  document.getElementById('sdui').append(item);
}`;

// The 2026 profile (SDUI): obfuscated classes, a [componentkey$="Topcard"] card with an h2 name,
// pronouns and degree before the headline, a srcset photo and cover, a /safety/go/ website link,
// an About card that is only built once scrolled into view (with a "… more" button), and a
// "People you may know" rail that is not part of the profile.
function sduiProfilePage(slug) {
  const p = PEOPLE[slug];
  const key = `com.linkedin.sdui.profile.card.refACoAA${slug}`;
  return layout(`(12) ${p.name}`, `
<section aria-label="Primary content"><div data-testid="lazy-column" data-component-type="LazyColumn">
<div componentkey="${key}Topcard"><section>
  <figure><img alt="Cover photo" src="/img/header-small-${slug}.jpg" srcset="/img/header-small-${slug}.jpg 350w, /img/header-${slug}.jpg 678w" width="800" height="150"></figure>
  <a href="/in/${slug}/?isSelfProfile=false" componentkey="topcard-logo-image-referencekey"><div aria-label="Profile photo"><figure><img alt="" src="/img/photo-small-${slug}.jpg" srcset="/img/photo-small-${slug}.jpg 100w, /img/photo-${slug}.jpg 400w" width="120" height="120"></figure></div></a>
  <a componentkey="ProfileVerificationTriggerRef-${slug}"><div><div><h2 class="gflkzy gflkx0">${esc(p.name)}</h2></div></div></a>
  <p>She/Her</p><div data-display-contents="true"><p>· 2nd</p></div>
  <p class="gflkzy gflkxr">${esc(p.headline)}</p>
  <p>University of Somewhere</p>
  <div><p>${esc(p.location)}</p><p>·</p><p><a href="/in/${slug}/overlay/contact-info/">Contact info</a></p></div>
  <p role="button"><a href="https://www.linkedin.com/safety/go/?url=${slug}%2Eexample&urlhash=x1&isSdui=true" target="_blank">${slug}.example</a></p>
  <div><p>159 followers</p><p>·</p><p>55</p><p>connections</p></div>
  <button onclick="hit('connect')">Connect</button><button onclick="hit('message')">Message</button>
</section></div>
<div class="spacer"></div>
<div id="lazy-about" componentkey="${key}About"></div>
${p.noActivity ? '' : `<div componentkey="${key}Activity"><section><h2>Activity</h2><a href="/in/${slug}/recent-activity/all/">Show all posts</a></section></div>`}
</div></section>
<aside><h2>People you may know</h2><a href="/in/bob-bookkeeper/">Bob Bookkeeper</a><p>Freelance Bookkeeper</p></aside>`, `
addEventListener('scroll', () => {
  if (!window.done && innerHeight + scrollY >= document.body.scrollHeight - 60) {
    window.done = true;
    document.getElementById('lazy-about').innerHTML = '<section><h2>About</h2><p><span data-testid="expandable-text-box">${esc(p.about)}<span id="more" hidden>${esc(p.aboutMore || ' More about me.')}</span></span><button data-testid="expandable-text-button" aria-hidden="true" onclick="document.getElementById(\\'more\\').hidden=false;this.remove()">… more</button></p></section>';
  }
});`);
}

function profilePage(slug) {
  const p = PEOPLE[slug];
  if (p.sdui) return sduiProfilePage(slug);
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

// The 2026 activity page: [role="listitem"] cards keyed by a hash, no post id in the page,
// absolute dates ("Sep 21, 2026"), a like button that only shows its count, and a "..." menu
// whose "Copy link to post" copies a /posts/…-activity-<id>-… address.
const DAYS = { d: 1, w: 7, mo: 30, yr: 365 };
const absDate = (label) => {
  const m = String(label).match(/(\d+)(mo|yr|d|w)/);
  const d = new Date(Date.now() - (m ? Number(m[1]) * DAYS[m[2]] : 0) * 86400000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
function sduiActivityPage(slug) {
  const p = PEOPLE[slug];
  const posts = (p.posts || []).map((x) => ({ id: x.id, date: absDate(x.date), caption: x.caption }));
  return layout(`${p.name} activity`, `<div data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.ProfileRecentActivityAll"><div role="list" id="list" data-component-type="LazyColumn"></div></div><button id="more" class="gflk9u"><span><span>Show more</span></span></button>`, `
const posts = ${JSON.stringify(posts)}; const who = ${JSON.stringify({ slug, name: p.name, headline: p.headline })};
let shown = 0;
const el = (tag, text, attrs = {}) => { const e = document.createElement(tag); if (text) e.textContent = text; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
function openMenu(id) {
  document.querySelector('[role="menu"]')?.remove();
  const menu = el('div', '', { role: 'menu' });
  const save = el('div', 'Save', { role: 'menuitem' }); save.onclick = () => hit('save');
  const copy = el('div', 'Copy link to post', { role: 'menuitem' });
  copy.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText('https://www.linkedin.com/posts/' + who.slug + '_words-activity-' + id + '-AbCd?utm_source=share') : Promise.reject()).catch(() => {}); menu.remove(); };
  const unfollow = el('div', 'Unfollow ' + who.name, { role: 'menuitem' }); unfollow.onclick = () => hit('unfollow');
  menu.append(save, copy, unfollow); document.body.append(menu);
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('[role="menu"]')?.remove(); });
function render(n) {
  for (const x of posts.slice(shown, shown + n)) {
    const item = el('div', '', { role: 'listitem', componentkey: 'update-card-focus' + btoa('k' + x.id) + 'FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW', style: 'display:block;height:400px' });
    const actor = el('a', '', { href: '/in/' + who.slug + '/' }); actor.append(el('p', who.name), el('p', ' • 2nd'));
    const follow = el('button', 'Follow', { 'aria-label': 'Follow ' + who.name }); follow.onclick = () => hit('follow');
    const dots = el('button', '', { 'aria-label': 'Open control menu for post by ' + who.name, style: 'width:24px;height:24px' }); dots.onclick = () => openMenu(x.id);
    const text = el('p'); text.append(el('span', x.caption, { 'data-testid': 'expandable-text-box' }));
    const like = el('button', '3', { 'aria-label': 'Reaction button state: no reaction' }); like.onclick = () => hit('like');
    const comment = el('button', '1', { 'aria-label': 'Comment' }); comment.onclick = () => hit('comment');
    item.append(el('h2', 'Feed post'), actor, el('p', who.headline), el('p', x.date), follow, dots, text, like, comment);
    document.getElementById('list').append(item);
  }
  shown += n;
  if (shown >= posts.length) document.getElementById('more').remove();
}
render(1);
document.getElementById('more').onclick = () => render(1);`);
}

function activityPage(slug) {
  const p = PEOPLE[slug];
  if (p.sdui) return sduiActivityPage(slug);
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

// 2026 layout (SDUI) post page: counts live inside the Like, Comment and Repost buttons (a zero is
// a zero-width space), and the only reaction controls are the Like button and its menu.
function sduiPostPage(post) {
  const zero = '\u200B';
  const card = `<div role="listitem" componentkey="update-card-focusX${post.id}FeedType_FEED_DETAIL">
  <h2>Feed post</h2>
  <a href="/in/${post.slug}/"><figure><img alt="" src="/img/photo-small-${post.slug}.jpg" width="48" height="48"></figure><p><span>${esc(post.author)}</span></p><p><span> • 2nd</span></p></a>
  <p>${esc(post.headline)}</p><p>${absDate(post.date)}</p>
  <p><span data-testid="expandable-text-box">${esc(post.caption)}</span></p>
  <div><a href="https://www.linkedin.com/"><figure><img alt="View image" src="/img/post-small-${post.id}.jpg" srcset="/img/post-small-${post.id}.jpg 300w, /img/post-${post.id}.jpg 800w" width="600" height="300"></figure></a></div>
  <div><button aria-label="Reaction button state: no reaction" onclick="hit('like')"><span><span>3</span></span></button><button aria-label="Open reactions menu" aria-expanded="false" onclick="hit('reactions-menu')"></button>
  <button aria-label="Comment" onclick="hit('comment')"><span><span>${zero}</span></span></button><button aria-label="Repost" onclick="hit('repost')"><span>${zero}</span></button><button aria-label="Send" onclick="hit('send')"></button></div>
</div>`;
  return layout('Post', `<section aria-label="Primary content"><div data-component-type="LazyColumn"><div id="expandedX${post.id}FeedType_FEED_DETAIL">${card}</div><div componentkey="x-commentsSectionAnchorRefX"></div></div></section>`);
}

function postPage(id) {
  const post = allPosts().get(Number(id));
  if (!post) return null;
  if (post.sdui) return sduiPostPage(post);
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

// Clicking a job card shows the job in the side pane without loading a new page (the address
// gains currentJobId), like LinkedIn's jobs search.
function jobsSearch(start) {
  if (start > 0) return layout('Jobs', '<p>No matching jobs found. Try removing filters.</p>');
  const cards = Object.entries(JOBS).map(([id, j]) => `<li data-occludable-job-id="${id}" style="height:150px"><a href="/jobs/view/${id}/?trk=x">${esc(j.title)}</a><div>${esc(j.company)}</div><span>Easy Apply</span></li>`);
  return layout('Jobs', `<div class="jobs-search-results-list" style="height:200px;overflow:auto"><ul>${cards.join('')}</ul></div><div class="jobs-search__job-details--container"></div>`, `
const jobs = ${JSON.stringify(JOBS)};
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
document.querySelector('.jobs-search-results-list').addEventListener('click', (e) => {
  const a = e.target.closest('a[href*="/jobs/view/"]');
  if (!a) return;
  e.preventDefault();
  const id = a.getAttribute('href').split('/jobs/view/')[1].split('/')[0]; const j = jobs[id];
  setTimeout(() => {
    const q = new URLSearchParams(location.search); q.set('currentJobId', id);
    history.replaceState(null, '', location.pathname + '?' + q);
    document.querySelector('.jobs-search__job-details--container').innerHTML = '<h2 class="job-details-jobs-unified-top-card__job-title"><a href="/jobs/view/' + id + '/">' + esc(j.title) + '</a></h2><a href="/company/' + j.slug + '/life/">' + esc(j.company) + '</a>'
      + '<button onclick="hit(\\'apply\\')">Easy Apply</button><button onclick="hit(\\'save\\')">Save</button>'
      + '<div id="job-details">' + esc(j.desc) + '<span id="jm" hidden>' + esc(j.more) + '</span></div><button onclick="jm.hidden=false;this.remove()">See more</button>';
  }, 150);
});`);
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
      if (!slugs) return send(layout('People search', '<h2>No results found</h2>'));
      // Page 1 uses the classic layout, page 2 the 2026 one.
      return send(n === 2 ? layout('People search', sduiPeople(slugs), sduiScript(slugs)) : layout('People search', `<ul>${slugs.map(peopleCard).join('')}</ul><div class="spacer"></div>`));
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
