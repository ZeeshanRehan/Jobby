# Jobby V2 — Autofill Engine Plan (Final, Milestone-Based)

> This plan is the source of truth for V2. Read fully before building.
> V2 is broken into 7 milestones. Each milestone = one Claude Code session.
> User tests between each milestone. Do NOT proceed if tests fail.

---

## Context

V1 delivers a tailored PDF resume on one click. V2 closes the loop: take that PDF and the user's profile data and fill the job application form automatically.

**V2 is one layer of a three-layer autonomous pipeline:**
- V1: Tailor resume → PDF → signed URL ✅ done
- V2: Extension autofills form in user's live browser session ← this plan
- V3: Cron finds job → hands URL to same pipeline → Playwright runs headlessly on VPS, no human

**Critical principle:** Every architecture decision must serve V3. Do not build V2 in a way that has to be rebuilt for V3.

---

## V2 Scope

**Behavior:** User browses to job posting → clicks Jobby extension → tailor + autofill happens → user reviews and clicks submit themselves.

**In scope:** Greenhouse adapter (rule-based), Groq AI fallback (text-only) for unknown fields, profile data caching, application logging, idempotency, dry run mode, coverage reports.

**Out of scope:** Autonomous submission (V3), cron-based job discovery (V3), session management on VPS (V3), CAPTCHA solving, vision-based AI inference, Lever/Ashby adapters, cover letter generation, multi-user support.

---

## Architecture Decision

### Separate knowledge from execution

Autofill logic has two layers:
1. **Knowledge layer** — adapters, profileData, AI fallback rules (shared across V2/V3)
2. **Execution layer** — DOM manipulation (V2) vs Playwright API (V3)

These MUST be separate. Knowledge is reusable. Execution is environment-specific.

### AI-primary with rule-based fast path

- **Tier 1 (fast path):** Greenhouse rule-based adapter — covers stable platforms, $0 inference cost
- **Tier 2 (AI inference):** Everything else — Groq for field identification in V2, swaps to Claude vision in V3
- **Tier 3 (manual prompt):** Field AI can't confidently answer → ask user in popup, save for next time

### Caching strategy

| Data | Storage | Refresh |
|---|---|---|
| profileData | chrome.storage.local | Version check on popup open |
| Adapters list | chrome.storage.local | Version check on popup open |
| applied_urls | chrome.storage.local | After each successful autofill |
| Last 5 tailored PDFs | chrome.storage.local | LRU |
| Current scraped JD | Extension memory | Per-session |

---

## File Structure

```
server/
  data/
    profile.js
    applications.json
    applied_urls.json
    adapters/
      greenhouse.json
    resumes/                ← permanent PDF storage on VPS
  routes/
    profile.js
    adapters.js
    apply.js
    ai-fallback.js
  services/
    applicationLogger.js
    idempotencyService.js
    permanentStorage.js
    apiKeyAuth.js
  server.js                 ← MODIFIED

extension/
  cache/
    profile.js
    adapters.js
    history.js
  autofill.js
  popup.html                ← MODIFIED
  popup.js                  ← MODIFIED
  manifest.json             ← MODIFIED

automation/                 ← V3 skeleton, stubs only
  autofill/
    index.js
    session.js

test-postings.md
```

---

## Data Schemas

### profileData (server/data/profile.js)

```javascript
const profileData = {
  identity: {
    firstName: "Zeshan",
    lastName: "Rehan",
    middleName: "",
    preferredName: "",
    pronouns: "he/him",
  },
  contact: {
    email: "zeeshanrehan12345@gmail.com",
    phone: "+1-856-526-2323",
    linkedinUrl: "https://linkedin.com/in/Zeshan Rehan",
    githubUrl: "https://github.com/ZeeshanRehan",
    portfolioUrl: "https://imzeshan.com",
    address: {
      street: "",
      city: "Glassboro",
      state: "NJ",
      zip: "08028",
      country: "US",
    },
  },
  workAuthorization: {
    citizenStatus: "us_citizen",
    requiresSponsorshipNow: false,
    requiresSponsorshipFuture: false,
  },
  education: [{
    school: "Rowan University",
    degree: "Bachelor's",
    major: "Computer Science",
    minor: "",
    gpa: "",
    startDate: "Sept 2022",
    endDate: "May 2026",
    expectedGraduation: "May 2026",
    location: "Glassboro, NJ",
  }],
  demographics: {
    gender: "decline_to_answer",
    race: "decline_to_answer",
    ethnicity: "decline_to_answer",
    veteranStatus: "decline_to_answer",
    disabilityStatus: "decline_to_answer",
  },
  preferences: {
    salaryExpectation: "Open to discussion",
    availableStartDate: "Immediately",
    willingToRelocate: true,
    willingToTravel: true,
    remotePreference: "flexible",
  },
  voluntaryDisclosure: {
    howDidYouHear: "LinkedIn",
    referrerName: "",
    previousEmployee: false,
  },
  defaultAnswers: {},
};

module.exports = { profileData };
```

