# Krypton: LinkedIn client generation and prospecting

Krypton finds people and companies that need your service on LinkedIn, then ranks them with AI.
It is built from the workflow in `docs/source/krypton-workflow.md` and runs as the built-in
scraper `krypton-linkedin`, so it works like any other job: on any computer, on a schedule,
with checkpoints, guardrails, the kill switch and human help.

Krypton only reads. It never applies to jobs, connects, messages, follows, reacts, comments,
reposts, saves leads or joins groups. Every click goes through one function that refuses any
button whose text matches those actions (`forbidden` in `src/workflows/krypton/linkedin/selectors.js`).

## Running it

1. On **Browsers → Profiles**, create a Chrome profile (or use an existing one) and log in to
   LinkedIn in it once. For Sales Navigator the account needs a Sales Navigator seat.
2. Connect an AI: a Claude API key in **Settings**, or log in to Claude Code on **Accounts**
   (OpenAI and Gemini work the same way; pick them on the AI tab).
3. Open **Workflows → Krypton (LinkedIn)**, press **Fill in test 1**, choose the browser profile
   on the Browser tab, and press **Run now** (or **Save as job** to schedule it).
4. Watch it on **Automation → Runs**. If LinkedIn asks to log in or shows a security check, the
   run pauses and **Human help** asks you to deal with it in the open window.
5. When it finishes, the report opens from the Runs list on the Krypton page.

Test 1 is: search term "Need a bookkeeper", business "Bookkeeping firm" (fully remote), every
other setting at its default.

## Settings

Required: business type, business name, business description (on the run, or as project
variables). Everything else has a default; see the Krypton page or `src/workflows/krypton/settings.js`.

| Setting | Default | What it does |
|---|---|---|
| ICP lines (industry, geography, ...) | blank | Blank: the power model writes 1 to 5 ICPs from LinkedIn's filter list. |
| Search terms | blank | Blank: the medium model writes 50 per ICP. |
| Job search locations | blank | One job search per location per term. |
| Profile posts back to | 30 days | A profile's posts are read back to "1mo"; anything older is skipped. |
| Profile / post / job batch size | 3 / 10 / 30 | Batches for agents 2, 3 and 4. A profile's posts always go in one batch together. |
| People filter batch size | 10 | People per "drop the providers" prompt. |
| AI / connection | Claude, automatic | Claude, OpenAI or Gemini; API key first, then the CLI login. |
| Extra power | off | xhigh reasoning on power prompts for Claude and OpenAI. |
| Limits | 0 (none) | Pages, profiles, posts, jobs, reactions, comment pages. Daily guardrails still apply. |
| Pause length | 1 | Multiplies every pause. Higher is slower and gentler. |

Model tiers (editable per run):

| Tier | Claude | OpenAI | Gemini | Used for |
|---|---|---|---|---|
| Fast | claude-haiku-5-5 (medium) | gpt-6-luna (high) | gemini-3.8-flash (medium) | Sales Navigator menu agent |
| Medium | claude-sonnet-5-5 (medium) | gpt-6.1-sol (medium) | gemini-3.8-flash (high) | search terms, job criteria, people filter, agent 1, agent 4 |
| Power | claude-opus-5-5 (high) | gpt-6.1-sol (high) | gemini-3.8-flash (high) | ICPs, broadening ICPs, agents 2 and 3 |

## What a run does

1. **Plan**: ICPs (power), search terms (medium, unless given), job criteria (medium).
2. **Per search term**:
   - **People**: every results page until the end, saving each page's text and the page each
     person appeared on; then the medium model drops people who provide the service
     (10 per prompt) and notes each kept person's intent.
   - **Profiles** of the kept people: profile and header image, "see more" expanded, scrolled to
     the bottom, all page text saved as is; featured items and websites; then the activity page
     ("load more" up to 10 times, stopping early once posts are older than a month) and every
     post back one month through the post processor.
   - **Jobs**: one search per location, every page, each job opened, description expanded, full
     page text and company link saved.
   - **Posts**: content search, "load more" up to 20 times, every post through the post processor.
   - **Groups**: names, links and the text shown in the results (never joined).
3. **Sales Navigator** (when turned on): one lead search per ICP. Known filters are set by name
   (Geography, Industry, Company headcount, Seniority level, ...); when one cannot be set that
   way, a light agent (fast model) is shown the visible controls and sets it step by step. Every
   results page is read and each lead's link saved. Under 100 results, the ICP conversation goes
   back to the AI to broaden it and the search runs again. Each lead's profile then goes through
   the same profile and post processors.
4. **Agents**: 1 key indicators (medium), 2 profiles with their posts (power, levels 1/2/0),
   3 posts with reactions and comments (power, levels 1/2/0 plus the people named), 4 jobs
   (medium, 1 exact / 2 similar / 3 no match).
5. **Report**: `Report.md` and `Report.html`.

The **post processor** opens the post, expands it, records reactions, comments and reposts
counts, the caption and media, then the interactions: first the reactions list from the
reactions button (name, headline, profile link, reaction), then every comment with the
commenter's name, headline and profile link. `Interactions.json` holds both, in that order.

## Where the data goes

```
Local Files/Krypton/Run <date>/
  Config/                 config.json, plan.json (ICPs, terms, job criteria), progress
  <Search term>/
    People/_results.json  every search result with its page; _kept.json after the AI filter
    People/<Name (slug)>/ Profile text.txt, Profile image, Header image, featured.json,
                          websites.txt, profile.json, Posts/<Post>/...
    Jobs/<Title - Company (id)>/  Job text.txt, Company URL.txt, job.json
    Posts/<Author - words (id)>/  Post caption.txt, Media 1.jpg..., Interactions.json,
                                  Reactions.json, Comments.json, post.json
    Groups/<Name (id)>/   Group text.txt, Group URL.txt
  Sales Navigator/<ICP>/  Search 1.json, Search 2.json (broadened), ICP.json, People/...
  AI Runs/                every prompt and answer, numbered
  Results/                Indicators.json, People.json, Posts.json, Jobs.json
  Report.md, Report.html
```

A person, job or post found again under another term is copied, not read again.

## Stopping and resuming

Everything is saved as it is read. **Resume** on the Runs page continues in the same run
folder and skips every profile, post, job and AI agent that already finished.

## When LinkedIn changes its pages

All page structure lives in `src/workflows/krypton/linkedin/selectors.js`. To adjust without
editing code, put a JSON file at `Configurations/LinkedIn/selectors.json` with the same keys;
lists there replace the defaults. The readers also fall back on structure that rarely changes
(links to `/in/` profiles, `data-urn` post ids, `/jobs/view/` links).

## Limits worth knowing

- Daily guardrails (Automation → Guardrails) cap profile views (80), search pages (150), post
  views (300) and job views (200) per account. When one is reached, Krypton stops that kind of
  reading, classifies what it has and says so in the report's Notes.
- LinkedIn's terms do not allow automated collection, and the run stores personal data about
  the people it reads. Keep limits conservative and keep the data only as long as you need it.

## Tests

`test/krypton.test.js` runs the whole flow in Chromium against a LinkedIn-like test site
(`test/fixtures/linkedin-site.js`) with a scripted AI: every saved file, the one-month cutoff,
the interactions list, Sales Navigator (mapped filters, the agent fallback, broadening), the AI
tiers, the report, resume, and that no forbidden button is ever clicked.
