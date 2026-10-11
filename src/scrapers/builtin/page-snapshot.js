// Opens a page, scrolls it, and saves its text, links and a screenshot.
// A simple, safe scraper for testing a browser/profile/proxy setup end to end.
export default {
  name: 'page-snapshot',
  label: 'Page snapshot',
  site: '*',
  description: 'Open a URL, scroll, then save the visible text, links and a screenshot to Local Files/Snapshots.',
  inputs: {
    url: { type: 'string', required: true, label: 'Page URL', default: 'https://example.com' },
    scrolls: { type: 'number', default: 2, label: 'Scroll rounds' },
    fullPage: { type: 'boolean', default: false, label: 'Full-page screenshot' },
  },
  checkpoints: ['opened', 'scrolled', 'saved'],

  async run(ctx, input) {
    const { page } = ctx;
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ctx.guardCaptcha();
    await ctx.checkpoint('opened', { url: input.url });

    for (let i = 0; i < input.scrolls; i += 1) {
      ctx.throwIfStopped();
      await ctx.scroll({ steps: 2 });
    }
    await ctx.checkpoint('scrolled', { rounds: input.scrolls });

    const data = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      text: document.body?.innerText || '',
      links: [...document.querySelectorAll('a[href]')].slice(0, 500).map((a) => ({ text: a.innerText.trim().slice(0, 200), href: a.href })),
    }));
    const host = new URL(data.url).host || 'page';
    const store = ctx.store('Snapshots', ctx.run.label);
    store.text([host, 'page.txt'], data.text);
    store.json([host, 'links.json'], data.links);
    store.json([host, 'meta.json'], { title: data.title, url: data.url, savedAt: new Date().toISOString() });
    await store.screenshot(page, [host, 'screenshot.png'], { fullPage: input.fullPage });
    await ctx.checkpoint('saved', { title: data.title, folder: store.path([host]) });
    ctx.log.ok(`Saved snapshot of ${data.title || data.url}`);
    return { title: data.title, url: data.url, links: data.links.length, chars: data.text.length, folder: store.path([host]) };
  },
};
