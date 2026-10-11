# List of Software Installations & Commands

Everything below installs into this `Software/` folder, so every computer runs the same
versions. The Software page of the control panel runs the same steps with one click, or use
the command line from the app folder.

| What | Command | Where it goes |
|---|---|---|
| Everything missing | `npm run install-software` | |
| Google Chrome (consumer build, not Chromium) | `node src/cli.js install chrome` | `Software/Chrome` |
| Firefox (Playwright build) | `node src/cli.js install firefox` | `Software/Firefox` |
| Camoufox | `node src/cli.js install camoufox` | `Software/Camoufox` |
| Invisible Playwright (Python) | `node src/cli.js install invisible` | `Software/Invisible-Playwright` |
| VulpineOS | manual, see below | `Software/VulpineOS` |
| rclone | `node src/cli.js install rclone` | `Software/rclone` |
| AI CLIs (Codex, Claude Code, Gemini CLI, OpenCode) | `node src/cli.js install ai-clis` | `Software/Frameworks` |
| AutoHotkey v2 (Windows prerequisite) | `node src/cli.js install autohotkey` | system install via winget |

Check what is installed: `node src/cli.js software`.

## Prerequisites

- Node.js 22 or newer, and git (for the quick update command).
- Windows: AutoHotkey v2 (`winget install --id AutoHotkey.AutoHotkey -e`).
- Python 3.11+ for Invisible Playwright (set `PYTHON_PATH` if it is not on PATH).

## How each one is installed

**Google Chrome.** Windows: the app asks Google's update service for the current stable
Chrome, downloads the official offline installer, and unpacks `Chrome-bin` with 7-Zip into
`Software/Chrome` (no system install, no admin rights). macOS: copies `Google Chrome.app` from
the official disk image. Linux: unpacks the official `.deb`. To use an existing Chrome
install instead, set `CHROME_PATH`.

**Firefox.** `PLAYWRIGHT_BROWSERS_PATH=Software/Firefox npx playwright install firefox`.
Playwright needs its own patched Firefox build to control Firefox.

**Camoufox.** `CAMOUFOX_INSTALL_DIR=Software/Camoufox/browser npx camoufox-js fetch`.

**Invisible Playwright.** Creates `Software/Invisible-Playwright/venv`, then
`pip install invisible-playwright` and `python -m invisible_playwright fetch` with
`INVISIBLE_PLAYWRIGHT_CACHE_DIR=Software/Invisible-Playwright/engine`. Alpha-Sales talks to it
through `bridges/invisible_bridge.py` because the library is Python-only.

**VulpineOS.** Download the browser bundle from
https://github.com/VulpineOS/VulpineOS/releases and extract it into `Software/VulpineOS`
(or set `VULPINE_PATH` to its executable). It launches through the Camoufox launcher and uses
Camoufox configurations.

**rclone.** Downloads `rclone-current-<os>-<arch>.zip` from downloads.rclone.org into
`Software/rclone`. Connect Google Drive from the Google Drive page (runs
`rclone config create gdrive drive scope=drive`).

**AI CLIs.** `npm install @openai/codex @anthropic-ai/claude-code @google/gemini-cli opencode-ai`
inside `Software/Frameworks`. Log each one in from Accounts → New CLI account → Log in.

**Claude in Chrome (extension).** Software page → Claude in Chrome, or
`node src/cli.js install claude-extension`. Downloads the extension from the Chrome Web Store
(id `fcoeoabgfenejglbffodgkkbkcdhcgfn`, override with `CLAUDE_EXTENSION_ID`), unpacks it into
`Software/Extension Copies/Chrome/Claude` with its store key so it keeps its store id, and makes
it a default extension, so every new Chrome profile gets it. Sign in to Claude inside the
extension once per profile.

**Wispr Flow (voice dictation).** A desktop app for Windows and macOS, not a browser extension.
Software page → Wispr Flow opens https://wisprflow.ai/downloads; run the installer and sign in.
The Software page shows it as installed once it is in its usual install folder.

## Extension Copies

Put unpacked extensions (or `.crx`/`.zip`) in `Software/Extension Copies/Chrome` and `.xpi`
files in `Software/Extension Copies/Firefox`, or add them from the Extensions page. Chrome
extensions are installed into a profile through the DevTools pipe (`Extensions.loadUnpacked`)
because current Chrome builds ignore `--load-extension`.

Extensions ticked as **Every new profile** on the Extensions page (stored in
`Configurations/extension-defaults.json`) are added to each new profile automatically.
**Add from Chrome Web Store** on the Extensions page fetches any store extension by id or link.

## Useful commands

| Task | Command |
|---|---|
| Start the app | `start.cmd` (Windows) or `./start.sh` |
| Quick update | `node src/cli.js update`, or Settings → Update app |
| Sync with Google Drive now | `node src/cli.js sync` |
| Version, computer and login | `node src/cli.js status` |
| Run the tests | `npm test` |
