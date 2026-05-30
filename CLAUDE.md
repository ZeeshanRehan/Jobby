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

**V3 — Multi-ATS drain LIVE (Greenhouse + Ashby + Lever all submit-verified)**
- [x] automation/sources/greenhouseBoard.js — GH board API → normalized queue records
- [x] automation/sources/ashbyBoard.js — Ashby `posting-api/job-board/{org}` → normalized records
- [x] automation/sources/leverBoard.js — Lever `/v0/postings/{org}?mode=json` → normalized records
- [x] automation/queue/queue.js — JSON-backed atomic queue (ATS-agnostic record shape)
- [x] automation/seedQueue.js — `--source greenhouse|ashby|lever` flag, default seeds all three
- [x] server/services/drainLogger.js — JSONL append + tail
- [x] server/routes/queue.js — /next (with `?ats=greenhouse|ashby|lever|all`), /update, /log, /stats, /mark-applied
- [x] server/routes/jd.js — per-ATS fetchers: `/jd/greenhouse/:tok/:id`, `/jd/ashby/:org/:id`, `/jd/lever/:org/:id`
- [x] extension/drain.html — controller UI: ATS dropdown, target, dry-run, watchMode, breakdown, last-job details
- [x] extension/drain.js — claim → JD → tailor → tab → fill → AI fallback → submit → update → jitter loop;
      ATS-aware fetchJD dispatch; round-robin mode (TESTING flag — see code comments to remove later)
