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
      ai-fallback.js     ← POST /ai-resolve-field, Groq fallback for unknown fields
    services/
      groqService.js     ← Groq AI tailoring logic + resumeData (source of truth)
      pdfService.js      ← Puppeteer HTML → PDF buffer renderer
      uploadService.js   ← Supabase Storage upload → signed URL
      apiKeyAuth.js      ← Express middleware, x-api-key header check
    templates/
      resume.html        ← ATS-safe single-column HTML resume template
    server.js            ← Express setup, body parsers, route mounting
    .env                 ← PORT, GROQ_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, JOBBY_API_KEY
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
- The pipeline is always: Groq tailoring → PDF generation → Supabase upload → return signed URL
- Each step has its own service file. Routes only orchestrate — no business logic in `tailor.js`
- Activities/Leadership section is static — Groq does not tailor it, pdfService renders it directly

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
- Groq still appending "and..." keyword clauses to bullet ends — prompt needs to be harder on this
- Resume still spilling to 2 pages on some JDs — padding/font tuning ongoing

---

## Current Build Status

### V1 — Complete
- POST /tailor-resume endpoint ✅
- Groq tailoring with prompt rules ✅
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
- [x] extension/autofill.js — DOM execution layer (adapter fields + unknown scan + AI fill + react-select comboboxes)
- [x] extension/autofill.js injected on-demand via executeScript (no manifest content_script entry needed)

**Automation stubs (not started)**
- [ ] automation/autofill/index.js — V3 Playwright stub
- [ ] automation/autofill/session.js — V3 cookie management stub

### Last Session Cutoff
**Date:** 2026-05-24 (combobox fill cascade — FIXED & verified live)

**STATUS: autofill works end-to-end on live Greenhouse.** Tested on `job-boards.greenhouse.io` and a
Remote (greenhouse) job — every field filled, consent checkbox ticked (manually for now), app
submitted. Adapter text fields + resume upload + react-select dropdowns + AI/local resolution all live.

**Root cause found this session** (symptom: dropdowns filled nothing / wrong values): the *scan* read
each combobox's options correctly, but the *fill* phase read the WRONG menu for every field. Cascade:
`#country` (the intl-tel-input phone country chip) filled first and left its menu stuck open → every
later combobox failed to open → `findComboboxMenu`'s document-wide fallback returned the stuck COUNTRY
menu → each field matched against 244 country options → blank or garbage (clicked "Lebanon" as phone code).

**Fixes this session (all UNCOMMITTED working tree):**
- `autofill.js` `findComboboxMenu` — resolve menu ONLY via `aria-controls`→`getElementById`;
  **removed the document-wide fallback** (the contamination source). Worst case now = blank (safe).
- `autofill.js` — added `isComboboxOpen()`; `openCombobox` verifies its OWN menu opened (returns bool);
  `closeCombobox` now async + verifies closed (Escape/blur → click-outside fallback); `fillCombobox`
  requires opened, reads only its own menu, requires `ok===true`, always closes.
- `autofill.js` `scanUnknownFields` — **skip `#country`** (intl-tel-input chip; phone carries +1; was the cascade trigger).
- `autofill.js` `bestOptionMatch` — rewritten ladder: exact → leading-clause (comma split, so
  "No, I do not have a disability" → "No") → answer⊂option (**shortest** match, fixes "United States" →
  "...- Alabama") → option⊂answer(≥4) → token-overlap (clear winner). Forward-substring needs ≥3 chars (stops "No" ⊂ "Lebanon").
- `popup.js` `localResolveField` — guarded the `/country/` rule against work-status/eligibility labels
  (status|eligib|visa|sponsor|citizen|authoriz|permanent resident|refugee|work permit) → those route to
  AI; country answer now state-qualified `"United States of America - New Jersey"` (matches plain
  dropdowns via option⊂answer AND state-split dropdowns like Remote via exact).
- `server/data/profile.js` — fixed malformed `contact.linkedinUrl` → `https://www.linkedin.com/in/zeshan-rehan-504ab0128/`.

**Deploy/test state:**
- Extension (`autofill.js`, `popup.js`): **reload extension** only.
- Server (`profile.js` linkedin): needs `cd ~/Jobby && git pull && pm2 restart all`.
- Debug logs (`[Jobby] combobox-debug`, `fill-debug`) still in `autofill.js` — keep until checkbox work lands, then strip.

**Next up (priority order):**
1. **Checkbox fill (immediate ask)** — tick consent/agreement/acknowledge checkboxes (everything before
   Submit), stay dry-run. NOT implemented — **waiting on the consent checkbox's `outerHTML`** from the
   Remote form to know native `<input type=checkbox>` vs custom `role=checkbox`. Plan: scan + tick only
   consent-style boxes, leave marketing/ambiguous, never click submit.
2. **Dashboard groundwork (V4)** — enrich the `/apply/log` coverageReport from field-names-only to
   per-field `{ label, value, source: adapter|local|ai, status }`. This is the data foundation for the
   dashboard's per-field AUDIT table + feedback loop: user wants to review/correct non-standard fills and
   save them as profile defaults ("not every fill is exactly how I'd want it"). Proposed app record:
   `{ id, appliedAt, jobUrl, platform, company, jobTitle, resumeUrl, tailoring, fields[], counts }`.
   Analytics: coverage rate, most-blank labels, local-vs-AI hit rate, per-platform.
3. `candidate-location` async autocomplete — still reads 0 options (type-then-pick via MutationObserver). Deferred.
4. True multi-VALUE fill ("select all that apply") — single pick only. Deferred.
5. One combobox occasionally left open at run end (cosmetic, unconfirmed — close-verify should help).
6. `lever.json` / `ashby.json` adapters; `automation/` Playwright stubs (V3 hands-off submit).

**Local harness** (`.harness/`, untracked) validates react-select mechanics only — it greenlit two
passes that died on the real form. **The real-form test is the only source of truth.**

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
- Use Groq for unknown field resolution instead of keyword matching —
  more resilient to varied phrasing across job boards
- DataTransfer file upload is finicky — test on real Greenhouse page
  before considering it done
- Don't build autofill logic into the extension — keep it as a VPS service
  the extension calls so V3 reuses the same service headlessly