# Architecture

Alpha-Sales is one Node.js process per computer. It runs the engine (browsers, jobs, sync,
heartbeat) and serves the control panel on `127.0.0.1:7300`. Computers coordinate only
through the database: there is no central server to run.

```
 control panel (ui/)  ──HTTP + WebSocket──▶  src/server  ──▶  engine modules
                                                               │
     Supabase (or local JSON store)  ◀── devices, jobs, runs, proxies, checkpoints, HITL
     Google Drive (rclone)           ◀── Accounts, Profiles, Configurations, Scrapers, Local Files
```

## Blueprint → code

| Blueprint section | Code |
|---|---|
| Folder layout, gitignore | `src/core/paths.js`, `.gitignore` |
| Environment variables | `src/core/env.js`, `.env.example`, Settings page |
| Running commands (PowerShell, admin, AHK) | `src/core/commands.js`, Commands page |
| Debugging: `log()` with ✅/⚠️/❌, simple/advanced, run file | `src/core/logbook.js`, Logs page, live log drawer |
| File storage: rclone `update()`, `check()`, `archive.exist()`, `archive.new()` | `src/sync/rclone.js`, `src/sync/watcher.js`, Google Drive page |
| Supabase DB (accounts, devices, projects, jobs, proxies, status checks) | `supabase/schema.sql`, `src/db/` |
| Computers: machine name, id, version | `src/core/machine.js`, `src/devices/registry.js`, Computers page |
| Heartbeat & status every 30 s | `src/devices/registry.js` |
| Delegation only between same versions | `checkDelegationTarget()` in `src/devices/registry.js`, `src/jobs/queue.js` |
| Version & quick update | `src/core/version.js`, `alpha update`, Settings → Update app |
| Google login, bucket + device creation, login process | `src/auth/session.js`, `src/engine.js` |
| Browsers launchable with profile + proxy + config | `src/browsers/` (`openBrowser()`) |
| Consumer Chrome, not Chromium | `src/browsers/chrome.js`, `src/software/index.js` |
| Profiles `Profiles/<Browser>/<Profile>` | `src/profiles/index.js` |
| Extensions installed into profiles | `src/extensions/index.js` |
| Proxies in the DB, website status checks | `src/proxies/index.js` |
| Configurations (Camoufox files, Invisible Playwright seeds) | `src/configs/index.js` |
| Accounts: web and OAuth (CLI) | `src/accounts/index.js`, `src/ai/cli-tools.js` |
| Scrapers with checkpoints saved to the DB | `src/scrapers/` |
| Jobs: scrapers in sequence or in parallel | `src/jobs/` |
| AI functions and providers (+ Claude) | `src/ai/` |
| Guardrails & debug | `src/guardrails/index.js`, `src/scrapers/hitl.js` |

## Key decisions

**Consumer Chrome workaround.** Playwright's `channel: 'chrome'` still adds automation
flags, and current Chrome ignores `--load-extension`. Alpha-Sales instead launches the real
`chrome.exe` itself with `--user-data-dir=Profiles/Chrome/<name>` and a remote debugging
port, then attaches Playwright with `connectOverCDP`. Extensions are installed through a
DevTools pipe with `Extensions.loadUnpacked`. Puppeteer can attach to the same browser
(`session.puppeteer()`), so scrapers written for either library work. The official Chrome
package is unpacked into `Software/Chrome` so the version is identical on every computer.

**Invisible Playwright bridge.** The library is Python-only. `bridges/invisible_bridge.py`
runs inside `Software/Invisible-Playwright/venv` and exposes a page API over JSON lines;
`src/browsers/invisible.js` wraps it in an object that looks like a Playwright page, so
scrapers do not need to know which browser they are on. It always uses persistent mode.

**VulpineOS** is launched through the Camoufox launcher with its own executable and reads
Camoufox configurations. ("VulcanOS" in the blueprint is treated as VulpineOS.)

**Authenticated and SOCKS proxies.** Browsers get a local forwarder (`proxy-chain`) on
127.0.0.1 that adds the credentials, because Chrome cannot take proxy passwords on the
command line and does not support authenticated SOCKS.

**Job delegation through the database.** Every run is a `job_runs` row addressed to one
machine id. Each computer claims its own queued rows (polling every 10 s, plus Supabase
realtime). Claiming is a conditional update, so a run never starts twice. A stop request
from another computer is noticed at the next run heartbeat.

**Local mode.** Without Supabase settings, the same database API is served from JSON files
in `Local Files/.alpha/db`, so a single computer works with no setup.

**Human in the loop.** When a scraper detects a CAPTCHA or login wall it creates a
`hitl_requests` row, brings the browser to the front, and waits. A person solves it in the
browser and clicks Done in the control panel (from any computer). The engine does not
solve or bypass CAPTCHAs itself.

**Security of the control panel.** The server binds to 127.0.0.1, rejects other Host
headers (DNS rebinding), and requires a per-install token on every API call and WebSocket.
Saved account passwords are encrypted with `ALPHA_SECRET` (AES-256-GCM). Supabase tables use
row-level security so each Google account only sees its own rows.

## Events

`src/core/events.js` is an in-process event bus. The WebSocket at `/ws` forwards every
event to the control panel: `log`, `session.opened/closed`, `run.queued/started/progress/
finished`, `hitl.request/resolved`, `device.heartbeat`, `sync.*`, `software.*`,
`guardrails.changed`, `jobs.changed`, `auth.changed`.
