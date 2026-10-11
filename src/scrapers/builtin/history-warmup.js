// Builds natural browsing history on a fresh profile by visiting ordinary sites.
export default {
  name: 'history-warmup',
  label: 'History warm-up',
  site: '*',
  description: 'Visit a list of everyday sites with natural pauses and scrolling, so a new profile has history and cookies.',
  inputs: {
    urls: {
      type: 'list',
      label: 'Sites (one per line)',
      default: ['https://www.wikipedia.org', 'https://www.weather.com', 'https://www.bbc.com/news', 'https://www.reddit.com', 'https://www.youtube.com'],
    },
  },
  checkpoints: ['visited'],

  async run(ctx, input) {
    let visited = 0;
    for (const url of input.urls) {
      ctx.throwIfStopped();
      if (ctx.resume.visited?.urls?.includes(url)) continue;
      try {
        await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await ctx.pause(2000, 5000);
        await ctx.scroll({ steps: 3 });
        visited += 1;
      } catch (err) {
        ctx.log.warn(`Could not open ${url}`, err);
      }
    }
    await ctx.checkpoint('visited', { urls: input.urls, count: visited });
    return { visited };
  },
};
