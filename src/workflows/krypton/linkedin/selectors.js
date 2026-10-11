// Everything that depends on LinkedIn's page structure lives here, so it can be adjusted
// without touching the workflow. LinkedIn changes its HTML often: each entry lists several
// selectors tried in order, and the page readers in dom.js fall back to structure that is
// stable (links to /in/ profiles, data-urn post ids, /jobs/view/ links) when classes change.
//
// To override without editing code, put a JSON object with the same keys in
// Configurations/LinkedIn/selectors.json. Lists given there replace the defaults.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, readJson } from '../../../core/paths.js';

export const DEFAULT_SELECTORS = {
  peopleCard: ['li.reusable-search__result-container', '[data-chameleon-result-urn]', '[data-view-name="search-entity-result-universal-template"]', 'li'],
  profileImage: ['img.pv-top-card-profile-picture__image--show', 'img.pv-top-card-profile-picture__image', 'img[class*="profile-picture"]', 'img[class*="profile-photo"]'],
  headerImage: ['img#profile-background-image-target-image', 'img[class*="profile-background-image"]', 'img[class*="background"]', 'img[class*="banner"]'],
  headline: ['.text-body-medium.break-words', '[data-generated-suggestion-target]', '.pv-text-details__left-panel .text-body-medium'],
  postContainer: ['[data-urn^="urn:li:activity:"]', '[data-urn^="urn:li:ugcPost:"]', '[data-urn^="urn:li:share:"]', '.feed-shared-update-v2'],
  postActor: ['.update-components-actor__title', '.update-components-actor__name', '.feed-shared-actor__name'],
  postText: ['.update-components-text', '.feed-shared-update-v2__description', '.feed-shared-inline-show-more-text', '.feed-shared-text'],
  postDate: ['.update-components-actor__sub-description', '.feed-shared-actor__sub-description'],
  commentItem: ['article.comments-comment-entity', 'article.comments-comment-item', '.comments-comment-item', '.comments-comment-entity'],
  commentAuthorName: ['.comments-comment-meta__description-title', '.comments-post-meta__name-text', '.comments-comment-meta__actor'],
  commentAuthorHeadline: ['.comments-comment-meta__description-subtitle', '.comments-post-meta__headline'],
  commentText: ['.comments-comment-item__main-content', '.comments-comment-entity__content', '.update-components-text'],
  reactionsDialog: ['[role="dialog"]', '.artdeco-modal'],
  reactionsButton: ['button[data-reaction-details]', '.social-details-social-counts__reactions-count', 'button.social-details-social-counts__count-value', '[class*="social-counts"] button[aria-label*="reaction" i]'],
  jobsList: ['.jobs-search-results-list', '.scaffold-layout__list > div', '.jobs-search__results-list', '[class*="jobs-search-results"]'],
  reactionIcon: ['[data-test-reactions-icon-type]', 'img[class*="reactions-icon"]', 'img[class*="reaction-icon"]'],
  reactionsScroll: ['.artdeco-modal__content', '.social-details-reactors-modal__content', '[role="dialog"] [class*="content"]'],
  jobCard: ['[data-job-id]', '[data-occludable-job-id]', 'li.jobs-search-results__list-item', '.job-card-container'],
  jobDetails: ['#job-details', '.jobs-description__content', '.jobs-box__html-content', '.jobs-description', '.description__text'],
  jobTitle: ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1'],
};

// Text and aria-label patterns (regular expressions, case-insensitive).
export const DEFAULT_PATTERNS = {
  seeMore: '^(…|\\.\\.\\.)?\\s*(see|show) more$|^…more$|click to see more description',
  showMoreResults: '^show more results$|^load more$|^see more results$|^show more$',
  openComments: '^\\d[\\d,.]*[km]?\\s+comments?$',
  loadMoreComments: 'load more comments|load previous comments|see more comments|show more comments',
  reactionsCount: '^(?!.*\\bmenu\\b).*(\\b\\d[\\d,.]*[km]?\\s+reactions?\\b|\\band \\d[\\d,.]* others?\\b)',
  noResults: 'no results found|try removing filters|we couldn.t find',
  // Never click anything that sends, applies, connects or reacts. Krypton only reads.
  forbidden: '\\b(easy apply|apply|connect|message|follow|join|send|invite|repost|withdraw|accept|endorse|subscribe|save to list|save search|unsave)\\b|^(like|celebrate|support|love|insightful|funny|comment|save)$',
};

let cache = null;
export function selectors() {
  const file = path.join(PATHS.configurations, 'LinkedIn', 'selectors.json');
  const mtime = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  if (cache?.mtime === mtime) return cache.value;
  const custom = mtime ? readJson(file, {}) : {};
  const value = {
    ...DEFAULT_SELECTORS,
    ...Object.fromEntries(Object.entries(custom).filter(([k]) => k in DEFAULT_SELECTORS)),
    patterns: { ...DEFAULT_PATTERNS, ...(custom.patterns || {}) },
  };
  cache = { mtime, value };
  return value;
}

// URL builders. `base` is https://www.linkedin.com (or a test server).
export const urls = {
  peopleSearch: (base, term, page = 1) => `${base}/search/results/people/?keywords=${encodeURIComponent(term)}&origin=GLOBAL_SEARCH_HEADER${page > 1 ? `&page=${page}` : ''}`,
  contentSearch: (base, term) => `${base}/search/results/content/?keywords=${encodeURIComponent(term)}&origin=GLOBAL_SEARCH_HEADER`,
  jobsSearch: (base, term, location, start = 0) => `${base}/jobs/search/?keywords=${encodeURIComponent(term)}${location ? `&location=${encodeURIComponent(location)}` : ''}${start ? `&start=${start}` : ''}`,
  job: (base, id) => `${base}/jobs/view/${id}/`,
  profile: (base, slug) => `${base}/in/${encodeURIComponent(slug)}/`,
  activity: (base, slug) => `${base}/in/${encodeURIComponent(slug)}/recent-activity/all/`,
  post: (base, urn) => `${base}/feed/update/${urn}/`,
  groupsSearch: (base, term, page = 1) => `${base}/search/results/groups/?keywords=${encodeURIComponent(term)}&origin=GLOBAL_SEARCH_HEADER${page > 1 ? `&page=${page}` : ''}`,
};

export const slugFromUrl = (url) => {
  const m = String(url || '').match(/\/in\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};
