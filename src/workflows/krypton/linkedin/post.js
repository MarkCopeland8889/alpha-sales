// Post processor: opens a post, records its metrics, caption and media, then its interactions:
// first the reactions list (who reacted and how), then every comment with the commenter's
// profile link and headline. Interactions.json holds both, in that order.
import * as dom from './dom.js';
import { urls } from './selectors.js';

export async function readPost(li, urn, { maxCommentPages = 5, maxReactions = 200 } = {}) {
  await li.visit(urls.post(li.base, urn), 'linkedin.post_view');
  const scope = li.sel.postContainer.join(',');
  await li.expandAll(scope, 4);
  const post = await li.evaluate(dom.postDetails, li.sel);
  post.urn ||= urn;

  // 1. The reactions list from the reactions button (who reacted and how).
  post.reactions = [];
  if (maxReactions > 0 && post.metrics.reactions !== 0) post.reactions = await readReactions(li, maxReactions);

  // 2. Then the comments: open them if they are folded away, load more pages, expand long
  //    ones, and read every commenter and comment.
  const shown = await li.evaluate((list) => document.querySelectorAll(list).length, li.sel.commentItem.join(','));
  if (!shown && post.metrics.comments) await li.clickText({ scope, textPattern: li.sel.patterns.openComments, ariaPattern: li.sel.patterns.openComments });
  for (let i = 0; i < maxCommentPages; i += 1) {
    if (!(await li.clickText({ textPattern: li.sel.patterns.loadMoreComments }))) break;
  }
  await li.expandAll(li.sel.commentItem.join(','), 10);
  post.comments = await li.evaluate(dom.comments, li.sel);

  // One interactions list per post: everyone who reacted, then every comment with its profile.
  post.interactions = [
    ...post.reactions.map((r) => ({ type: 'reaction', name: r.name, headline: r.headline, profileUrl: r.profileUrl, reaction: r.reaction })),
    ...post.comments.map((c) => ({ type: 'comment', name: c.author, headline: c.headline, profileUrl: c.profileUrl, comment: c.text, isReply: c.isReply })),
  ];
  return post;
}

async function readReactions(li, max) {
  const opened = (await li.clickText({ selectors: li.sel.reactionsButton }))
    || (await li.clickText({ textPattern: li.sel.patterns.reactionsCount, ariaPattern: li.sel.patterns.reactionsCount }));
  if (!opened) return [];
  await li.page.waitForSelector(li.sel.reactionsDialog.join(','), { timeout: 10000 }).catch(() => {});
  await li.pause(800, 1500);
  let list = (await li.evaluate(dom.reactionsDialog, li.sel)) || [];
  let idle = 0;
  while (list.length < max && idle < 2) {
    const moved = await li.evaluate(dom.scrollInside, { selectors: li.sel.reactionsScroll, near: `${li.sel.reactionsDialog[0]} li` });
    const clicked = await li.clickText({ scope: li.sel.reactionsDialog.join(','), textPattern: li.sel.patterns.showMoreResults });
    await li.pause(700, 1400);
    const next = (await li.evaluate(dom.reactionsDialog, li.sel)) || [];
    idle = moved || clicked || next.length > list.length ? 0 : idle + 1;
    list = next;
  }
  await li.closeDialog();
  return list.slice(0, max);
}

// Saves a post into a folder: caption, media, reactions, comments, then post.json (marker).
export async function savePost(store, page, parts, post, log) {
  store.text([...parts, 'Post caption.txt'], post.caption);
  const media = [];
  let n = 0;
  for (const url of post.media.images) {
    n += 1;
    try {
      media.push(store.relative(await store.media(page, url, [...parts, `Media ${n}`])));
    } catch (err) {
      log.warn(`Could not save post image ${n}: ${err.message}`);
    }
  }
  if (post.media.video) store.text([...parts, 'Video.txt'], `Video in the post: ${post.media.video}\nOpen the post to watch it: ${post.url}\n`);
  if (post.media.document) store.text([...parts, 'Document.txt'], `Document in the post: ${post.media.document}\nOpen the post to read it: ${post.url}\n`);
  store.json([...parts, 'Interactions.json'], post.interactions);
  store.json([...parts, 'Reactions.json'], post.reactions);
  store.json([...parts, 'Comments.json'], post.comments);
  store.json([...parts, 'post.json'], { ...post, savedMedia: media, savedAt: new Date().toISOString() });
}