- [x] extension/autofill.js FILL_SUBMIT — tightened captcha guard (visible iframe ≥200×200 + visibility/display/opacity/offsetParent check), submit selector chain: standard semantic → `.ashby-application-form-submit-button` → `#btn-submit`/`[data-qa="btn-submit"]` (Lever) → `button[class*="_primary_"]` (Ashby hash-rotation fallback) → text-match fallback (`^submit|apply|send|finish`)
- [x] extension/autofill.js FILL_FORM — parallel `report.filledDetails: [{field, label, value}]` for audit (legacy `filled: [string]` preserved for popup/server consumers)
- [x] Live-verified end-to-end on all three ATSes: Greenhouse (40 done), Ashby (Notable Staff Fullstack — submitted), Lever (Mistral AE — submitted)
- [x] AI Q/A persistence to drain.jsonl on the drain path
- [ ] AI Q/A persistence on the popup-autofill path (open)
- [ ] V3 Playwright path — deferred; in-browser is the chosen architecture

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
**Date:** 2026-05-30 (Workday session, cont'd). **HEAD = tip of this session (my_information widgets + false-needs_login fix — see git log top).**
Claude Code runs on the VPS — server edits live after `pm2 restart all`; **adapter JSON is read fresh per
request (`readFileSync` in apply.js), so adapter edits are live with NO restart/reload.** Extension edits
(autofill.js, drain.js) need git push → local pull → Chrome reload. **I'm on the VPS, NO Chrome — server
pipeline I smoke-test; live DOM fill/submit runs in user's local Chrome.**

**STATUS: GH + Ashby + Lever still submit-verified. Workday = 4th ATS, IN PROGRESS.** Reorder `96bd12f`
**VERIFIED LIVE this session** — drain reached my_information through the method menu, no loop, no
`max_pages_exceeded`. my_information now has handlers for **all 6 required fields** (text/radio + the new
`workdayMultiselect` for How-Did-You-Hear, `workdayListbox` for Phone Device Type) — **UNVERIFIED live;
DOM-guess against Workday's `promptOption` portal pattern, needs one run.** Workday is structurally
different: multi-page wizard behind a **per-tenant login wall**; `apply_url` is the job POSTING page, not
the form. **Zero-touch impossible** — one-time manual login per tenant, then unattended (session persists
in Chrome profile). This is the cred-custody SaaS blocker showing early. Seed tuple:
nvidia/wd5/NVIDIAExternalCareerSite (live, 2000 jobs).

**Workday flow:** posting → click Apply (`adventureButton`) → method menu → click Apply Manually
(`applyManually`) → sign-in wall (→ `needs_login`) OR my_information → fill → Next → my_experience
(status:todo) → aborts `page_not_implemented:my_experience`. Handler = `FILL_FORM_WORKDAY` in autofill.js
(separate from single-page FILL_FORM). `workday.json` pages ready: `start_application, posting,
my_information, review`; 4 middle pages = todo stubs that abort clean.

**Workday session — 4 bugs fixed live (each a separate run), full post-mortem in 2026-05-30 DEVLOG:**
- crash-loop (whole API down, ALL ATSes): jd.js bare `*` route rejected by Express 5 path-to-regexp v8 →
  named `*splat` + `req.params.splat`; also double-`/job` in workday JD URL (406). (`b404b40`)
- workday.json address fields pulled non-existent `address.*` → `contact.address.{street,city,zip}`. (`b404b40`)
- mount_timeout: wizard iter-0 used instant `detectPage()`, missed Workday's ~3s SPA paint → now polls
  `waitForAnyPage()`. (`e01e4a0`)
- max_pages_exceeded (menu re-opened forever): `/apply` keeps `adventureButton` in DOM beside the menu,
  `posting` re-matched first → reordered `start_application` before `posting`. (`96bd12f`, **VERIFIED LIVE
  2026-05-30 — drain advanced posting→menu→Apply Manually→my_information, no loop.**)

**False-needs_login on my_information (FIXED this session, unverified live — 2026-05-30 DEVLOG):** once past
the wall, an unvalidatable my_information (2 required widgets had NO handler) looped → script teardown /
60s `message timeout` → `isLoginWall` layer-3 teardown heuristic mis-read it as a login wall (logged
`needs_login`, dropped the fill report). Three fixes shipped together: (1) built the 2 widget handlers; (2)
`isLoginWall` now probes `auth.postLoginAnchor` (`applyFlowPage`, wraps every wizard page) FIRST — present =
past login = teardown was in-wizard, return false; (3) wizard loop `stuck_on:<page>` guard returns WITH the
report when a field-page re-detects after Next, so a validation block is a clean logged abort, not a silent
loop. `bailNeedsLogin` now logs report+pagesVisited+errMsg.

**Submit selector chain (autofill.js FILL_SUBMIT — current order):**
1. `button[type="submit"], input[type="submit"], button[data-source="submit"], button.ashby-application-form-submit-button, button#btn-submit, button[data-qa="btn-submit"], button[data-automation-id="submitButton"], button[data-automation-id*="submit"]` (last two = Workday)
2. `button[class*="_primary_"]` (Ashby CSS-module hash-rotation fallback)
3. Text fallback — any visible button with text matching `/^(submit|apply|send|finish)\b/i`
All stages exclude cancel/back/withdraw/save-draft/preview by text and require `visible(el) && !disabled`.

**Open bug — AI URL fabrication (HOT, partly mitigated, root not fixed):** the Lever Mistral submit went
through with Google Scholar URL = `https://scholar.google.com/citations?user=zeshan-rehan` — a plausibly-shaped
but completely invented URL. Profile has no scholar field. Same risk applies to any URL-shaped field the
user lacks: Behance, Dribbble, ORCID, personal-site variants, etc. Root fix: harden `server/routes/ai-fallback.js`
prompt to forbid URL fabrication and return empty string when no profile data matches. Defensive client-side
filter (drop URL-shaped answers whose host isn't in `profileData.contact.*`) is a viable second layer.
**This is the highest-priority bug heading into the next session — it ships bad data on every run.**

**Round-robin status:** code shipped (`2cd2dd4`) and traces correctly (rrIndex 0→1→2→0 cycles
greenhouse→ashby→lever, falls through on empty bucket). **Not yet live-verified** — user's 12-job run
that triggered the "didn't rotate" question was on the `all` filter, not `round_robin` (verified via
drain.jsonl: 20 consecutive `gh_*` job IDs). `?ats=all` uses queue file order via `findIndex`, and the
queue holds all 948 GH records before any Ashby/Lever — so `all` is GH-heavy until those exhaust.
Round-robin needs an explicit dropdown selection. To live-verify next session: pick "Round-robin (test)",
target=6, expect 2 of each ATS.

**Next up (in priority order):**
1. **Live-verify Workday my_information full fill (THIS session's build — UNVERIFIED).** Needs push → local
   pull → Chrome reload (extension code changed). Then drain Workday target=1 (NVIDIA already authed → goes
   straight to my_information; else `needs_login` once, sign in, re-run). Expect: all 6 fill incl.
   How-Did-You-Hear=LinkedIn (`workdayMultiselect`), Phone Device Type=Mobile (`workdayListbox`),
   previously-worked=No (`radio`) → advances → `page_not_implemented:my_experience` = **v1 milestone.** If a
   widget misses, drain.jsonl now logs WHY (`listbox: no options mounted` / `multiselect: no match for
   'LinkedIn' in [...]`) and the loop returns `stuck_on:my_information` WITH the report — read that, don't
   re-read it as a login wall. **Likely snag:** NVIDIA may require Address (deferred from the adapter on
   purpose) → `stuck_on:my_information` (legible) → add `addressSection` fields back + handle the
   country/state combobox.
2. After milestone: build Workday `my_experience` (resume upload) page, then route the 3 todo pages
   (questions/voluntary/self-id) through the existing unknown-scan + AI-fallback path. Workday SSO assist (v1.5).
3. **Harden `ai-fallback.js` prompt** to forbid URL fabrication (Google Scholar hallucination — still HOT,
   unaddressed; ships bad data on every GH/Ashby/Lever run).
4. Live-verify round-robin mode (target=6, expect 2 of each ATS); ROUND_ROBIN_ORDER excludes workday on purpose.
5. AI Q/A persistence on popup-autofill flow (drain has it, popup doesn't).
6. Widen seed list; V4 dashboard; strip round-robin path (deferred).

**Useful one-liners (no `jq` on VPS — node only):**
```
# All AI Q/A from drain.jsonl
node -e "require('fs').readFileSync('server/data/drain.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(e=>e.step==='fill_ai').forEach(e=>{console.log('\n=== '+e.company+' ===');(e.data.fields||[]).forEach(f=>console.log('  ['+f.status+'] '+f.label+' → '+f.value))})"

# Queue distribution by ATS / status
node -e "const q=require('./automation/queue/queue').readQueue();const by={};q.forEach(r=>{const k=r.ats+'/'+r.status;by[k]=(by[k]||0)+1});console.log(by)"
```

**Older session pointers (still load-bearing if you're touching those areas):**
- `0d6ebf6` autofill gate fix — local resolver now gated through `bestOptionMatch(field.options, answer)` when options exist, demoted to AI otherwise. `closeCombobox` layered with documentElement + dropdown-indicator fallbacks; `fillCombobox` verify uses whitespace-normalized bidirectional substring. Full post-mortem: 2026-05-28 DEVLOG entry.
- Ashby autofill saga (`d2cecd7` → `e0d09fd` → `93e4bf2`) — location combobox path, mousedown commit, fill-time race. Full post-mortem: 2026-05-27 DEVLOG entry.

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