**Rules:**
- Demographics default `decline_to_answer` — never auto-fill without consent
- Salary, references, demographics: ONLY profileData, never AI-generated
- `defaultAnswers` populated over time as user answers unknown questions

### applications.json structure

```javascript
[
  {
    applicationId: "uuid-v4",
    timestamp: "ISO timestamp",
    jobUrl: "normalized URL",
    jobTitle: "scraped from page",
    company: "scraped from page",
    platform: "greenhouse",
    status: "filled_dry_run",
    mode: "dry_run",
    resumeUrl: "Supabase signed URL",
    resumeLocalPath: "/root/Jobby/server/data/resumes/uuid.pdf",
    changesMade: { /* full Groq object */ },
    keywordsInjected: [],
    coverageReport: {
      filled: [], skipped: [], unknown: [], stale: [], errors: []
    },
  }
]
```

### applied_urls.json

Normalized URL → timestamp map. Normalization: lowercase, no query params, no trailing slash.

### Adapter schema (server/data/adapters/greenhouse.json)

```json
{
  "platform": "greenhouse",
  "version": "2026-05-22-001",
  "detect": ["boards.greenhouse.io", "job.greenhouse.io"],
  "fields": {
    "firstName": { "selector": "#first_name", "type": "text", "source": "identity.firstName" },
    "lastName":  { "selector": "#last_name",  "type": "text", "source": "identity.lastName" },
    "email":     { "selector": "#email",      "type": "text", "source": "contact.email" },
    "phone":     { "selector": "#phone",      "type": "text", "source": "contact.phone" },
    "resume":    { "selector": "input[name='resume']", "type": "file", "uploadStrategy": "native", "source": "pdf" },
    "linkedin":  { "selector": "input[name*='linkedin'], input[id*='linkedin']", "type": "text", "source": "contact.linkedinUrl" },
    "website":   { "selector": "input[name*='website'], input[id*='website']", "type": "text", "source": "contact.portfolioUrl" }
  },
  "dryRunBlockSelector": "input[type='submit'], button[type='submit']",
  "steps": []
}
```

---

## API Endpoints

All require `x-api-key` header matching `JOBBY_API_KEY` in `.env`.

| Endpoint | Purpose |
|---|---|
| `GET /profile` | Returns full profileData |
| `GET /profile/version` | Timestamp for cache invalidation |
| `GET /adapters/list` | All platform detect patterns + versions |
| `GET /adapter/:platform` | Full adapter JSON |
| `POST /ai-resolve-field` | Groq resolution for unknown field |
| `POST /apply` | Orchestrates tailor + PDF + adapter prep |
| `POST /apply/log` | Finalizes application after autofill |
| `POST /profile/answer` | Saves user-provided answer to defaultAnswers |

### POST /ai-resolve-field

- **Request:** `{ label, fieldType, contextHtml, options? }`
- **Response:** `{ answer, confidence: "high"|"medium"|"low", reasoning }`
- **Rules:** Never answers demographics/salary/references — returns `low` confidence with reason "sensitive field, ask user"

### POST /apply

- **Request:** `{ jobUrl, jobDescription, mode }`
- **Logic:**
  1. Idempotency check — if URL applied to already, return `{ alreadyApplied: true, existingRecord }`
  2. Tailor resume via V1 service
  3. Generate PDF via V1 service
  4. Upload to Supabase + save permanent copy to `server/data/resumes/`
  5. Detect platform from URL
  6. Load adapter
  7. Create application record (status: "tailored")
  8. Return `{ applicationId, resumeUrl, resumeLocalPath, adapter, profileData, applicationRecord }`

### POST /apply/log

