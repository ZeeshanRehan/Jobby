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
  automation/            ← V3, not built yet (Playwright, cron jobs)
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
- [ ] server/data/adapters/lever.json — not yet written
- [ ] server/data/adapters/ashby.json — not yet written

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
**Date:** 2026-05-25. **HEAD = `24f8635` "autofilll greenhouse upgraded needs lesser AI fallback".**
Working tree clean except runtime data (`applications.json`, `applied_urls.json`, 2 résumé PDFs accruing
from runs) — no uncommitted code.

**STATUS: autofill runs end-to-end on live Greenhouse and Phase 1 cleanup is DONE.** One run fills: adapter
text fields → resume upload → react-select dropdowns → AI/local field resolution → consent-checkbox
ticking. Submit is never clicked (dry-run by design). Full per-bug post-mortem for the combobox saga lives
in `DEVLOG.md`.

**Phase 1 — pre-V4 cleanup (COMPLETE, committed).** This was the "de-tax" pass before V4 log work:
- **Test system** (`be837ba`): `npm test` (`node --test`, zero deps, 20 green). `localResolveField` →
  `extension/lib/resolve.js`, `bestOptionMatch` → `extension/lib/match.js` — both dual browser-global /
  Node-export, single source of truth, loaded as content-script globals / `<script>` before `popup.js`.
  `test/resolve.test.js` + `test/match.test.js` encode every DEVLOG logic regression (Lebanon, "No"⊂"Not…",
  country→work-status leak, leading-clause, token-overlap, shortest-wins, boundaries).
- **`bestOptionMatch` extraction** (`24f8635`): moved OUT of `autofill.js` → `lib/match.js`; injection is
  now `executeScript files: ["lib/match.js", "autofill.js"]` (popup.js:270); `match.test.js:6` now
  `require()`s the real module — **the duplicate-copy maintenance tax is paid off** (no more hand-mirroring
  the matcher between `autofill.js` and the test). This extraction was HELD until checkbox confirmed live.
- **Debug logs stripped** from `autofill.js` (`24f8635`) — the "lighten the logs" half. High-level run logs
  (`FILL_FORM received`, `report:`, `AI fill done`) kept; per-field combobox/fill/typeahead spam gone.
- **Consent checkbox CONFIRMED LIVE** — last Remote/Greenhouse run reported `consent: 1`, 0 errors, filled
  clean on the stripped `autofill.js`. `localResolveField` wiring confirmed too (run completed without a
  `ReferenceError` → the resolve.js global-sharing contract holds; the old "unverified wiring" worry is closed).

**Open loose ends from Phase 1:**
- **async type-ahead location still UNCONFIRMED live** — the last retest form had no location combobox
  (adapter fields were just name/email/phone/resume/linkedin/website). Confirm on a form that has one.
- **doc-only**: the `autofill.js` "United States → not Alabama" comment is factually wrong (shortest-wins
  actually picks "…- Alabama"). Benign — see DEVLOG 2026-05-25 OPEN. Fix when next touching that file.

