# Scrapers and jobs

A **scraper** is one module that does one task on one site. A **job** is a browser setup
plus a list of scraper steps, run one after another on the same tab or side by side in
separate tabs. Jobs run on any computer that is online and on the same app version, either
on demand or on a cron schedule.

## Writing a scraper

Create one from the Scrapers page (New scraper) or add `Scrapers/<name>/scraper.js`. The file
reloads automatically when you edit it.

```js
export default {
  name: 'example-title',            // unique id used in jobs
  label: 'Example: page title',
  site: 'example.com',
  description: 'Opens a page and saves its title.',
  needsBrowser: true,               // false for AI-only steps
  inputs: {                         // shown as a form in the UI
    url: { type: 'string', required: true, label: 'Page URL', default: 'https://example.com' },
    pages: { type: 'number', default: 3, label: 'Pages' },
    terms: { type: 'list', label: 'Search terms' },   // also: boolean, text, json, select (+ options)
  },
  checkpoints: ['opened', 'saved'],

  async run(ctx, input) {
    await ctx.page.goto(input.url, { waitUntil: 'domcontentloaded' });
    await ctx.guardCaptcha();                     // waits for a human if a CAPTCHA shows
    await ctx.checkpoint('opened', { url: input.url });

    const title = await ctx.page.title();
    ctx.store('Example', ctx.run.label).json(['result.json'], { title });
    await ctx.checkpoint('saved', { title });
    return { title };                              // saved on the run as its result
  },
};
```

## The `ctx` object

| Member | Use |
|---|---|
| `page`, `session` | the Playwright-style page and the open browser (`session.newPage()`, `session.puppeteer()`) |
| `input`, `project`, `variables` | the step's inputs and the job's project variables (`{{business_name}}` etc.) |
| `shared` | values passed between the steps of one run (the AI prompt step writes here) |
| `log.ok / info / warn / fail` | logging with ✅/⚠️/❌ into the run's log file |
| `checkpoint(name, data)` | saves progress to the database and updates the run's progress |
| `resume` | checkpoint data from the run being resumed, keyed by name, so work can be skipped |
| `store(...folders)` | a data store under `Local Files/` (`text`, `json`, `append`, `download`, `screenshot`) |
| `ai.complete()` / `ai.json()` | any AI provider (see the AI hub) |
| `click / type / fill / scroll / pause` | actions with short random delays (the "basic" controller) |
| `action(name)` | counts an action against the daily guardrail limit and waits out the minimum gap |
| `guardCaptcha()`, `askHuman(message)` | pause the run until a person handles something in the browser |
| `reportSite(website, status, reason)` | records working / restricted / blocked for this profile's proxy |
| `shouldStop()`, `throwIfStopped()` | honour the Stop button and the kill switch in long loops |

Rules of thumb:

- Save a checkpoint after each unit of work (a search term, a page of results), and check
  `ctx.resume` at the start so a resumed run continues instead of starting over.
- Call `ctx.action('<site>.<what>')` before each counted page view and set its daily limit
  on the Guardrails page.
- Never put passwords in a scraper. Log in once by hand with the built-in "Account login"
  scraper and keep the profile.

## Built-in scrapers

| Scraper | What it does |
|---|---|
| `page-snapshot` | Opens a URL, scrolls, saves text, links and a screenshot. Good for testing a profile and proxy. |
| `account-login` | Opens an account's login page and waits while a person logs in, then saves cookies and marks the account active. |
| `ai-prompt` | Sends a prompt (with `{{variables}}` from the project and earlier steps) to any AI provider and saves the answer to `shared`. |
| `history-warmup` | Visits a list of ordinary sites so a new profile has normal history. |

## How the sample Krypton workflow maps onto this

The LinkedIn sample (`docs/source/linkedin-sample-test.md`) becomes one job:

1. `ai-prompt` step: generate search terms from the project's business and ICP variables,
   `saveAs: "terms"`, JSON on.
2. A people-search scraper reading `ctx.shared.terms`, with a checkpoint per term and page.
3. A profile scraper and a post scraper fed from the people results.
4. A jobs-search scraper and a posts-search scraper.

Each writes into `ctx.store('LinkedIn', 'Run <date>')` in the folder layout from the sample.
These platform scrapers are not part of this foundation; see `docs/ROADMAP.md`.