- **Request:** `{ applicationId, status, coverageReport, errors }`
- **Logic:** Updates application record + adds URL to applied_urls.json

---

## Non-Negotiables

1. **Follow CLAUDE.md conventions exactly**
2. **Dry run always on in V2** — no submit ever clickable from autofill
3. **Demographics, salary, references never AI-resolved** — profileData only
4. **All endpoints require x-api-key**
5. **CORS allows chrome-extension://**
6. **All data writes go through services** — never direct file writes from routes
7. **Coverage report mandatory** — every autofill returns one, even on failure
8. **Idempotency check before tailoring** — saves Groq tokens
9. **profileData schema authoritative** — adapters reference by path, never invent shapes
10. **Pause and report after each milestone** — user must test before next starts

---

# MILESTONES

Each milestone = one Claude Code session. User tests after each. Do not skip ahead.

---

## Milestone 1 — Data Layer + Server Endpoints

**Goal:** All VPS-side infrastructure for V2. No extension changes yet.

### Build steps

1. `server/data/profile.js` with full schema above
2. `server/data/applications.json` as empty array `[]`
3. `server/data/applied_urls.json` as empty object `{}`
4. `server/data/adapters/greenhouse.json` with schema above
5. `server/data/resumes/` directory (empty)
6. `server/services/applicationLogger.js` — append/read applications.json
7. `server/services/idempotencyService.js` — normalize URL, check/add to applied_urls.json
8. `server/services/permanentStorage.js` — save PDF buffer to `server/data/resumes/{uuid}.pdf`
9. `server/services/apiKeyAuth.js` — Express middleware checking x-api-key header
10. `server/routes/profile.js` — GET /profile, GET /profile/version
11. `server/routes/adapters.js` — GET /adapters/list, GET /adapter/:platform
12. `server/routes/ai-fallback.js` — POST /ai-resolve-field
13. `server/routes/apply.js` — POST /apply, POST /apply/log
14. Modify `server/server.js`: mount routes, CORS for chrome-extension://*, apply auth middleware
15. Generate `JOBBY_API_KEY` via `openssl rand -hex 32`, add to `.env`
16. `git add . && git commit -m "M1: data layer and server endpoints"`
17. `pm2 restart all`

**Pause and report:** What was built, list of tests for user.

### USER TESTING — Milestone 1

All tests via Thunder Client. Each MUST pass before Milestone 2.

#### Test 1.1 — Auth rejection
- `GET http://178.105.161.45:3000/profile` with NO x-api-key header
- Expected: 401 Unauthorized
- **If fails:** auth middleware not wired

#### Test 1.2 — Get profile
- `GET /profile` with `x-api-key: <your key>`
- Expected: 200 with `{ version, data: { identity, contact, ... } }`
- Verify: all schema fields present, demographics default `decline_to_answer`

#### Test 1.3 — Get version
- `GET /profile/version` with x-api-key
- Expected: 200 with `{ version: "timestamp" }`

#### Test 1.4 — Adapters list
- `GET /adapters/list` with x-api-key
- Expected: 200 with array containing greenhouse entry, detect array, version

#### Test 1.5 — Greenhouse adapter
- `GET /adapter/greenhouse` with x-api-key
- Expected: 200 with full adapter, all 7 fields

#### Test 1.6 — AI field resolution
- `POST /ai-resolve-field` body:
  ```json
  { "label": "Are you willing to relocate?", "fieldType": "radio", "options": ["Yes", "No"] }
  ```
- Expected: 200 with `{ answer: "Yes", confidence: "high", reasoning }`

#### Test 1.7 — AI sensitive field protection
- `POST /ai-resolve-field` body:
  ```json
  { "label": "What is your race?", "fieldType": "select" }
  ```
- Expected: `{ confidence: "low", reasoning: "sensitive field, ask user" }`
- **If fails:** sensitive field guardrails broken — CRITICAL

#### Test 1.8 — Apply orchestration
- `POST /apply` body:
  ```json
  {
    "jobUrl": "https://boards.greenhouse.io/test/jobs/123",
    "jobDescription": "Looking for a Java engineer with Kubernetes...",
    "mode": "dry_run"
  }
  ```
- Expected: 200 with applicationId, resumeUrl, resumeLocalPath, adapter, profileData, applicationRecord
- Verify: PDF exists at resumeLocalPath, applications.json has new entry

