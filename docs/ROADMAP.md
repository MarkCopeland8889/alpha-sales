# Roadmap

What exists now is the foundation from the blueprint. These are the next pieces, roughly in
order. Each builds on the scraper and job system rather than changing the core.

## 1. AI through chat websites (no token cost)

Providers `chatgpt-web`, `gemini-web`, `claude-web` and `google-web` are registered in
`src/ai/providers/web.js` and appear in the AI hub as planned. Each will be a scraper that
drives the logged-in website in a saved profile and implements the function list from the
blueprint (chat, model picker, attachments, deep research, downloads, retry, fork,
projects/folders, temporary chat, and the Gemini-only video, music and spark actions).
The function matrix in the AI hub tracks what each provider supports.

Things to settle first: which profile and account each provider uses, how to queue prompts
so one chat account is not used by two runs at once, and each site's terms of use for
automated access.

## 2. Jev controller

`jev` is wired as a decision provider and a job controller option. It needs the TypeSafe
Jev API details (`JEV_API_KEY`, `JEV_BASE_URL`) and a definition of what decisions it makes
(for example, choosing the next action from a list of candidate elements).

## 3. Dynamic AI scraping agent

A low-cost agent that navigates sites it has not seen before, probably on VulpineOS. The
pieces it needs already exist: the page API, the AI hub, checkpoints, guardrails and
human-in-the-loop.

## 4. Krypton (client generation & prospecting)

Built for LinkedIn and LinkedIn Sales Navigator (see `docs/KRYPTON.md`). Next steps:

- Run test 1 on a real LinkedIn account and adjust `selectors.json` where LinkedIn's pages differ.
- Groups beyond names and links (the workflow doc says "we will come back here").
- The other platforms from the workflow doc (Facebook, Reddit, X, Upwork, Indeed, ...).
- DOCX or PDF export of the report (Markdown and HTML today).

## 5. Later

- Argon (studying and recreating social posts) and Xenon (validation, building, outreach).
- Group handling for LinkedIn.
- A server install mode (run the engine headless as a service on a dedicated computer).
- Cloud storage other than Google Drive, if the data grows past what Drive handles well.
