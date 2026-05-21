# Jobby V2 — Autofill Engine Plan

## Context

V1 delivers a tailored PDF resume on one click. V2 closes the loop: take that PDF and the user's profile data and fill the job application form automatically. The design constraint is that V2 is not a standalone feature — it's one layer of a three-layer autonomous pipeline:

- **V1:** Tailor resume → PDF → signed URL (done)
- **V2:** Extension autofills form in the user's live browser session (this plan)
- **V3:** Cron finds job → hands URL to the same pipeline → Playwright runs headlessly on VPS, no human involved

Every architecture decision must serve that end state. Don't build V2 in a way that has to be rebuilt for V3.

---

## Approach Decision: Rule-Based Adapters + AI Fallback

Three options evaluated:

| Approach | Speed | Resilience to DOM changes | Best for |
|---|---|---|---|
| Rule-based (hardcoded selectors) | Fast | Brittle | Known stable platforms |
| AI-driven (LLM identifies fields) | Slow, expensive | Resilient | Unknown/dynamic platforms |
| **Hybrid (recommended)** | Fast for known, fallback for unknown | Good | Personal tool scaling to autonomy |

**Decision: Hybrid.**
- Platforms with known stable DOM (Greenhouse, Lever, Ashby): hardcoded JSON adapters — zero LLM overhead, deterministic, fast
- Unknown platforms: send field context to Groq for field identification (same API key already in use)
- This gives V3 resilience without paying LLM cost on every run

---

## Platform Priority (V2 scope)

