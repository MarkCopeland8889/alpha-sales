# Alpha-Sales

Alpha-Sales is the core engine for an AI and browser automation system: it opens real browsers
with saved profiles, proxies and fingerprints, runs scrapers and jobs on any of your computers,
talks to AI providers, keeps files in sync through Google Drive, and records everything in
Supabase. A local control panel exposes every function.

This repository is the foundation from the Alpha-Sales Blueprint (`docs/source/blueprint.md`).
Platform workflows are built on top of it as scrapers and jobs. The first one, **Krypton**
(LinkedIn client generation and prospecting, `docs/KRYPTON.md`), is on the control panel under
Workflows.

## Quick start

1. Install Node.js 22+ and git. On Windows also install AutoHotkey v2.
2. `npm install`
3. Start it: `start.cmd` on Windows, `./start.sh` on macOS/Linux (or `npm start`).
   The control panel opens at http://localhost:7300.
4. On the Software page, install Chrome, Firefox, Camoufox, Invisible Playwright and rclone.
5. Sign in. Without Supabase settings the app runs in **local mode** (one computer, data in
   `Local Files/.alpha/db`). For Google login and several computers, set up Supabase below.

## Supabase (multi-computer mode)

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Authentication → Providers → Google: enable it with your Google OAuth client.
   Add `http://localhost:7300/auth/callback` to the allowed redirect URLs.
3. In the control panel's Settings, fill `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `ALPHA_SECRET` (same secret on every computer), then restart.

Signing in with Google creates your account row ("bucket") and registers the computer
(device name, machine id, app version, status and a heartbeat every 30 seconds).

## Google Drive

Install rclone from the Software page, then Google Drive → Connect. Accounts, Profiles,
Configurations, Scrapers and Local Files are mirrored to `Alpha-Sales/<your account>/` in
Drive. On launch the app pulls newer files, then uploads local changes; after that every
edit is uploaded a few seconds after it happens, and its last edit date is written to the
database. Deleted files are moved to `Archive/<date>/` in Drive instead of being lost.

## What is where

| Folder | Holds | Committed |
|---|---|---|
| `src/` | the engine | yes |
| `ui/` | the control panel (plain HTML/JS, no build step) | yes |
| `bridges/` | the Python bridge for Invisible Playwright | yes |
| `supabase/schema.sql` | database tables and row-level security | yes |
| `Accounts/<Platform>/<username>/` | web and CLI (OAuth) accounts | no, synced |
| `Profiles/<Browser>/<Profile>/` | browser profiles | no, synced |
| `Configurations/<Browser>/` | Camoufox configs, Invisible Playwright seeds, Chrome flags | no, synced |
| `Scrapers/<name>/scraper.js` | your scrapers | no, synced |
| `Local Files/` | scraped data and other outputs | no, synced |
| `Logs/` | one log file per app run, plus one per job run | no |
| `Software/` | browsers, rclone, AI CLIs, extension copies | no (except the install list) |

## Docs

- `docs/ARCHITECTURE.md` maps every blueprint section to the code that implements it.
- `docs/SCRAPERS.md` explains how to write a scraper and build jobs from scrapers.
- `docs/KRYPTON.md` explains the Krypton LinkedIn workflow: settings, what a run does, where
  the data goes, resuming, and adjusting selectors.
- `docs/ROADMAP.md` lists what is planned next (AI chat websites, Jev, the dynamic agent,
  more Krypton platforms).
- `Software/List of Software Installations & Commands.md` lists every install step.

## Command line

```
node src/cli.js start [--no-open]   start the engine and control panel
node src/cli.js update              quick update (git pull + npm install)
node src/cli.js install <id|all>    chrome, firefox, camoufox, invisible, rclone, ai-clis, autohotkey,
                                    claude-extension, whisper
node src/cli.js software            what is installed
node src/cli.js sync                Google Drive sync now
node src/cli.js status              version, computer, login
npm test                            run the tests
```

The control panel only listens on 127.0.0.1 and every API call needs the token stored in
`Local Files/.alpha/api-token`, so other programs and websites cannot drive it.
