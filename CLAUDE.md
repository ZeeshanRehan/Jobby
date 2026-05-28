# Jobby — Claude Code Context

## What Jobby Is
AI-powered job application automation system. Personal use only for now.
Target: reduce per-application time from 20-30 mins to under 60 seconds.

## Current Phase
**V2 — Chrome Extension + Autofill** (active)
- V1 → AI Resume Tailoring ✅ complete
- V3 → Playwright browser automation + cron job scraper
- V4 → Dashboard + analytics

---

## Stack
- **Runtime:** Node.js, Express
- **AI:** Anthropic Claude — model `claude-haiku-4-5-20251001`, temp `0.15` (migrated off Groq llama-3.3 on 2026-05-24; `ANTHROPIC_API_KEY` in `.env`)

> ⚠️ **NAMING — READ ONCE, NEVER RE-LITIGATE:** the file `groqService.js`, the env-var-history mention of
> `GROQ_API_KEY`, and any "Groq" wording in this doc are **legacy from before the 2026-05-24 migration**.
> Everything AI runs on **Claude via `@anthropic-ai/sdk` using `ANTHROPIC_API_KEY`**. There is NO Groq
> dependency and NO `GROQ_API_KEY` in use. The filename was deliberately kept (it's the "single source of
> truth" import in `tailor.js` + `apply.js`); **rename is a decided deferral, not an open question** — see
> the 2026-05-23 DECISION entry in `DEVLOG.md`. Don't burn a session "discovering" this again.
- **PDF:** Puppeteer + Chromium
- **Storage:** Supabase Storage, bucket `Resumes` (capital R)
- **Process manager:** PM2
- **VPS:** Hetzner, Ubuntu, root access (root@178.105.161.45)
- **Deployment:** Local → GitHub → SSH → git pull → pm2 restart

---

## File Structure
```
Jobby/
  server/
    data/
      profile.js         ← profileData object (single source of truth for autofill)
      adapters/
        greenhouse.json  ← field selectors + mapping for Greenhouse ATS
    routes/
      tailor.js          ← POST /tailor-resume, orchestrates the 3-step pipeline
      profile.js         ← GET /profile (API key protected)
      adapters.js        ← GET /adapters, GET /adapter (API key protected)
      apply.js           ← POST /apply (API key protected)
      ai-fallback.js     ← POST /ai-resolve-field, Claude fallback for unknown fields
    services/
      groqService.js     ← Claude tailoring logic + resumeData (source of truth) [LEGACY NAME — not Groq]
      pdfService.js      ← Puppeteer HTML → PDF buffer renderer
      uploadService.js   ← Supabase Storage upload → signed URL
      apiKeyAuth.js      ← Express middleware, x-api-key header check
    templates/
      resume.html        ← ATS-safe single-column HTML resume template
    server.js            ← Express setup, body parsers, route mounting
    .env                 ← PORT, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, JOBBY_API_KEY
  extension/
    manifest.json        ← MV3, permissions, service worker declared
    popup.html           ← Popup UI (tailor + autofill buttons, coverage UI)
    popup.js             ← Popup logic — tailor trigger, autofill trigger, state persistence
    content.js           ← Content script — JD scraping, DOM interaction
    background.js        ← Service worker — message routing
    config.js            ← VPS base URL, shared constants
    cache/
      profile.js         ← Cached profileData from /profile endpoint
      adapters.js        ← Cached adapter map from /adapters endpoint
      history.js         ← Application history cache
  automation/            ← V3 (UNCOMMITTED scaffold)
    seedQueue.js         ← runner: fetch GH board jobs → enqueue
    sources/
      greenhouseBoard.js ← GH board-API → normalized queue records (flags `fillable`)
    queue/
      queue.js           ← JSON-backed atomic queue (dedupes vs queue + applied_urls)
  dashboard/             ← V4, not built yet
```

---

## Architecture Rules
- `resumeData` in `groqService.js` is the **single source of truth** for all resume content.
  PDF generation, future dashboard, and extension all consume it from here. Never duplicate it.
- The pipeline is always: Claude tailoring → PDF generation → Supabase upload → return signed URL
- Each step has its own service file. Routes only orchestrate — no business logic in `tailor.js`
- Activities/Leadership section is static — Claude does not tailor it, pdfService renders it directly

---

## Naming Conventions

### Files & Folders
- Service files: `camelCase` + `Service.js` suffix — e.g. `groqService.js`, `pdfService.js`
- Route files: flat noun — e.g. `tailor.js`, future: `scraper.js`, `autofill.js`
- Template files: flat noun — e.g. `resume.html`
- Future extension files go in `extension/`
- Future Playwright/cron files go in `automation/`

### Functions
- Builder functions (pdfService): `build` prefix — e.g. `buildSkillsBlock()`, `buildExperienceBlock()`
- Service entry points: verb + noun — e.g. `tailorResume()`, `generateResumePdf()`, `uploadResume()`
- Prompt builders: `buildPrompt()`

### Variables
- Structured data objects: descriptive nouns — `resumeData`, `tailored`, `pdfBuffer`
- HTML chunks: `*Html` suffix — e.g. `bulletHtml`, `stackLine`
- Always destructure at the top of functions — don't dot-chain deep inline

---

## Comment Style
- **Section dividers:** `// ─── Section Name ───...` (use the box-drawing dash, not regular dash)
- **Inline comments:** one space after `//`, sentence case, no period
  - Good: `// required on Linux VPS`
  - Bad: `//required on linux vps.`
- **Block explanations** (above a function or non-obvious block): one line max, explains *why* not *what*
  - Good: `// Puppeteer launch is expensive, fail fast if template is missing`
  - Bad: `// This checks if the file exists`
- **TODO comments:** `// TODO: short description` — keep them specific
- **Never leave commented-out code** unless it has a `// TODO:` explaining why it's kept

---

## Prompt Rules (groqService.js)
These are non-negotiable — never relax them:
1. Never invent bullets, roles, companies, or metrics
2. Never change any number — preserve exactly as written
3. `skillsToAdd` = clean tool names only. No compound phrases, no descriptors.
   Banned suffixes: "design", "workflow", "management", "RESTful", "practices", "principles"
4. Bullets reworded only — keywords woven into the middle, never appended as "and..." clauses at the end
5. Summary = max 2 sentences, one real metric, no filler words
6. Warnings = max 4 items, max 12 words each

---

## Active Issues (V1)
- Claude (the tailoring model) still appending "and..." keyword clauses to bullet ends — prompt needs to be harder on this
- Resume still spilling to 2 pages on some JDs — padding/font tuning ongoing

---

## Current Build Status

### V1 — Complete
- POST /tailor-resume endpoint ✅
- Claude tailoring with prompt rules ✅
- Keyword injection into skills ✅
- Inline tech swaps in bullets ✅
- changesMade field in response ✅
- Puppeteer PDF — single page, ATS-safe ✅
- Activities & Leadership section ✅
- Supabase upload + signed URL ✅
- Chrome extension — scrape, tailor, download ✅
- Popup state persistence ✅
- Coverage gaps warnings ✅

### V2 — In Progress

**Server (complete)**
- [x] server/data/profile.js — profileData object
- [x] server/routes/profile.js — GET /profile (x-api-key protected)
- [x] server/routes/adapters.js — GET /adapters + GET /adapter
- [x] server/routes/apply.js — POST /apply
- [x] server/routes/ai-fallback.js — POST /ai-resolve-field (Claude Haiku fallback, defaultAnswers lookup + bio/projects for open-ended)
- [x] server/services/apiKeyAuth.js — middleware, JOBBY_API_KEY in .env
- [x] server/server.js — all V2 routes mounted with auth
- [x] CORS — chrome-extension:// origins allowed via cors({ origin: true })
- [x] server/data/adapters/greenhouse.json — field selectors for Greenhouse ATS
- [x] server/data/adapters/lever.json — written, mostly live-verified
- [x] server/data/adapters/ashby.json — live-verified working (location=combobox; all required fields commit + submit passes)

**Extension (mostly complete)**
- [x] extension/manifest.json — MV3, service worker, permissions
- [x] extension/popup.html — autofill button + coverage UI
- [x] extension/popup.js — autofill trigger + state persistence
- [x] extension/content.js — JD scraping + DOM interaction
- [x] extension/background.js — service worker / message routing
- [x] extension/config.js — VPS URL + shared constants
- [x] extension/cache/ — profile.js, adapters.js, history.js caching layer
- [x] extension/autofill.js — DOM execution layer (adapter fields + unknown scan + AI fill + react-select comboboxes + async type-ahead location + consent-checkbox ticking)
- [x] extension/autofill.js injected on-demand via executeScript (no manifest content_script entry needed)

**Automation stubs (not started)**
- [ ] automation/autofill/index.js — V3 Playwright stub
- [ ] automation/autofill/session.js — V3 cookie management stub

### Session Anchors (read these first when picking up)
Two complementary records — keep both current:
- **This "Last Session Cutoff"** = the *snapshot*: where we are right now + what's next. Overwrite it each
  session so it never goes stale (it had drifted badly before — claimed "uncommitted" / "not implemented"
  for work that had shipped).
- **`DEVLOG.md`** = append-only *post-mortems*: one entry per bug/saga — symptom, root cause, the dead
  ends (the stuff git can't tell you), the fix + commit, and verification status. Add an entry whenever a
  non-trivial bug is chased down. Never edit old entries; append follow-ups. Newest on top.
- `git log` is the diff; **Active Issues (V1)** above is the open-bug list. DEVLOG is the *why*, not a
  changelog duplicate.

### Last Session Cutoff
**Date:** 2026-05-28. **HEAD = `a2e261a` "docs: Ashby fully working".**
Claude Code runs on the VPS — server edits live after `pm2 restart all`; extension edits need git push →
local pull → Chrome reload. **NOTE: I (Claude Code) am on the VPS with NO Chrome — I can smoke-test the
server pipeline (`/apply`) but the live DOM fill/submit runs in the user's local Chrome via the extension.**

**STATUS: V3 has started — scaffold is on disk but UNCOMMITTED.** New untracked files:
`automation/sources/greenhouseBoard.js` (Greenhouse board-API → normalized queue records, flags `fillable`
for hosted `job-boards`/`boards.greenhouse.io` only), `automation/queue/queue.js` (JSON-backed atomic
queue, dedupes vs queue + `idempotencyService.hasApplied`), `automation/seedQueue.js` (runner). Plus new
services `applicationLogger.js` / `permanentStorage.js` / `idempotencyService.js` (these ARE committed).
**`server/data/queue.json` is seeded: 948 jobs, all `pending` — 398 fillable / 550 not** (Stripe is 481,
mostly off-platform). The drain loop (walk queue → fill/submit each → mark done) is NOT written.

**Next up (this session's goal):** test the queued links end-to-end. (1) Smoke-test ONE fillable Greenhouse
link through the full pipeline. (2) Integrate the queue so ~10 jobs get injected + autofilled end-to-end,
draining one-by-one until complete. KEY GAP: `/apply` needs a `jobDescription` but queue records don't store
it (greenhouseBoard fetches JD lazily) — the drain path needs a JD-fetch step (GH board API
`/{token}/jobs/{id}?content=true`). Architecture fork for the drain loop (in-browser persistent page vs
server Playwright) is unresolved — see roadmap below.

**Prior session — the Ashby autofill saga (`d2cecd7` → `e0d09fd` → `93e4bf2`).** Ashby FULLY WORKING,
live-verified — a real Ashby submit passes with every required field committed. Greenhouse live. Lever
partial (hCaptcha on submit). Full post-mortem in
DEVLOG (2026-05-27 entry). Three layered fixes, each surfaced by its own live run:
1. **Location combobox** (`d2cecd7`) — it's an ARIA-listbox combobox (`role=combobox`, opens on type, portaled
   `role=listbox #:r0:` with `role=option` rows), NOT react-select. Adapter location `type: "text"` →
   `"combobox"`, routed through `fillCombobox` (generalized: open-on-type; verify via `input.value` since
   there's no react-select chip). Split `fillText` → `setNativeValue` (no blur) so the typeahead doesn't
   blur-close its own menu before options mount.
2. **Commit on mousedown** (`e0d09fd`) — bare `.click()` updated Ashby's visual layer but never tripped its
   commit (fires on mousedown). `pointerClick` = mousedown→mouseup→click. Radio clicks the INPUT (mousedown
   bubbles input→container→option row to the handler; click still natively checks it); yesno/checkboxgroup
   click their control. NOT an isTrusted gate — synthetic events DO commit here.
3. **Fill-time race** (`93e4bf2`) — rapid synthetic events across the fill loop didn't all commit to React
   state; a SHIFTING ~3-field subset read filled but was empty at submit (proof: number "0" passed one run,
   failed the next, identical code+value). Fix: `await sleep(16)` (one frame) after each field in
   FILL_AI_FIELDS + FILL_FORM (in `finally`, covers every branch), plus a single verify+refill pass for
   text-like fields that read empty post-fill. Escalation if it recurs on non-text fields: the React-fiber
   path (see Background below).

**Dead ends — don't repeat (full detail in DEVLOG):** the yesno hidden-`<input type=checkbox>` probe was a RED
HERRING — that checkbox is Ashby's visual/internal state, not its validation source (read byte-identical across
a passing AND a failing run); removed it. Label-click on radios missed the commit (mousedown didn't reach the
handler) — click the input. The prior blur fix (`c9fbc12`) was necessary but not sufficient.

**Roadmap after Ashby (unchanged priority):** V3 job queue + Greenhouse Job Board API → autonomous in-browser
drain loop (MV3 SW dies ~30s, needs a persistent page) → flip dry-run off (hCaptcha on Lever is the known
risk) → V4 dashboard. Workday is a separate project, not soon.

**Local harness** (`.harness/`, untracked) validates react-select DOM mechanics only — it greenlit two passes
that died on the real form. **For DOM behavior, the real-form test is the only source of truth.** `npm test`
is the complement: pure logic (matching/resolving) where offline IS trustworthy — split is deliberate.

---

**Background that still holds (from earlier M3 / AI-fallback / Claude-migration work):**
- **Flow:** `scanUnknownFields` (autofill.js) → `localResolveField` (popup.js, ~75% of fields with ZERO
  API: demographics, yes/no, salary, location, acks) → Claude `POST /ai-resolve-field` only for
  open-ended, batched 3-at-a-time, job description passed as `contextHtml`. The local pre-resolver is
  what killed the **429 TPM** errors.
- **AI** = `claude-haiku-4-5-20251001` via `@anthropic-ai/sdk` for both tailoring (`groqService.js`) and
  field resolution (`ai-fallback.js`). ~$0.043/app. `ANTHROPIC_API_KEY` lives in `server/.env`.
- **profile.js** holds demographics + 90+ `defaultAnswers` + `bio`/`projects` (PPST, Jobby, Are You
  Hungry) for open-ended "tell me about yourself / why this company" questions.
- **Resume upload** uses the `#resume` selector (not `input[name='resume']`) via DataTransfer — confirmed live.
- **Reliability upgrade option** if synthetic events ever prove flaky: drive react-select via React
  fiber/props (Simplify-style, trusted-event-free). That's also the V3 Playwright path → fully hands-off fill+submit.

---

## Deployment
```bash
# From local
git add . && git commit -m "message" && git push

# On VPS
cd ~/Jobby && git pull && pm2 restart all && pm2 logs
```

---

## V3+ Strategic Direction (EXPLORATORY)
> **Moved to `NOTES.md`** — search the `[IDEA] V3+ strategy` entry. It was bloating this always-loaded
> file. Nothing there is committed/built; it's the *why* + tradeoffs behind the volume-autopilot /
> in-browser-loop / SaaS lean. Recon from real ATS runs also lives in `NOTES.md` (`[RECON]` tags).

---

## Future Modules (keep in mind when editing)
- **V2 extension/** — content script POSTs JD to this same backend, same `/tailor-resume` endpoint
- **V3 automation/** — Playwright service will live here, separate from Express server, own PM2 process
- **V3 cron/** — job board scrapers, will call same tailoring pipeline programmatically
- **V4 dashboard/** — reads `resumeData` and application tracking data, likely React frontend
- Don't couple new code to Express internals — services should stay independently callable

---

## V2 Build Notes & Gotchas

- GET /profile needs API key protection — add x-api-key header check,
  same JOBBY_API_KEY in .env, don't expose profile data openly
- CORS must allow chrome-extension:// origins — add to Express CORS config
  before first extension test or requests will silently fail
- Adapter selectors go stale — if a selector matches 0 elements on page,
  flag as "stale" in coverage report, not "unknown"
- Supabase signed URLs expire in 1hr — for V3 compatibility store a
  permanent public URL or VPS path alongside the signed URL
- Use the AI model (Claude) for unknown field resolution instead of keyword matching —
  more resilient to varied phrasing across job boards
- DataTransfer file upload is finicky — test on real Greenhouse page
  before considering it done
- Don't build autofill logic into the extension — keep it as a VPS service
  the extension calls so V3 reuses the same service headlessly