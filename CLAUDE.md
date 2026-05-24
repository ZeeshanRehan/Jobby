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
**Date:** 2026-05-24

**Done this session (M3 + AI fallback + Claude migration + combobox support):**
1. **M3 autofill** — `autofill.js` DOM layer (adapter fill + unknown scan + AI fill), `popup.js` orchestration, `popup.html` autofill state. Resume DataTransfer upload confirmed working on real Greenhouse (`#resume` selector, not `input[name='resume']`).
2. **AI fallback** — unknown fields scanned, resolved via `POST /ai-resolve-field`, batched 3-at-a-time. `fillSelect` got exact→substring fuzzy matching (min 4 chars on reverse-includes to stop "no" ⊂ "not…").
3. **Local pre-resolver** — `localResolveField()` in `popup.js` answers ~75% of fields (demographics, yes/no, salary, location, acks, country) with ZERO API calls. This is what fixed the **429 TPM** errors — only genuinely open-ended questions now hit Claude.
4. **profile.js expansion** — real demographics (Male, South Asian/Indian, not veteran, no disability), 90+ entry `defaultAnswers` bank, and `bio` + `projects` sections (PPST, Jobby, Are You Hungry) for open-ended "tell me about yourself / why this company / proudest work" questions. `ai-fallback.js` prompt routes these to bio/projects; job description passed as `contextHtml` so "why this company" is company-specific.
5. **Claude migration** — both `groqService.js` (tailoring) and `ai-fallback.js` (field resolution) swapped Groq llama-3.3 → `claude-haiku-4-5-20251001` via `@anthropic-ai/sdk`. ~$0.043/app, ~$9-13 for 200-300 apps.
6. **react-select combobox support (the big one)** — Greenhouse questions are react-select; options only mount when open. Verified via DevTools: `mousedown`+`mouseup` on the `input.select__input[role=combobox]` opens the menu, `mousedown`+`mouseup`+`click` on a `.select__option` selects it. `scanUnknownFields` is now async — opens each combobox to read real option strings for the resolver; `fillCombobox` opens→matches→clicks. Hardened with try/catch.

**⚠️ DEPLOY STATE — do this before next test:**
- **VPS not yet redeployed this session.** Server changes (Claude migration, profile bank) need: `cd ~/Jobby && git pull && cd server && npm install && cd .. && pm2 restart all`
- **`ANTHROPIC_API_KEY` must be added to `server/.env`** (get from console.anthropic.com) — Claude calls 401 without it.
- Extension changes (autofill.js, popup.js) are local — **reload extension** in chrome://extensions.

**What's missing / next up:**
1. **Test combobox support on a fresh-loaded Greenhouse form** (fresh load matters — react-select state contaminates across runs). Watch page DevTools for `[Jobby] unknown field — ... (combobox) options=N` and `AI filled` vs `AI fill no-match`. Watch for a 429 from any oversized option list.
2. **Unresolved: "same error still occurs"** — user reported an error even with form filled, but never specified WHICH (429? no-match? submit error?). Get the exact error line next session before debugging.
3. **Location autocomplete** (`candidate-location`) — async, loads options only after typing. Currently scans as combobox with 0 options → stays unfilled. Needs a type-then-pick path (MutationObserver, not setTimeout).
4. **Multi-select** (`question_…[]`) — `fillCombobox` only picks one option.
5. **Reliability upgrade option** — Simplify drives react-select via **React fiber/props** (trusted-event-free, no flicker). More robust than our synthetic mousedown→click. Consider if synthetic approach proves flaky on real forms.
6. `server/data/adapters/lever.json` and `ashby.json` — still not written.
7. `automation/` Playwright stubs — V3, low priority. NOTE: user is interested in Playwright (trusted events make comboboxes/uploads "just work") — that's the V3 path for fully hands-off fill+submit.

**Known risks:** combobox scan visibly flickers menus open/closed (cosmetic). Synthetic-event combobox fill is validated but unproven across many ATS variants. `candidate-location` + multi-selects won't fill yet.

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