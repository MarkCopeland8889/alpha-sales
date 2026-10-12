// Profile processor: profile and header images, every word on the profile page (after
// expanding "see more" and scrolling to the bottom), the featured section, and the person's
// recent posts from their activity page (back to the age limit, one month by default).
import * as dom from './dom.js';
import { urls, slugFromUrl } from './selectors.js';
import { ageInDays } from './session.js';

export async function readProfile(li, store, parts, person) {
  const s = li.settings;
  await li.visit(urls.profile(li.base, person.slug), 'linkedin.profile_view');
  // A Sales Navigator lead id redirects to the person's own profile address.
  const slug = slugFromUrl(await li.currentUrl()) || person.slug;
  const top = await li.evaluate(dom.profileTop, li.sel);
  const saved = {};
  for (const [key, url, name] of [['photo', top.photoUrl, 'Profile image'], ['header', top.headerUrl, 'Header image']]) {
    if (!url) continue;
    try {
      saved[key] = store.relative(await store.media(li.page, url, [...parts, name]));
    } catch (err) {
      li.log.warn(`Could not save ${name.toLowerCase()} of ${person.name}: ${err.message}`);
    }
  }

  // Expand "see more" (about, experience), scroll to the bottom so every section loads (the
  // 2026 layout only builds About and Activity once they scroll into view), expand again,
  // then copy the text as is: the profile itself, and the whole page.
  await li.expandAll('main', 6);
  await li.scrollToEnd(10);
  await li.expandAll('main', 6);
  const text = await li.evaluate(dom.profileText);
  store.text([...parts, 'Profile text.txt'], text);
  store.text([...parts, 'Page text.txt'], await li.evaluate(dom.pageText));

  const feat = await li.evaluate(dom.featured);
  const websites = [...new Set([...(top.websites || []), ...(feat ? feat.items.filter((i) => i.external).map((i) => i.url) : [])])];
  if (feat) store.json([...parts, 'featured.json'], feat.items);
  if (websites.length) store.text([...parts, 'websites.txt'], `${websites.join('\n')}\n`);

  let postUrns = [];
  const activity = top.hasActivity || (await li.evaluate(dom.hasActivity));
  if (s.collect_profile_posts && activity) postUrns = await recentPosts(li, { ...person, slug });
  else if (s.collect_profile_posts) li.log.info(`${person.name} has no activity section`);

  return {
    slug: person.slug,
    profileSlug: slug,
    name: top.name || person.name,
    url: urls.profile(li.base, slug),
    headline: top.headline,
    images: saved,
    featured: feat?.items || [],
    websites,
    postUrns,
    textChars: text.length,
  };
}

// Opens "Show all" activity, loads more up to `activity_load_more` times, and keeps the posts
// that are no older than `profile_post_max_age_days` (30 = posts dated up to "1mo").
async function recentPosts(li, person) {
  const s = li.settings;
  const maxAge = s.profile_post_max_age_days;
  await li.visit(urls.activity(li.base, person.slug), 'linkedin.profile_view');
  const tooOld = (items) => items.some((p) => (ageInDays(p.date) ?? -1) > maxAge);
  let items = await li.evaluate(dom.activityPosts, li.sel);
  for (let i = 0; i < s.activity_load_more && !tooOld(items); i += 1) {
    await li.scrollToEnd(3);
    const clicked = await li.clickText({ textPattern: li.sel.patterns.showMoreResults });
    const next = await li.evaluate(dom.activityPosts, li.sel);
    const grew = next.length > items.length;
    items = next;
    if (!clicked && !grew) break;
  }
  const known = items.filter((p) => ageInDays(p.date) !== null);
  let keep = items.filter((p) => (ageInDays(p.date) ?? 0) <= maxAge);
  if (!known.length && items.length) {
    // Dates could not be read (page layout changed): keep the newest few instead of all.
    keep = items.slice(0, 10);
    li.log.warn(`Could not read post dates for ${person.name}; keeping the newest ${keep.length} posts`);
  }
  if (s.max_posts_per_profile > 0) keep = keep.slice(0, s.max_posts_per_profile);
  // Posts whose id is not on the page: three dots, "Copy link to post", as the workflow describes.
  for (const p of keep) if (!p.urn && p.mark) p.urn = await copyPostLink(li, p.mark);
  const urns = keep.map((p) => p.urn).filter(Boolean);
  if (urns.length < keep.length) li.log.warn(`${person.name}: could not get the link of ${keep.length - urns.length} posts`);
  li.log.info(`${person.name}: ${urns.length} posts in the last ${maxAge} days (of ${items.length} loaded)`);
  return urns;
}

// Opens the post's "..." menu, clicks "Copy link to post" (a read-only menu item) and turns the
// copied address (…/posts/name_words-activity-<id>-xyz or …/feed/update/urn:li:activity:<id>) into a post id.
async function copyPostLink(li, mark) {
  await li.evaluate(dom.watchCopies);
  const before = await li.evaluate(dom.lastCopied);
  const menu = await li.clickText({ scope: `[data-alpha-post="${mark}"]`, selectors: ['button'], ariaPattern: '^open control menu' });
  if (!menu) return null;
  await li.clickText({ selectors: ['[role="menuitem"]', '[role="option"]', '[role="menu"] li', '[role="menu"] button', '[role="menu"] a'], textPattern: '^copy link to post$' });
  await li.pause(500, 1000);
  const url = await li.evaluate(dom.lastCopied);
  await li.closeDialog();
  const m = url && url !== before ? url.match(/(activity|ugcPost|share)[-:](\d+)/) : null;
  return m ? `urn:li:${m[1]}:${m[2]}` : null;
}