#### Test 1.9 — Idempotency
- Repeat Test 1.8 with same URL
- Expected: `{ alreadyApplied: true, existingRecord }`
- Verify: applied_urls.json contains normalized URL

#### Test 1.10 — Apply log
- `POST /apply/log` with applicationId from 1.8:
  ```json
  {
    "applicationId": "<uuid>",
    "status": "filled_dry_run",
    "coverageReport": { "filled": ["firstName"], "skipped": [], "unknown": [], "stale": [], "errors": [] },
    "errors": []
  }
  ```
- Expected: 200 success, applications.json record updated

**Stop if any test fails. Fix before Milestone 2.**

---

## Milestone 2 — Extension Cache Layer

**Goal:** Extension fetches and caches profile + adapters locally with version checks.

### Build steps

1. `extension/cache/profile.js`:
   - `getProfile()` — reads chrome.storage.local
   - `refreshProfile()` — calls VPS, writes to cache
   - `checkVersion()` — version check + conditional refetch
2. `extension/cache/adapters.js`:
   - Same pattern for adapters
   - `findAdapterForUrl(url)` — matches URL against detect patterns
3. `extension/cache/history.js`:
   - `isUrlApplied(url)` / `markUrlApplied(url, timestamp)`
   - `savePdfReference(applicationId, url)` LRU of last 5
4. Modify `extension/manifest.json`: add `"storage"` permission, hardcode JOBBY_API_KEY constant
5. Modify `extension/popup.js`:
   - On open, load profile + adapters from cache
   - Fire version checks in background
   - Show detected platform
6. `git add . && git commit -m "M2: extension cache layer"`

**Pause and report.**

### USER TESTING — Milestone 2

#### Test 2.1 — First load fetches from VPS
- Open Chrome dev tools → Application → chrome.storage.local
- Clear storage
- Click extension icon
- Verify: profile and adapters appear in storage with version timestamps

#### Test 2.2 — Cache hit on second load
- Close popup, open Network tab
- Click extension icon
- Verify: only `/profile/version` and `/adapters/list` version calls fire — NOT full data

#### Test 2.3 — Version invalidation
- On VPS, edit `server/data/profile.js` (change pronouns to "she/her" for test)
- Restart pm2 (version timestamp updates)
- Open popup
- Verify: full profile re-fetched, cache updated
- Reset profile change

#### Test 2.4 — Platform detection
- Navigate to a Greenhouse job posting
- Open popup → verify shows "greenhouse"
- Navigate to google.com → open popup → verify "platform not supported"

#### Test 2.5 — Already-applied warning UI
- Manually add a test URL to `applied_urls.json` on VPS
- Refresh extension cache
- Navigate to that URL
- Open popup → verify "Already applied" warning shown

**Stop if any fails.**

---

## Milestone 3 — Autofill Execution (Rule-Based Only)

**Goal:** Autofill fills standard text fields on Greenhouse via adapter selectors. NO AI, NO file upload yet.

### Build steps

1. Create `extension/autofill.js`:
   - `resolveSourcePath(source, profileData, extras)` — resolves "identity.firstName"
   - `fillTextField(element, value)` — input/textarea with proper events
   - `fillSelect(element, value)` — native select
   - `fillRadio(element, value)` / `fillCheckbox(element, value)`
   - `executeFieldFill(field, profileData, extras)` — dispatches by type
   - `runAutofill(adapter, profileData, extras)` — main entry, iterates adapter.fields, builds coverage report
   - Stale detection: 0 elements = add to stale array
2. Modify `extension/popup.js`:
   - Add "Autofill" button to success state
   - On click, fetch profile + adapter from cache
   - Send message to autofill.js with `{ adapter, profileData, extras: { pdf: null } }`
   - Receive coverage report, display
3. Modify `extension/popup.html`:
   - Autofill button matching existing design
   - Coverage report container (collapsible sections)
4. Modify `extension/manifest.json`: declare autofill.js as content script
5. `git add . && git commit -m "M3: rule-based autofill"`

**Skip:** file upload, AI fallback, dry run blocker, user prompts.

**Pause and report.**

### USER TESTING — Milestone 3

Use a real Greenhouse posting (e.g., boards.greenhouse.io/anthropic).

#### Test 3.1 — Tailor still works
- Click "Tailor Resume" first
- Verify PDF downloads, success state shows changesMade
- **If fails:** V1 regressed — CRITICAL