**AI-fallback measurement gap (the "lesser AI fallback" thread — the commit name is a TODO, not done work).**
We CANNOT see the local-vs-AI split. `sendAiFields` DOM-fills the MERGED resolved set, so a log like
"AI fill done — filled: 24" = local+AI **combined**, NOT 24-to-Claude. The server route (`ai-fallback.js`)
logs only on error, and the last run had 0 errors → no retroactive record either. **Before adding anything
to `localResolveField`, instrument the split** in `resolveUnknownFields` (popup.js:328): log `local: X |
ai: Y` + the exact labels routed to Claude. One real run then tells us whether AI fallback is already fine
(only genuine open-ended Qs leaking) or bloated (standard fields leaking through). Measurement-first — do
NOT guess-extend the resolver. (This instrumentation doubles as a down payment on V4's local-vs-AI analytic.)

**Runtime data accruing:** `server/data/applications.json` per-app records (`jobUrl, status, mode,
resumeUrl, changesMade, coverageReport`) — V4 dashboard foundation. `coverageReport` is still
**field-names-only** (`filled`/`skipped`/`consent` arrays), NOT yet the per-field
`{ label, value, source, status }` the audit table needs.

**Deploy/test state:**
- Tests: `npm test` (`node --test`, no deps) — 20 green. Run before committing matcher/resolver logic changes.
- Extension changes need an **extension reload** to pick up. Server HEAD is pushed; VPS needs
  `cd ~/Jobby && git pull && pm2 restart all` only if a server file changed (Phase 1 was extension/local only).

**Next up (priority order):**
1. **(cheap, ~5 lines) Instrument the local-vs-AI split** in `resolveUnknownFields` (popup.js:328) → one
   live run → decide whether the "lesser AI fallback" agenda needs any work at all. Doubles as V4 down payment.
2. **Confirm async location live** on a form that HAS a location combobox; fix the wrong Alabama comment
   in `autofill.js` while there.
3. **Dashboard groundwork (V4)** — enrich `coverageReport` from field-names-only to per-field
   `{ label, value, source: adapter|local|ai, status }`. Foundation for the audit table + feedback loop:
   user wants to review/correct non-standard fills and save them as profile defaults ("not every fill is
   exactly how I'd want it"). Proposed app record:
   `{ id, appliedAt, jobUrl, platform, company, jobTitle, resumeUrl, tailoring, fields[], counts }`.
   Analytics: coverage rate, most-blank labels, local-vs-AI hit rate, per-platform.
4. True multi-VALUE fill ("select all that apply") — single pick only. Deferred.
5. `lever.json` / `ashby.json` adapters; `automation/` Playwright stubs (V3 hands-off submit).

**Local harness** (`.harness/`, untracked) validates react-select DOM mechanics only — it greenlit two
passes that died on the real form. **For DOM behavior, the real-form test is the only source of truth.**
The new `npm test` suite is the complement: it covers the *pure logic* (matching/resolving) where offline
testing IS trustworthy — that split (logic = unit-tested, DOM = live-only) is deliberate.

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

## V3+ Strategic Direction (EXPLORATORY — brainstormed, NOT committed/built)
> Captured from a long design conversation so next session has the *why*, not just the *what*. Nothing here
> is decided or scheduled — it's the shape we reasoned toward and the tradeoffs behind each lean. **This
> revises the "V3 = Playwright everywhere" assumption in Future Modules below** (see "Playwright's role").

**North star.** Volume over polish: ~20-30 (stretch 30/day) tailored apps/day, **as close to zero
human-in-loop as possible.** User accepts that some apps go out wrong/stale — throughput beats per-app
perfection ("it was never meant to be perfect from the getgo"). Long-term aspiration: a **multi-user SaaS**
(dashboard, ~$20-50/mo). Personal-use job hunt is the prototype/dogfood and comes first regardless.

**THE central fork — credential custody.** Never hold users' Google/Workday passwords or log in *as them*
server-side: that's a breach honeypot + Google-ToS violation + (for SaaS) liability. **Decision lean:
everything runs client-side in the user's own already-logged-in browser** — never store their creds.

**Chosen apply model — autonomous in-browser loop (NOT Simplify-style handholding).** The extension drives
tabs in the user's browser on its own: pull next job from queue → open → fill (existing engine) → submit →
next, looping while the user leaves a window open on the side. Uses their real session, so no cred custody.
Multi-page (Workday) IS drivable this way (navigate + re-inject per page). Orchestrate from a **persistent
extension page** (MV3 service workers die at ~30s) — that page is also the dashboard.

**The trilemma (pick two):** always-on / no-credential-custody / cheap.
- In-browser loop = no-custody + cheap, but **browser must be open** (the accepted tradeoff). Auto-start +
  background-run makes the friction "machine on," not "babysitting" — lunch is fine; only laptop-closed-all-day is a gap.
- **Split queue softens it:** server *finds + tailors* 24/7 (cheap, no browser); extension *drains* the
  queue whenever the browser's on and catches up. Missing a day just delays, doesn't lose.
- Cloud-VM / hosted browser (Browserbase/Kasm/Browserless) = always-on + phone-access, but **re-introduces
  session custody + per-user always-on compute cost** → only as a higher-priced premium tier, eyes open.

**Playwright's role (revised).** The in-browser pivot **retires "Playwright for applying" in the SaaS path**
— the extension does it, in the user's session, multi-page included; server-side Playwright would re-create
the custody landmine. Playwright now only for: (a) *personal* laptop-closed/server-side use (own creds, own
risk = the original V3), (b) scraping any no-API site (mostly avoided).

**Board strategy / tiers.**
- **Tier 1 — Greenhouse / Lever / Ashby:** no login, low bot-detection (they *want* applicants), single/near-
  single page. **Where unattended apply genuinely works; the volume cluster. Do Lever + Ashby next** (~½-1 day
  each — engine is shared, cost is live quirk-hunting, not new logic; the adapter JSON is ~10 lines).
- **Tier 3 — Workday / iCIMS / Taleo:** per-company account + email verification + 5-7 page wizard + custom
  widgets + per-tenant variance = a *separate project*, not "adapter #4." Good news: generic scan-fill-advance
  loop + the two EEO pages (veteran/disability/race → `localResolveField`) are ~half-free; `data-automation-id`
  gives stable selectors. Net-new = account/email-code manager, the page-loop, Workday widget helpers.
- **Skip LinkedIn/Indeed scraping** (anti-bot, ToS, legal). **Sourcing = API/JSON consumers, not HTML
  scrapers:** Greenhouse Job Board API, Lever public API, GitHub new-grad repos (SimplifyJobs/New-Grad-Positions,
  speedyapply, vanshb03, jobright-ai, ambicuity — they link straight to ATS apply URLs).

**Unit economics.** In-browser loop shifts the expensive part (running browsers) onto the *user's* machine —
COGS ≈ just AI tailoring (~$0.043/app). At volume, **cap apps/tier so AI < ~30% of the sub** (uncapped 50/day
≈ $64/mo AI > a $50 sub = underwater). ~40 users × $50 capped ~15/day ≈ $2k rev, ~$1.3k profit. **Churn is the
real constraint** (success = user gets a job = cancels), not infra.

**Captcha.** Rare on Tier 1. Paid solvers work for reCAPTCHA v2, unreliable for v3/hCaptcha/Turnstile
(behavioral score — the real wall is bot-*detection*, not the puzzle). Unsolved → needs-human queue.

**Loop mechanics.** Sequential + jitter (parallel = more bot-like, hammers the user's machine, and speed isn't
the bottleneck; cap at 2 tabs if ever). **Queue state lives server-side, never in the tab**; status
`pending → in-progress → submitted | failed | needs-human`; **checkpoint per job** (a closed tab loses at most
1 in-flight). Interrupted job: clearly-unsubmitted → re-queue; ambiguous → needs-human (avoid double-submit).
The **~10/day "needs-human" bucket is the EXCEPTION path** (captcha/broken/stale), not the normal flow.

**Mascot ("frog wizard") — virality/UX hook.** On-page **shadow-DOM Lottie overlay** that rides each job page
as it fills (the shareable moment) + a dashboard home-base frog. States (`idle/working/success/needs-you`)
driven by the autofill `report` events you already emit — a thin visual skin, not new infra. Must never
overlap/block a field or cost a submission. MVP: static working+done state → Lottie states → hop transitions.

**Monetization gate (before charging anyone).** Operator's eligibility to earn business income must be
verified with appropriate professionals *before* taking payments; plus LLC + ToS/privacy. Building + personal
use is unaffected. Market is real but crowded (Simplify, LazyApply, Sonara, JobRight…) — the tailoring angle
is the quality wedge vs spray-and-pray.

**Rough sequence:** finish Greenhouse (verify live + tests + commit) → Lever/Ashby adapters → scraper + queue
(server, safe) → in-browser autonomous loop (extension) → frog → Workday page-loop → multi-tenant SaaS layer
(auth/billing) *last*, on a proven engine.

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