| Platform | Complexity | Volume | V2? |
|---|---|---|---|
| Greenhouse | Low — standard HTML form, single-page | High among startups | ✅ Build first |
| Lever | Low — nearly identical to Greenhouse | High among startups | ✅ Build second |
| Ashby | Low — simple, modern, well-structured | Medium | ✅ Build third |
| LinkedIn Easy Apply | High — multi-step SPA, anti-bot measures, dynamic questions | Very high | ⏸ Defer (architecture must accommodate) |
| Workday | Very high — enterprise, iframe nesting, session state, anti-bot | High (enterprise co's) | ❌ Skip V2 |

**Why skip LinkedIn for V2:** LinkedIn's anti-automation measures (rate limiting, bot detection, SPA navigation) make it a dedicated engineering effort. The stable trio (Greenhouse + Lever + Ashby) covers ~50-60% of tech/startup applications. Ship that first.

**Why keep LinkedIn in the architecture:** The platform adapter schema must allow LinkedIn to be added later without restructuring anything.

---

## Architecture

### The Core Principle: Separate Knowledge from Execution

The autofill logic has two layers:
1. **Knowledge layer** — which fields exist, what selectors to use, what data fills them (platform-specific, shared)
2. **Execution layer** — how to fill them (DOM manipulation for extension, Playwright API for V3)

These must be separate. The knowledge layer is reusable. The execution layer is environment-specific.

### File Structure

```
server/
  data/
    profile.js           ← NEW: standard answers for application fields (auth, salary, city, etc.)
  routes/
    profile.js           ← NEW: GET /profile endpoint — serves profileData to extension
  server.js              ← MODIFIED: mount /profile route

autofill/                ← NEW directory: shared knowledge layer
  adapters/
    greenhouse.json      ← field selectors + data map for Greenhouse
    lever.json           ← field selectors + data map for Lever
    ashby.json           ← field selectors + data map for Ashby
  schema.md              ← adapter format documentation

extension/
  autofill.js            ← NEW: DOM execution layer (loaded as content script)
  manifest.json          ← MODIFIED: declare autofill.js as injectable
  popup.js               ← MODIFIED: add autofill trigger after success
  popup.html             ← MODIFIED: add "Autofill" button + status to success state

automation/              ← V3 skeleton (stubs only in V2)
  autofill/
    index.js             ← STUB: Playwright execution layer (placeholder for V3)
    session.js           ← STUB: cookie import/export for VPS session management
```

### Adapter Schema (autofill/adapters/*.json)

```json
{
  "platform": "greenhouse",
  "detect": ["job.greenhouse.io", "boards.greenhouse.io"],
  "fields": {
    "firstName":   { "selector": "#first_name",           "type": "text",   "source": "profile.firstName" },
    "lastName":    { "selector": "#last_name",            "type": "text",   "source": "profile.lastName" },
    "email":       { "selector": "#email",                "type": "text",   "source": "contact.email" },
    "phone":       { "selector": "#phone",                "type": "text",   "source": "contact.phone" },
    "resume":      { "selector": "input[name='resume']",  "type": "file",   "source": "pdf" },
    "linkedin":    { "selector": "#linkedin_profile",     "type": "text",   "source": "contact.linkedinUrl" },
    "website":     { "selector": "#website",              "type": "text",   "source": "contact.portfolio" }
  },
  "steps": [],
  "dryRunBlockSelector": "#submit_app"
}
```

The `source` field is a dotted path into a merged data object `{ ...resumeData, ...profileData, pdf: File }`. The execution layer resolves the path, looks up the value, fills the field.

This schema is importable in both the extension (fetch as JSON) and Node.js (require).

### Data Layer (server/data/profile.js)

New file — separate from resumeData per user preference.

```js
const profileData = {
  firstName: "Zeshan",
  lastName: "Rehan",
  location: { city: "Glassboro", state: "NJ", country: "US", zip: "08028" },
  workAuthorization: {
    authorized: true,
    requiresSponsorship: false,
    answer: "Authorized to work in the US — no sponsorship required",
  },
  salary:       { preference: "Open to discussion" },
  availability: { startDate: "Immediately", noticePeriod: "2 weeks" },
  defaultAnswers: {
    // keyword → answer for free-text questions not mappable to structured fields
    "sponsorship": "No",
    "authorized":  "Yes",
    "heard about": "LinkedIn",
    "relocate":    "Yes",
  },
};
module.exports = { profileData };
```

Exposed via `GET /profile` — extension fetches once per session and caches in memory.

### Extension Autofill Flow (extension/autofill.js)

Content script injected on demand (same pattern as content.js). Called after tailoring succeeds.

```
popup.js: user clicks "Autofill"
  → fetch /profile
  → fetch adapter JSON for detected platform
  → sendMessage(tabId, { type: "RUN_AUTOFILL", adapter, profile, resumeData, downloadUrl })
  → autofill.js receives message
  → fetch PDF blob from downloadUrl
  → for each field in adapter.fields:
      resolve source path → get value → fill field
  → for resume field: DataTransfer + File + dispatchEvent
  → in dry-run mode: block submit button, don't click it
  → sendResponse({ filled: [...], skipped: [...], unknown: [...] })
popup.js: render field coverage report
```

### V3 Bridge (architecture, not V2 implementation)

The V3 pipeline is:
```
Cron (automation/scraper.js)
  → detects new job on configured board
  → POSTs { jobUrl } to /queue-application (new V3 endpoint)
  → Playwright (automation/autofill/index.js):
      1. Loads profileData + resumeData from server/data/
      2. Calls tailorResume(jobDescription) → same V1 Groq service
      3. Generates PDF → same V1 pdfService
      4. Loads adapter for detected platform
      5. Playwright fills form using adapter selectors (same JSON, different execution API)
      6. In dry-run: page.screenshot() → saves to Supabase
      7. In live mode: page.click(dryRunBlockSelector)

Session management (automation/autofill/session.js):
  - Extension exports cookies for greenhouse.io, lever.co, ashby.com
  - POSTs to POST /store-cookies { domain, cookies }
  - Playwright loads cookies from VPS storage before opening each page
  - When cookies expire (401 response), extension re-exports on next use
```

**This is the V2→V3 bridge.** V2 builds the extension side of cookie export. V3 consumes it.

---

## The Hard Problems

### 1. File Upload
- **Extension:** `DataTransfer` API — fetch PDF blob, create `File`, assign to `input.files`, dispatch `change` event. Works on standard `<input type="file">`. Custom upload UIs (Dropzone) need platform-specific click simulation.
- **Playwright:** `page.setInputFiles(selector, filePath)` — simpler. Download PDF to temp file first.
- **Risk:** Greenhouse/Lever use standard file inputs. Workday does not — irrelevant for V2.

### 2. Multi-Step Forms
- Lever and some Ashby forms are single-page. Greenhouse is mostly single-page.
- If multi-step needed: adapter `steps[]` array defines selector + next-button per step. Extension/Playwright iterates steps array.
- In dry-run mode: advance through all steps but stop before the final submit.

### 3. Custom Dropdowns and Non-Standard Inputs
- Native `<select>`: set `.value`, dispatch `change`.
- Custom dropdown (click-to-open list): requires click simulation — adapter marks field as `"type": "custom-select"` with `openSelector` + `optionSelector`.
- For V2 (Greenhouse/Lever/Ashby): native selects only. Custom dropdown handling is V3 scope.

### 4. SSO / OAuth Login Walls
- Detect: if clicking "Apply" redirects to an SSO/OAuth page, abort immediately.
- Detection signal: redirect to `accounts.google.com`, `login.microsoftonline.com`, or URL change to a non-job-board domain.
- Response: show "Login required — complete login then retry autofill" in popup.

### 5. CAPTCHAs
- Detection: look for known CAPTCHA iframe selectors (`iframe[src*='recaptcha']`, `iframe[src*='hcaptcha']`).
- V2: detect, pause, show "CAPTCHA detected — please solve, then click Resume" in popup.
- V3: use a solving service (2captcha/anticaptcha) or abandon and log the failure.

### 6. Fields Jobby Doesn't Have Data For
- Every unrecognized field gets flagged in the coverage report (`unknown: ['customQuestion1']`).
- `defaultAnswers` in profile.js handles common keyword-matching questions.
- AI fallback: for unknown fields with visible label text, send `{ label, fieldType }` to Groq → get a suggested answer → fill with `[AI-suggested]` prefix so user can review.
- Never submit without human review in V2.

---

## Testing Strategy

### Dry-Run Mode (V2 default, always on)
- `dryRunBlockSelector` in adapter: inject `pointer-events: none; opacity: 0.4` onto the submit button
- Remove the selector from the DOM event listener — button becomes visually and functionally inert
- Log a clear message in popup: "Form filled — submit button disabled (dry run)"

### Field Coverage Report
Every autofill run returns:
```js
{
  filled:   ['firstName', 'lastName', 'email', 'phone', 'resume'],
  skipped:  ['salary'],          // source had no value
  unknown:  ['q1_custom_text'],  // selector not in adapter + AI fallback not triggered
  errors:   ['linkedin: selector not found on this page version'],
}
```
Shown in popup. Logged to console for debugging.

### Integration Testing Per Platform
- Keep a list of known stable job posting URLs for Greenhouse/Lever/Ashby
- Test autofill against them before shipping
- Check: all expected fields filled, resume attached, submit button blocked

### Not Testing
- Don't try to unit test DOM selectors — they only fail in a real browser. Test integration only.
- Don't submit real applications during testing — use dedicated test job postings or personal test accounts.

---

## ROI Analysis

**What gets you 80% coverage with 20% effort:**
- Greenhouse adapter alone: ~30-40% of tech startup applications
- Greenhouse + Lever: ~50-60%
- Add Ashby: ~60-65%
- These three have simple, stable forms. An adapter is a few hours of work each.
- Total V2 effort for 3 adapters: ~2-3 days of focused work

**What's hard and worth deferring:**
- LinkedIn Easy Apply: 2-3x harder than Greenhouse, anti-bot measures, SPA navigation — worth it for V3 when Playwright handles it
- Workday: enterprise-grade complexity, iframe hell, session state — V3 only
- CAPTCHA automation: ethical/TOS issues, reliability problems — use human-in-loop for V2

**Rabbit holes to avoid:**
- Building a general-purpose form filler: over-engineered for V2. Adapters per platform are faster to build and more reliable.
- Browser fingerprint spoofing for anti-bot bypass: unnecessary for V2 (user's own browser). V3 will use Playwright stealth.
- Cover letter generation: different problem, different scope. Don't bundle with autofill.
- Resume parsing from PDF: data already lives in resumeData. No need to reverse-engineer the PDF.

---

## Build Order

1. **`server/data/profile.js`** — profileData object with all standard answers
2. **`server/routes/profile.js`** + mount in server.js — `GET /profile` endpoint
3. **`autofill/adapters/greenhouse.json`** — first adapter, establish schema
4. **`extension/autofill.js`** — DOM execution layer (handles text, select, file types)
5. **`extension/popup.html` + `popup.js`** — "Autofill" button in success state, coverage report UI
6. **Test against a real Greenhouse posting in dry-run mode**
7. **`autofill/adapters/lever.json`** — second adapter (minimal delta from Greenhouse)
8. **`autofill/adapters/ashby.json`** — third adapter
9. **`automation/autofill/index.js` (stub)** + **`automation/autofill/session.js` (stub)** — V3 skeleton
10. **Cookie export from extension** — `POST /store-cookies` endpoint + extension sends cookies for target domains

---

## Critical Files

| File | Status | Role |
|---|---|---|
| `server/data/profile.js` | Create | Standard application answers |
| `server/routes/profile.js` | Create | Serves profileData via GET /profile |
| `server/server.js` | Modify | Mount /profile route |
| `autofill/adapters/greenhouse.json` | Create | Greenhouse field map |
| `autofill/adapters/lever.json` | Create | Lever field map |
| `autofill/adapters/ashby.json` | Create | Ashby field map |
| `extension/autofill.js` | Create | DOM execution layer |
| `extension/popup.js` | Modify | Add autofill trigger, coverage report render |
| `extension/popup.html` | Modify | Add Autofill button + coverage UI to success state |
| `extension/manifest.json` | Modify | Declare autofill.js as injectable |
| `automation/autofill/index.js` | Create (stub) | V3 Playwright execution layer placeholder |
| `automation/autofill/session.js` | Create (stub) | V3 cookie management placeholder |

---

## Verification

1. Load extension in Chrome dev mode
2. Navigate to a real Greenhouse job posting (logged in)
3. Click "Tailor Resume" → wait for success screen
4. Click "Autofill"
5. Verify: all text fields filled (first name, last name, email, phone)
6. Verify: resume PDF attached to file input
7. Verify: Submit button is visually disabled and non-clickable
8. Verify: Coverage report shows correct filled/skipped/unknown breakdown
9. Repeat for Lever and Ashby
10. Check that `GET /profile` returns the expected JSON from the server