#### Test 3.2 — Autofill button appears
- After tailor success, verify Autofill button visible + enabled

#### Test 3.3 — Standard text fields fill
- Click Autofill
- On Greenhouse page verify:
  - First name shows "Zeshan"
  - Last name shows "Rehan"
  - Email shows your email
  - Phone shows your phone
  - LinkedIn URL fills (if field exists)

#### Test 3.4 — Coverage report displays
- Popup shows coverage report with:
  - "Filled" section listing successful fields
  - "Skipped" for fields with no source value
  - "Stale" section empty if selectors match

#### Test 3.5 — Stale detection
- On VPS, edit adapter to use `#nonexistent_field` for firstName
- Refresh extension cache
- Run autofill
- Verify firstName appears in "Stale" section
- Reset adapter

#### Test 3.6 — Second Greenhouse posting
- Navigate to different Greenhouse posting
- Run full flow
- Verify same fields fill correctly

**Stop if any fails.**

---

## Milestone 4 — File Upload + Dry Run Blocker

**Goal:** Resume PDF attaches. Submit button disabled.

### Build steps

1. In `extension/autofill.js`:
   - `fillFileNative(element, pdfBlob, filename)` — DataTransfer + File + change event
   - executeFieldFill now dispatches `file` type to fillFileNative
   - `applyDryRunBlock(adapter)` — finds dryRunBlockSelector, applies pointer-events:none + opacity:0.4, removes click handlers
2. In `extension/popup.js`:
   - Before RUN_AUTOFILL message, fetch PDF blob from resumeUrl
   - Pass to autofill.js in extras: `{ pdf: blob, pdfFilename: "resume_tailored.pdf" }`
   - After autofill, show "Submit disabled (dry run) — click 'Allow submit' to enable"
   - Add "Allow submit" button that messages autofill.js to remove block
3. `git add . && git commit -m "M4: file upload and dry run blocker"`

**Pause and report.**

### USER TESTING — Milestone 4

#### Test 4.1 — Resume attaches
- Run full flow on Greenhouse posting
- After Autofill, verify resume filename appears next to upload field

#### Test 4.2 — Coverage report includes resume
- Verify "resume" in "Filled" section of coverage report

#### Test 4.3 — Submit button disabled
- Look at Greenhouse submit button — verify grayed/faded
- Try clicking — verify nothing happens, form does NOT submit
- **If fails:** CRITICAL, do not proceed

#### Test 4.4 — Allow submit
- Click "Allow submit" in popup
- Verify button returns to normal, clickable
- DO NOT actually submit — just verify clickable

#### Test 4.5 — Inspect attached file
- Right-click resume field → inspect
- Verify `files` property on input has the PDF

**Stop if any fails.**

---

## Milestone 5 — AI Fallback + User Prompts

**Goal:** Unknown fields hit Groq. Low-confidence prompts user. Answers saved.

### Build steps

1. In `extension/autofill.js`:
   - After processing adapter.fields, scan page for additional form fields not in adapter
   - For each unknown:
     - Extract label (label[for], aria-label, placeholder, preceding text)
     - Extract field type, options
     - Extract nearby context (parent text)
     - POST to /ai-resolve-field via popup.js relay
     - If `confidence === "high"`: fill (with [AI] prefix for text fields, plain for radios/selects)
     - If `confidence !== "high"`: add to needsUserInput, don't fill
2. In `extension/popup.js`:
   - Render needsUserInput as inline question UI
   - User types → Save button
   - On save: fill field on page, POST to `/profile/answer`
3. In `server/routes/profile.js`:
   - Add POST `/profile/answer` — accepts `{ keyword, answer }`, appends to defaultAnswers
   - NOTE: This is the only profile mutation in V2. Full editing is V4.
4. `git add . && git commit -m "M5: AI fallback and user prompts"`

**Pause and report.**

### USER TESTING — Milestone 5

#### Test 5.1 — AI resolves general questions
- Find Greenhouse posting with custom questions
- Run autofill
- Verify auth-style question gets AI-resolved (high confidence)
- Verify open-ended question goes to needsUserInput

#### Test 5.2 — Sensitive fields NOT AI-answered
- Find demographics field (gender select, race select)
- Run autofill
- Verify appears in needsUserInput, NOT auto-filled
- **If fails:** CRITICAL

#### Test 5.3 — User prompt + save
- Type answer to question in needsUserInput
- Click Save
- Verify field on page fills with answer
- Verify answer saved to defaultAnswers (check chrome.storage or VPS)

#### Test 5.4 — Saved answer reused
- Find another posting with same question
- Run autofill
- Verify question now AI-resolves from saved defaultAnswer

**Stop if any fails.**

---

## Milestone 6 — End-to-End Integration

**Goal:** Full flow works on 3+ real Greenhouse postings without issues.

### Build steps

1. Create `test-postings.md` in repo root with 3-5 verified Greenhouse URLs (user provides)
2. No code changes unless bugs surface — hardening only
3. `git add . && git commit -m "M6: integration test notes"`

### USER TESTING — Milestone 6

Run full flow on at least 3 different Greenhouse postings.

#### Test 6.1 — Happy path posting #1
- Tailor → Autofill → review → coverage report
- Note: fields filled, AI-resolved, user prompts, errors

#### Test 6.2 — Happy path posting #2 (different company)
- Same as 6.1
- Note: DOM variance, stale selectors

#### Test 6.3 — Happy path posting #3 (different role)
- Same as 6.1

#### Test 6.4 — Idempotency in real flow
- Try Tailor on a URL already applied
- Verify warning shown, override available

#### Test 6.5 — Network failure handling
- Disable network briefly during tailor/autofill
- Verify clear error message, no silent fail

#### Test 6.6 — applications.json populated
- Inspect `server/data/applications.json` on VPS
- Verify every test has complete record with all fields

Fix any issues before Milestone 7.

---

## Milestone 7 — V3 Stubs + Documentation

**Goal:** V3 skeleton in place. CLAUDE.md updated. V2 complete.

### Build steps

1. Create `automation/autofill/index.js`:
   - Module skeleton with TODO comments
   - Function signature `executeAutofillHeadless(adapter, profileData, pdfPath, jobUrl)` — empty body
   - Comment: "V3 will use Playwright. Field filling logic mirrors extension/autofill.js but uses page.fill() etc."
2. Create `automation/autofill/session.js`:
   - Module skeleton
   - Function signatures: `exportCookies(domain)`, `importCookies(domain)`, `isSessionValid(domain)`
   - TODO placeholders
3. Update `CLAUDE.md`:
   - Mark V2 checklist as ✅ complete
   - Add "V2 Lessons Learned" section: weird DOM quirks, selectors that broke, file upload edge cases hit
   - Add V3 next steps under "Future Modules"
4. `git add . && git commit -m "M7: V3 stubs, V2 complete"`
5. `pm2 restart all`

### USER TESTING — Milestone 7

#### Test 7.1 — V3 stubs exist
- Verify `automation/autofill/index.js` and `session.js` exist
- Verify syntactically valid (require in node repl)

#### Test 7.2 — CLAUDE.md current
- Read CLAUDE.md
- Verify V2 checklist updated
- Verify lessons learned reflects real bugs found

#### Test 7.3 — Final regression
- Run full Milestone 6 happy path one more time
- Verify nothing broke during M7 changes

---

## Definition of Done

V2 complete when:
- ✅ All 7 milestones passed user testing
- ✅ test-postings.md exists with 3+ verified URLs
- ✅ applications.json has real records from tests
- ✅ V3 stubs in place
- ✅ CLAUDE.md updated with V2 lessons

V2 NOT done if:
- ❌ Anything auto-submits
- ❌ Lever or Ashby adapters present (V3)
- ❌ Vision-based AI present (V3)
- ❌ Cron logic anywhere (V3)
- ❌ Any milestone test was skipped or failed

---

## Required Infrastructure

Already have:
- ✅ Groq API key
- ✅ VPS with 40-80GB storage
- ✅ Supabase + bucket
- ✅ PM2 + GitHub deploy

Need to generate:
- ⚠️ `JOBBY_API_KEY` — `openssl rand -hex 32`, add to `.env`

Nothing else needed for V2. Everything is code.

---

## V3 Infrastructure (Plant Seed, Not Needed Yet)

When V3 begins:
- Anthropic API key (vision/computer-use)
- Optional: 2captcha account
- Dedicated automation accounts (LinkedIn, etc.)
- Optional: residential proxy if anti-bot becomes issue
- SSL cert + subdomain for VPS (do before V3 for clean architecture)