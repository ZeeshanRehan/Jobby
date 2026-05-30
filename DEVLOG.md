# Jobby — Dev Log

Append-only post-mortem record. One entry per bug / debugging saga. This is **not** a changelog
(git has the diffs) and **not** the status snapshot (`CLAUDE.md` → "Last Session Cutoff" is). This is
the *why*: the symptom we saw, the root cause we eventually found, the dead ends along the way, the fix,
and how we verified it. New entries go at the **top**. Never edit old entries — append a follow-up instead.

Entry tags: `FIXED` · `FIXED (unverified live)` · `WORKAROUND` · `OPEN` · `WONTFIX` · `DECISION`

---

## 2026-05-30 — Workday login wall burned jobs as crashes + skipped to next on re-run  ·  FIXED (unverified live)

**Symptom (user).** Drain auto-opens, tailors, opens the apply tab; the moment the "Sign in with Google" wall appears it closes the tab, returns to the controller, and re-running grabs a *different* job — "like it thinks it already applied."

**What the log actually showed.** All nvidia/Workday. Last two runs died at `fill_form` with `A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received` — **not** the clean `needs_login`. Timing: `open_tab 22:32:48 → fill_form ERR 22:32:51` (~3s).

**Root cause (two-layer).**
1. **Wall invisible as a crash.** The whole multi-page wizard runs inside one in-flight `sendMessage` to the content script. "Apply Manually" triggers a **full-page nav to the sign-in wall**, which **tears down the content script** before the wizard's `loginAnchor` check (autofill.js:738/830) can run → the reply never comes → drain gets the generic "message channel closed" error → caught at the step-5 catch → marked `error` → **unconditionally `closeTab`**. The `needs_login` path existed but could never fire on a real nav.
2. **Job silently burned, not "applied."** `/queue/next` only returns `status === "pending"` (queue.js:27). The walled job was marked `error` → no longer pending → next claim returns the *next* job. User read "skips to a new job" as "thinks it applied"; really the job was consumed.

**Dead end avoided.** Didn't design off the verbal "sign in with Google" — read the log first (advisor steer). It disambiguated Workday-nav-teardown from a non-Workday submit failure; the fixes differ.

**Fix (hybrid — chosen over in-place loop-suspend/resume for ~3× less code, no state machine).**
- **Detect the wall even when the script dies:** new `isLoginWall(tabId, adapter)` in drain.js — `chrome.tabs.get().url` vs `LOGIN_URL_RE`, plus a fresh `executeScript` probe of the adapter's `loginAnchor` (re-injects into the post-nav page). URL is the reliable layer; the anchor is best-effort (can race the ~3s paint).
- **Don't burn, don't close:** `bailNeedsLogin()` marks the job `needs_login` (re-claimable, not `error`), focuses the tab so the user can sign in, and stops the loop. Wired into both the step-5 catch (nav-teardown path) and the Workday `resp.reason === "needs_login"` branch (anchor-present path).
- **Re-arm after one login:** `POST /queue/reactivate` (queue.js route) flips `needs_login → pending`, scoped to an optional `ats`. New "Reactivate login-blocked" button in drain.html. Session persists in the Chrome profile, so one sign-in per tenant unblocks all that tenant's jobs.

**Why hybrid not in-place resume:** Workday's session persists profile-wide, so login is a one-time event the drain needn't orchestrate. Cost vs option 1 = one extra click (Start again) instead of an in-place Resume; saves loop-suspension + deferred-promise + re-inject-mid-flight machinery and its edge cases.

**UNVERIFIED — the linchpin to check live:** does `isLoginWall` actually fire on NVIDIA's wall? `LOGIN_URL_RE` is a guess (can't see the real sign-in URL from the VPS); the anchor probe may run before the wall paints. **Discriminating check next run:** capture the wall tab's URL — confirm it matches `LOGIN_URL_RE` *or* `signInLink`/`accountLink` is present. If it misses, fallback (don't build yet): `job.ats === "workday"` + channel-closed *after* the Apply step has no other plausible cause → classify `needs_login` without the URL guess. **Expectation-setting:** detection working only gets *past* the wall — the very next run then advances to `my_information` and aborts `page_not_implemented:my_experience` (marked `error`). That error is the **next milestone, not a regression.** Minor: the parked wall tab is left open (orphan clutter; cookies are profile-wide so it's harmless).

Files: `extension/drain.js`, `extension/drain.html`, `server/routes/queue.js`. Not yet committed.

**Follow-up (same day) — detection missed live; URL race confirmed, fallback added.** Shipped as `aa23263`, deployed, re-run on nvidia → still marked `error` with the channel-closed message. `isLoginWall` returned **false**. User supplied the two real URLs: the wall flow is `…/apply/applyManually` → `wd5-identity.myworkday.com/wday/authgwy/upc/oidc/…` → `accounts.google.com/v3/signin/…`. The catch fires ~2s after `open_tab`, while the tab is **still on `/apply/applyManually`** (URL #1) — which matches none of the regex tokens, and the Workday `signInLink`/`accountLink` anchor isn't on that transitional page. The OAuth bounce to Google (URL #2, which *would* match) lands *after* we've already read URL #1. Unwinnable URL/anchor race against the redirect chain. **Fix:** added a third detection layer — on a `loginRequired` adapter, a script-**teardown** error (`message channel closed` / timeout / context-invalidated) **is itself the signal**: the only thing that full-navs away mid-wizard on an unauthed tenant is the SSO wall. Also widened `LOGIN_URL_RE` (`oidc|oauth|authgwy`, `accounts.google.`, `wd5-identity`, `/wday/authgwy`) for the case the redirect *has* landed. False-positive cost = job parked `needs_login` (reactivatable), not burned — acceptable. Safe because in-application Workday transitions are SPA (prior sessions reached the method menu in-context); only the cross-origin SSO nav tears the script down. Verified offline: URL#1→false (caught by fallback), URL#2→true, teardown-err→true. Live re-test pending. (`extension/drain.js`)

---

## 2026-05-30 — Workday 4th-ATS: crash-loop + 3 wizard bugs (apply-preamble, iter-0 race, menu loop)  ·  FIXED (Workday unverified live past my_information)

Adding Workday as 4th ATS. Picked up a half-built scaffold (workdayBoard.js, workday.json, FILL_FORM_WORKDAY handler). Four distinct bugs, each surfaced by a separate live drain run.

**Bug 0 — the whole API was down (not Workday-specific).** User reported "failed to fetch". `pm2 list` → `jobby-api` **errored, 171 restarts** = crash-loop. Root: the new `jd.js` route `router.get("/workday/:tenant/:wd/:site/*", ...)`. Express 5 uses path-to-regexp v8, which **rejects the bare `*` wildcard** at module load: `PathError: Missing parameter name at index 28`. The throw happened at `require` time → server never booted → **every ATS down, not just Workday.** Fix: named wildcard `*splat`, and `req.params[0]` → `req.params.splat` (which is an **array** of segments — verified with a one-off `match()` call before editing). Dead end avoided: did NOT guess the param shape; tested it. Same commit also fixed a **double `/job`** in the workday JD URL (route prepended `/job` but `externalPath` already starts `/job/...` → Workday API returned **406**; confirmed by curling both URL shapes from the VPS, 406 vs 200). (`b404b40`)

**Bug 1 — `mount_timeout`, take 1: apply_url is the posting page, not the form.** Drain reached `fill_form` then halted `mount_timeout` (no adapter page anchor matched). Asked the user what the tab showed → **job posting page with an "Apply" button**, not the application form. Workday's real flow is `posting → Apply → method menu (Apply Manually / Autofill with Resume / Use My Last App) → sign-in wall → my_information`. v1 assumed the tab lands directly on `my_information`. Fix: added two no-field click-through pages (`posting` clicks `adventureButton`, `start_application` clicks `applyManually`) before `my_information`, and moved the login-wall check into the loop's `!page` branch so the sign-in wall after Apply-Manually reports `needs_login` instead of `mount_timeout`. Chose Apply Manually over Autofill-with-Resume on purpose — the resume auto-parse fights our fill-from-profile model. (`86197db`)

**Bug 2 — `mount_timeout`, take 2: iter-0 didn't poll.** Posting page now in the adapter, but still `mount_timeout`. The user had pasted DOM proving `adventureButton` exists → not a selector bug → timing. The wizard loop used `iter === 0 ? detectPage() : await waitForAnyPage()` — **iter 0 checked instantly, no poll.** The first page is the heaviest (full nav to apply_url); Workday's SPA paints the Apply button ~2-3s in, past the drain's 1500ms pre-wait. Both the initial check and the 1500ms-retry check missed. Fix: iter 0 also uses `waitForAnyPage()` (15s poll; returns instantly when already mounted, so later iters pay nothing). `AUTOFILL_TIMEOUT_MS=60s` > 15s, safe. (`e01e4a0`)

**Bug 3 — `max_pages_exceeded`: the menu re-opened forever.** Poll fix worked — Apply clicked, menu opened — but the user watched the method menu "keep opening, opening, opening" → 12 iters → `max_pages_exceeded`. Root: `detectPage()` returns the **first-matching page in array order**, and `posting` was first. Workday's `/apply` page **keeps the job-summary Apply button (`adventureButton`) in the DOM alongside the menu**, so every iter re-matched `posting`, re-clicked Apply, re-opened the menu — never reaching the `applyManually` click. Fix: reorder so `start_application` (menu) comes **before** `posting`; once the menu is up, `applyManually` wins. (`96bd12f`)

**Status.** Bugs 0-2 verified (server back online, route 200, posting/menu reached). Bug 3 reorder shipped but **UNVERIFIED on a live run** — user cleared context immediately after. Next session: re-run drain Workday target=1, confirm it clicks Apply Manually once (no loop) and reaches `needs_login` / `my_information`. **Structural takeaway:** Workday cannot be zero-touch — per-tenant login wall means best case is one-time manual auth per tenant, then unattended. This is the cred-custody SaaS blocker arriving early; weigh Workday's ROI against the 3 working zero-auth ATSes.

---

## 2026-05-28 — FILL_FORM race with SPA mount: empty scan when tab "complete" fires before React mounts  ·  FIXED (unverified live)

Three Ashby Notable jobs in a row submitted clean. The fourth — "Customer Success Lead" — errored at
the submit step (`submit_button_not_found`). Same form shape, same selectors that worked seconds
earlier. The user flagged it as inconsistent and asked for the log.

**Symptom in drain.jsonl.** Pipeline trace for the failed job:
- `open_tab` → `fill_form` gap: **0ms** (same millisecond)
- `fill_form` duration: **131ms** total, returned `0 filled + 0 errors + 0 unknowns`
- `fill_ai`: ran on the empty unknown list, fine
- `submit`: `submit_button_not_found`

For comparison the next Ashby Notable job that succeeded showed open_tab→fill_form gap of 1635ms,
fill_form duration ~18s, 4 filled + 15 unknowns.

**Root cause.** Chrome's `chrome.tabs.onUpdated → status: "complete"` event fires when the initial
HTML document has finished loading, NOT when the SPA's React tree has mounted. For
server-rendered forms (some Greenhouse pages) this is fine. For SPA forms (Ashby + Lever
frontends) the React tree mounts after `complete` — usually 1-2s later.

Most of the time the script-injection RTT + `executeScript` + first message round-trip absorbs
that 1-2s before FILL_FORM's scan runs. But a tab that loads from cache or completes in <100ms
can race the mount. When that happens: scanner sees an empty document → 0 fields found → submit
button also not in the DOM → `submit_button_not_found` downstream.

**Fix.** Adaptive single-retry in `extension/drain.js` step 5. If the first FILL_FORM returns
`0 filled + 0 errors + 0 unknowns` — an unambiguous "form not in DOM yet" signature — wait
1500ms and re-send the same FILL_FORM message. The autofill content script is already injected,
so it's a cheap re-scan. Logged as a separate `fill_form_retry` step in drain.jsonl so the rate
is observable. No fixed delay penalty on the happy path.

**Why not a flat sleep before FILL_FORM.** It costs ~2s per job (most don't need it). The
0/0/0 signature is unambiguous (a populated form will always have *some* fields detected or
*some* adapter selectors firing), so the retry only triggers on actual races.

**Why not adapter-anchor polling.** Most robust option, but requires per-adapter
configuration of an anchor selector (`input[name="_systemfield_email"]` for Ashby,
`input[name="email"]` for Lever, etc.) and a poll loop. The retry covers the same cases with
zero adapter-side change and is straightforward to upgrade later if 0/0/0 starts firing
on real empty forms.

**Verification status.** **UNVERIFIED LIVE.** Code shipped, syntax-checked, traces correctly,
but the race window is small and not deterministically reproducible from the VPS. Next batch
will surface `fill_form_retry` events in drain.jsonl if the race fires — that's the
confirmation. If retries happen and the subsequent fill_form scan still returns 0/0/0, the
race is wider than 1.5s and the wait needs lengthening or escalating to adapter-anchor
polling.

---

## 2026-05-28 — AI fabricates plausible URLs for missing-profile fields  ·  OPEN

First live Lever submit (Mistral AE) went through with `Google Scholar URL → https://scholar.google.com/citations?user=zeshan-rehan` populated by the AI-fallback. The user has no Google Scholar account and the profile has no scholar field. AI invented a plausibly-shaped URL rather than returning an empty string.

**Why it happened.** `server/routes/ai-fallback.js` prompts Claude Haiku with the field label + profile JSON + JD context and asks for an answer. There's no instruction forbidding URL fabrication. The model defaults to producing something — and for URL fields with no exact profile match, the plausible-shape failure mode is exactly what URL hallucination looks like. Drain's adapter path can't catch this either: the field is not in any adapter and the unknown-field scanner correctly surfaces it as needing AI help — but "the AI guessed" is not distinguishable from "the AI found the right value" downstream.

**Blast radius.** Every URL-typed unknown field with no profile match: Behance, Dribbble, ORCID, personal blog URL, Medium, Stack Overflow, alt portfolio fields. Each one ships bad data to a real application. Already-shipped applications have at minimum one bogus URL — that data is now on Mistral's record.

**Planned fix (not yet implemented).** Two complementary layers:
1. **Prompt-level (root):** add an explicit rule in `ai-fallback.js` system prompt — "If the field asks for a URL/link/profile/handle and the user's profile contains no matching value, return an empty string. Never invent, guess, or compose a URL from the user's name."
2. **Client-side defense:** in `extension/drain.js` `resolveAndFillUnknowns`, drop any AI answer that LOOKS like a URL but whose host is not present in `profileData.contact.*`. Cheap belt-and-braces; survives prompt drift.

**Why this is top of next session's queue.** It's the only known bug actively shipping garbage to real applications. The autofill pipeline otherwise works end-to-end across all three ATSes.

**Dead end already avoided.** Did NOT chase "add Google Scholar to defaultAnswers" — that fixes one field, doesn't address the class. Hardening the prompt is the right level.

---

## 2026-05-28 — Multi-ATS widen: Ashby + Lever sources, dispatch, submit, audit  ·  FIXED (live-verified)

Drain was Greenhouse-only at session start. Goal: claim/fill/submit Ashby and Lever jobs through the
same loop, with a UI control to scope by ATS or rotate across all three for testing. Three live
submits proved each ATS works (40 GH continuing + 1 Ashby Notable + 1 Lever Mistral). Surfaced two
follow-on bugs that got their own fixes in the same session — `submit_button_not_found` and a
hCaptcha false-positive on Lever — see the two entries that follow.

**Commits:** `a801f29` (sources + dispatch + seed flag) → `5d9a637`/`8a41575` (submit + captcha fixes
covered separately below) → `daa2e05`/`8e7ca83` (richer logging shape) → `2cd2dd4` (breakdown chart +
round-robin mode).

**What shipped.**
- `automation/sources/ashbyBoard.js` — fetches `https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=false`, normalizes to the shared queue record shape with `ats: "ashby"`, `id: "ashby_${jobId}"`, `apply_url` = `job.applyUrl` (or fallback to `${jobUrl}/application`). Filters out `isListed: false` (Ashby exposes drafts via the same endpoint). `fillable` = host is `jobs.ashbyhq.com`.
- `automation/sources/leverBoard.js` — fetches `https://api.lever.co/v0/postings/{org}?mode=json`, normalizes with `ats: "lever"`, `id: "lever_${id}"`, `apply_url` = `job.applyUrl` (or `${hostedUrl}/apply`). `fillable` = host is `jobs.lever.co`.
- `automation/seedQueue.js` — gained a `--source greenhouse|ashby|lever` flag with per-source default token lists (`DEFAULTS`). Default = all three. Tokens override after `--source`.
- `server/routes/jd.js` — added `/jd/ashby/:org/:id` (re-lists the org and `find(j.id === id)` since Ashby's single-job endpoint requires auth) and `/jd/lever/:org/:id` (direct fetch with `descriptionPlain`).
- `server/routes/queue.js` — `/next` lost its hardcoded `ats=greenhouse` default. Now accepts `?ats=greenhouse|ashby|lever|all`. Omitted or `all` = no filter (claim first pending fillable across all sources, FIFO file order).
- `extension/drain.js` — `claimNextJob()` passes the selected ATS through (`?ats=${state.ats}`). `fetchJD(job)` dispatches per `job.ats` against an `ID_PREFIX` map (`gh_`, `ashby_`, `lever_`). Added round-robin mode: when `state.ats === "round_robin"`, rotates through `["greenhouse", "ashby", "lever"]` via `state.rrIndex`, falls through to the next bucket if the current one has nothing pending. **Round-robin code is marked `TESTING ONLY` in three places (state field, order constant, claim branch) so it can be ripped cleanly once scraper diversity makes forced rotation pointless.**
- `extension/drain.html` — ATS dropdown (All / Round-robin (test) / Greenhouse / Ashby / Lever), header pill reflects selection. New "By ATS" + "By Company" breakdown card under the session stats — fills as `tallyApplied(job)` runs on each successful submit, sorts desc by count.

**Verification.** Seeded: 293 Ashby fetched, 292 added (one dup-applied), 570 Lever fetched and added. Smoke-tested both JD endpoints via curl — returned title/company/location/JD as expected. Live drain runs:
- Ashby Notable Staff Fullstack — full pipeline green, **but failed at submit with `reason: "submit_button_not_found"` on first run**. Selectors widened (see next entry) → second run submitted successfully.
- Lever Mistral AE — full pipeline green, **first run hit `captcha_present` on submit despite no visible challenge**. Guard tightened (see entry after next) → second run submitted (with the URL hallucination bug noted in the entry above).
- Greenhouse drained 12 more in a single batch with the new UI; everything green.

**Round-robin live-verification deferred.** User ran the 12-job batch with `ats=all`, not `round_robin`. All 12 were Greenhouse — which is the expected behavior of `all` given queue file order (948 GH records before any Ashby/Lever). Round-robin code traces correctly (rrIndex 0→1→2→0 = greenhouse→ashby→lever); needs explicit dropdown selection to verify.

---

## 2026-05-28 — `submit_button_not_found` on Ashby + Lever (`type=button` instead of `type=submit`)  ·  FIXED (live-verified)

After the multi-ATS widen above, first real Ashby submit (Notable) hit `submit_button_not_found`. Lever
ran into the same selector gap on a different button shape.

**Commit:** `5d9a637` (Ashby selector) → `8a41575` (Lever selector + text fallback consolidation).

**Root cause.** The submit guard was looking for semantic submits only:
```
button[type="submit"], input[type="submit"], button[data-source="submit"]
```
Neither Ashby nor Lever ships a `type="submit"` button on its hosted forms. Ashby's button is a CSS-modules `<button class="_button_… _primary_… _submitButton_… ashby-application-form-submit-button"><span>Submit Application</span>…</button>` — `type` defaults to `"submit"` only when omitted on a `<form>`-nested button, but on these SPA forms the click handler is JS-attached and the button is `type="button"`. Lever's is `<button id="btn-submit" type="button" class="postings-btn template-btn-submit golden-poppy" data-qa="btn-submit">Submit application</button>` — explicit `type="button"`.

**Fix.** Layered selector chain in `extension/autofill.js` `FILL_SUBMIT`, cheapest/most-precise first:
1. Standard semantic submits + Ashby stable class + Lever stable selectors:
   `button[type="submit"], input[type="submit"], button[data-source="submit"], button.ashby-application-form-submit-button, button#btn-submit, button[data-qa="btn-submit"]`
2. Ashby CSS-modules fallback for hash-rotation: `button[class*="_primary_"]`
3. Text fallback: any visible button whose `textContent.trim()` matches `/^(submit|apply|send|finish)\b/i`, excluded by the same cancel/back/withdraw/save-draft/preview regex as the earlier stages

**Why the layered chain rather than just the text fallback.** The text fallback alone is robust but ambiguous — a Lever form with both "Submit application" and "Apply with LinkedIn" can collide. Stable IDs/classes win first, hash-rotating classes second, text last so a build that loses every stable hook still recovers.

**Verification.** Live submits on Ashby Notable + Lever Mistral both pass with the chain in place.
The user supplied the actual button outerHTML for both ATSes — selectors were chosen against that
HTML, not inferred. **Lesson:** for unfamiliar submit-button shapes, ask for the outerHTML before
writing the selector — it costs nothing and removes a guessing step.

---

## 2026-05-28 — Captcha guard v2: false-positive on Lever's hCaptcha SDK iframe (size check insufficient)  ·  FIXED (live-verified)

Captcha guard v1 (2026-05-28 first entry below) fixed the Greenhouse invisible-mode iframe false-positive
by requiring iframe dimensions ≥ 80×80. That cleared Greenhouse but broke on Lever — `captcha_present`
fired with no visible challenge on the page.

**Commit:** `8a41575`.

**Root cause.** Lever embeds the hCaptcha SDK on every form. The SDK loads an iframe matching
`iframe[src*="hcaptcha.com"]` whose bounding box is in the SDK's lazy-mode "ready" state — large
enough to clear the 80×80 threshold but NOT a real challenge (which only renders on suspicious
traffic). The frame is also CSS-hidden / detached from layout / zero-opacity in this state; the
v1 guard only looked at `getBoundingClientRect()`.

**Fix.** Layered visibility checks in addition to the size bump:
- Size threshold raised to `≥ 200 × 200` (real challenge ≈ 400×600 hCaptcha bframe, ≈ 300×400 reCAPTCHA bframe; badge widgets are ≤ 302×76; loaders are 0–1px)
- `getComputedStyle(iframe).visibility !== "hidden"`
- `getComputedStyle(iframe).display !== "none"`
- `getComputedStyle(iframe).opacity !== "0"`
- `iframe.offsetParent !== null` — catches detached / display-none-via-ancestor cases

Only an iframe that survives ALL of these counts as a real challenge requiring user interaction.

**Verification.** Live Lever Mistral submit passes; same Greenhouse jobs that worked under v1 still pass under v2 (no regression). The pre-click-only limitation from v1 still applies (a delayed post-click challenge would let the drain report `submitted: true` while the form sits on a challenge page); deferred until it bites.

---

## 2026-05-28 — Drain captcha guard: false-positive on Greenhouse's preloaded invisible hCaptcha  ·  FIXED (live-verified)

First V3 drain run aborted at the submit step with `reason: "captcha_present"` on a fillable Greenhouse
job. User confirmed: no challenge visible on the form, manual submit click went through cleanly with
no challenge ever appearing.

**Commit:** `42ae475`.

**Root cause.** `FILL_SUBMIT`'s guard ran `document.querySelector('iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], .h-captcha, .g-recaptcha, [data-sitekey]')` — i.e. matched on *SDK presence*, not on *challenge visibility*. Greenhouse preloads hCaptcha's invisible-mode iframe on every form (lazy-mode: SDK loaded, challenge only fires on suspicious traffic). The loader iframe has zero rendered size but matches the src pattern — so the guard tripped on every Greenhouse submit.

**Fix.** Replaced the SDK-presence check with a size threshold: only abort if a captcha-source iframe has `getBoundingClientRect().width > 80 && height > 80`. Real challenge iframes are ~400×600 (hCaptcha bframe) / ~300×400 (reCAPTCHA bframe); invisible loaders are 0×0 or 1×1. The submit pipeline still detects + skips a real challenge, but no longer false-positives on preloaded SDKs.

**Verification.** Re-ran drain with `target=1` after the fix. Full pipeline completed: claim → jd → tailor → pdf → open_tab → fill_form → fill_ai → submit → done. ~35s end-to-end. Queue record marked `done`, `applied_urls.json` recorded via `/queue/mark-applied`.

**Known gap (not fixed).** The check is *pre-click only*. If a lazy hCaptcha/reCAPTCHA decides to challenge AFTER the click (high-risk traffic), the drain will report `submitted: true` but the form won't actually have submitted. Surfacing this requires post-click detection (URL-change confirmation or delayed challenge-iframe re-check). Deferred until it bites — Greenhouse first runs from a fresh IP haven't triggered it yet.

**Related (same commit chain).** `de79a92` separately added AI Q/A persistence to `drain.jsonl` because the first successful submit auto-completed in a snap and the user couldn't see what the AI had answered. `FILL_AI_FIELDS` now returns the diagnostic table; drain logs it as `data.fields` on the `fill_ai` step so post-hoc audits work after the job tab closes.

---

## 2026-05-28 — Greenhouse demographics: local resolver returned profile defaults that didn't match the live options  ·  FIXED (live-verified)

First Greenhouse smoke test (Discord SWE Core Product) on the live drain target. Autofill ran clean except
three combobox fields stayed empty AND left their menus hanging open. Re-run after refresh: same two
demographic dropdowns still empty + hanging.

**Commit:** `0d6ebf6` ("greenhouse 1st smoke test").

**Symptom.** Diagnostic table:

| field | value sent | status |
|---|---|---|
| Gender | "Male" | filled |
| Gender Identity | "Male" | ERROR |
| LGBTQ+ membership | "Prefer not to say" | ERROR |
| Location (City) | "Glassboro, New Jersey" | ERROR (but visually picked correctly) |

**Root cause — two distinct bugs collided.**

1. **`localResolveField` short-circuits on the label without checking what the actual options are.**
   `/\bgender\b/` matches both "Gender" (options Male/Female/...) AND "Gender Identity" (options
   Man/Woman/Non-binary/...) — same value "Male" lands on the first form's options, falls off the second's.
   Same shape for the LGBTQ+ question: local returned the canonical `"Prefer not to say"` regardless of the
   real option phrasing. `bestOptionMatch` in autofill returned -1 → `fillCombobox` failed → menu hung.

2. **`closeCombobox` had one fallback (body click) and that wasn't enough on this build of react-select.**
   Failed-pick paths called `closeCombobox`, the Escape+blur+body-mousedown sequence didn't fully close the
   menu, and there was no further fallback — the open menu was the visible symptom even when the underlying
   bug was the empty pick.

3. **Bonus: `fillCombobox` verification was too strict.** Location's pick *succeeded* (user saw it click
   "Glassboro, NJ, United States") but the chip-text formatting differed from the option-text
   (`shown.includes(texts[idx])` exact substring) so the verify reported false ERROR. Real fill, wrong status.

**Dead end avoided.** First instinct was "Greenhouse react-select must need different events" — i.e. fix the
DOM driver. The advisor pushed back: same value "Male" passed on field 6 and failed on field 10, same field
type and code path — the variable is the options, not the events. That collapsed the suspect set to the
resolver/matcher chain in one step.

**Fix.** Three layered, smallest-blast-radius edits:

- **Gate.** In `resolveUnknownFields` (popup.js), after `localResolveField` returns non-null, if
  `Array.isArray(field.options) && field.options.length > 0`, demand `bestOptionMatch(field.options, answer) >= 0`.
  Otherwise demote to AI — Claude sees the option list in context and picks a real string. Async typeahead
  comboboxes (`options.length === 0` at scan time) skip the gate so the type-then-pick path still trusts local.
  Required loading `lib/match.js` into popup.html so the matcher is a shared global there too.
- **Loosened verification.** Whitespace-normalized bidirectional substring in `fillCombobox` (covers
  "Glassboro, New Jersey, United States" → "Glassboro, NJ, United States" reformat).
- **Layered `closeCombobox`.** focus → Escape → blur+focusout, fallback to `documentElement` mousedown/mouseup,
  final fallback to clicking the `.select__dropdown-indicator` chevron (toggles a still-open menu closed).

**Verification.** User re-ran on the same Discord URL after pulling: all 15 fields filled (no ERRORs), menus
all closed, form submitted successfully on click. 24/24 unit tests still green.

**Reusable pattern.** Local-resolver-vs-options mismatch isn't Greenhouse-specific — Lever and any future ATS
with demographic dropdowns will hit it the moment their option phrasing differs from canonical profile
strings. The gate is the right defense everywhere; it has zero downside since `fillCombobox` would have failed
the same -1 match anyway, this just moves the decision earlier and gives AI a second chance.

---

## 2026-05-27 — Ashby autofill: location combobox, mousedown-commit, fill-time race  ·  FIXED (live-verified)

The 2026-05-26 entry left Ashby with 4 required fields failing after the blur fix. Closed out across three
live runs — each run fixed one layer and surfaced the next. Final state: a real Ashby submit (Notable,
IT-support role) passes with every required field committed. `npm test` green throughout (no resolve/match
logic touched).

**Commits:** `d2cecd7` (location combobox + blur split) → `e0d09fd` (pointer-click commit) → `93e4bf2` (fill race).

### Layer 1 — Location: it's an ARIA combobox, not react-select (`d2cecd7`)

**Symptom.** Location went BLANK at submit. The blur fix cleared it — we set the text, blurred, and an
unselected autocomplete clears its own input on blur.

**Root cause.** `input[placeholder='Start typing...']` is `role=combobox` + `aria-haspopup=listbox`, opens on
TYPE, and portals its `role=listbox` (`id=:r0:`) to `<body>` with `role=option` rows. NOT react-select (no
`.select__input` / `value-container`), so the existing combobox path didn't engage and the adapter filled it
as plain text.

**Dead end.** Assumed a full custom handler was needed. Actually `fillCombobox` / `typeAheadOptions` /
`pickLocationOption` were ~80% reusable: `findComboboxMenu` already resolves via `getElementById` (works for
the portaled, colon-prefixed `:r0:`) and `readComboboxOptionEls` already queries `[role='option']`.

**Fix.** Adapter location `type: "text"` → `"combobox"`, routed through `fillCombobox`. Generalized: (a) don't
bail when click-to-open fails — Ashby opens on type, which `typeAheadOptions` does; (b) verify the pick via
`input.value === optionText` (no react-select chip to read). Also split `fillText` → `setNativeValue` (no
blur) + `fillText` (blur), because the blur added in `c9fbc12` was closing the typeahead menu before options
mounted.

### Layer 2 — Commit fires on mousedown, not click (`e0d09fd`)

**Symptom.** "How did you hear" radio and the tools checkboxgroup reported filled (visually selected) but
submit rejected them as "Missing entry".

**Root cause.** Ashby's custom radio/checkbox/yesno widgets commit to React state on **mousedown**, not on a
bare programmatic `.click()` (which fires only a click event). The visual layer updated via downstream
handlers but the commit never ran. The working combobox handler already used the full mouse sequence — that
was the tell.

**Dead ends.** (1) The yesno hidden `<input type=checkbox>` probe — added to read `.checked`/`.indeterminate`
(invisible in outerHTML) — was a RED HERRING. That checkbox is Ashby's visual/internal state, not its
validation source: it read byte-identical (`false,false,true,false`) across a run where all yesno passed AND a
run where two yesno failed. Removed it. (2) Clicking the radio's `<label>` (which forwards a click to the
input) still missed the commit — the mousedown fired on the label, a sibling of the input's container, and
never reached the handler.

**Fix.** `pointerClick(el)` = mousedown → mouseup → click. Radio clicks the INPUT itself (mousedown bubbles
input → container → option row to the handler; click still natively checks it). yesno/checkboxgroup click
their button/box. NOT an `isTrusted` gate — synthetic events DO commit here.

### Layer 3 — Fill-time race: synthetic events outrun React (`93e4bf2`)

**Symptom.** With the widgets fixed, a DIFFERENT ~3-field subset failed each run (consecutive runs rejected
different fields). All reported filled, 0 errors. The set SHIFTED.

**Root cause.** Both fill loops fire synthetic events in a tight synchronous burst; React never gets a
microtask/frame to flush state between them, so a subset of commits is lost — the field reads filled (DOM
value set) but is empty at submit (React resets the DOM to its uncommitted controlled value on re-render).
**Smoking gun:** the number field "0" passed one run, failed the next, identical code + value. Intermittent
with no change = race, not a deterministic reset.

**Fix.** `await sleep(16)` (one frame) after each field in FILL_AI_FIELDS and FILL_FORM (in a `finally`, so it
covers every `continue` branch), giving React a render cycle to commit before the next event burst. Plus a
single verify+refill pass for text-like fields (text/textarea/number/tel/url/email): re-read after the loop,
refill once if empty. The yield reduces the race; the refill catches stragglers. Skipped
yesno/radio/checkboxgroup verify — no cheap committed-state read (see the probe dead end), and the yield is
what helps them. If non-text fields ever race again, the robust escalation is driving react widgets via React
fiber/props (trusted-event-free) — same path noted for V3 Playwright.

---

## 2026-05-26 — Lever + Ashby adapters, radio/yesno support, AI fallback URL bug  ·  FIXED (Ashby unverified live)

### Lever adapter — iterative live-fix cycle

**Commits:** `5381eeb` → `4796ecd` → `8b4e980` → `61eb593`

**Adapter written, DOM-verified via console snippet before any live run.** All 7 selectors (name, email,
phone, linkedin, portfolio, resume, submit) confirmed present on a real Lever apply page. Two fixes from the
verification pass:
- Resume selector tightened from generic `input[type='file']` → `#resume-upload-input` (confirmed ID in DOM).
- Submit button id is `hcaptchaSubmitBtn` — Lever uses hCaptcha; noted for when live submit is enabled.

**EU subdomain miss (`8b4e980`).** First real-form test: "No adapter found." URL was `jobs.eu.lever.co`
but detect was `"jobs.lever.co"`. Fix: broadened to `"lever.co"` to cover all regional subdomains.

**Post-live-run gaps fixed (`61eb593` + profile.js changes):**
- `org` field (current company) was omitted from the adapter → unknown scanner → AI → filled with "$60,000"
  (AI matched "current company" to salary defaultAnswer). Fix: added `identity.currentOrg = "Rowan University"`
  to profile.js; added `org` to adapter pointing to it.
- `location` field (`input[name='location']`) was not in adapter → blank. Added with source
  `defaultAnswers.currentLocation`.
- `identity.fullName` added to profile.js for Lever's single combined name field.

**Radio button support added (`61eb593`)** — general feature, not Lever-specific:
- `getRadioGroupLabel()`: tries fieldset legend → role=group aria-labelledby → Lever `.application-field`
  parent pattern.
- `scanUnknownFields()`: detects `input[type='radio']`, groups by `name`, adds all group inputs to
  `handledEls`, pushes one `{ fieldType: 'radio', options }` entry per group.
- `FILL_AI_FIELDS`: radio handler uses `querySelectorAll` + `bestOptionMatch` on label texts → `click()`.

**Lever textarea/label fallback (`61eb593`)** — `getLabelText` extended with Lever-style fallback:
clones `.application-field` parent, removes the `.application-field` child, takes remaining text. Fixes
UUID-named textareas (e.g. `cards[UUID][field0]`) where id/name/aria return null. Previously these were
invisible to the unknown scanner; now they show up with the correct question text.

**Lever live status:** name, email, phone, org, location, linkedin, portfolio, resume all adapter-mapped.
Radio (work auth YES/NO) handled. Custom textareas handled. Consent checkbox handled. **Partially
live-tested — org/$60k fixed, EU domain fixed, textarea+radio fill observed working in one run. Submit
never clicked (dry-run by design, hCaptcha on the button).**

---

### AI fallback URL confusion bug — FIXED (`3868a50`)

**Symptom.** Textarea "What are the standard components in an implementation?" was filled with: *"I don't
have direct access to browse inside.lever.co in real time, but I'm genuinely drawn to roles where I can
build infrastructure..."* — a "why I'm interested" motivation answer, not a methodology answer.

**Root cause 1: raw HTML in context.** `contextHtml` was passed as raw HTML (tags + URLs intact) sliced at
2000 chars. The string `inside.lever.co` appeared in the HTML and triggered Claude Haiku's "I can't browse
URLs" reflex, followed by a pivot to a motivation answer.

**Root cause 2: missing routing rule.** "What are the standard components in an implementation?" is a
**technical knowledge question** — asking for domain expertise, not personal motivation. The prompt had
routes for "why do you want to work here", "tell me about yourself", etc., but no route for technical
methodology questions. Haiku fell through to the "why interested" branch.

**Fix:** Added `stripHtml()` to remove HTML tags and URLs from `contextHtml` before prompt insertion.
Added routing rule: *"technical/role-specific knowledge questions → answer as a practitioner, use general
domain knowledge + projects/bio, 2-4 sentences, do NOT give a motivation answer."*

---

### Ashby adapter — written, partially tested, several gaps fixed  ·  FIXED (unverified live)

**Commits:** `4038446` → `0b1bcd4`

**Architecture insight from DOM inspection.** Ashby uses `_systemfield_*` name attributes for stable
system fields (name, email, resume) but UUIDs for all custom fields (phone, LinkedIn, portfolio, custom
questions). Adapter covers only stable system fields — UUID fields fall to the unknown scanner which picks
them up via `label[for="UUID"]` associations. This is correct architecture for Ashby.

**Button discovery issue.** Ashby uses `button[type='submit']` for: (a) file upload buttons, (b) Yes/No
option buttons, AND (c) the real "Submit Application" button. `dryRunBlockSelector: "button[type='submit']"`
would block Yes/No fills mid-form. Set to `button[class*='_primary_']` to target only the submit button.

**Three post-test gaps fixed in `0b1bcd4` (NONE yet live-verified):**

1. **EEOC radio labels not found.** `getRadioGroupLabel` tried `fieldset > legend` first — Ashby uses
   fieldset WITHOUT a legend. The fieldset text is "GenderInput genderMaleFemaleDecline to self-identify" —
   "Input gender" is a11y noise injected after the visible label. Fix: when `closest('fieldset')` has no
   legend, clone fieldset → remove `[class*="_option_"]` children → split text on `/\s+Input\b/i` → take
   part before it → returns "Gender", "Race", "Veteran Status" correctly.

2. **Yes/No toggle buttons not handled.** Ashby renders some boolean questions as two `button[type='submit']`
   elements inside a `div[class*="_yesno_"]` container. These are not `input` elements so `scanUnknownFields`
   (which queries `input, textarea, select`) never saw them. Fix: added a second scan loop at the end of
   `scanUnknownFields` querying `[class*="_yesno_"]` containers. Label extracted by cloning parent
   `_fieldEntry_*` div and removing the `_yesno_` child. Each container tagged with `data-jobby-yesno="N"` at
   scan time to give FILL_AI_FIELDS a stable selector. New `fieldType: "yesno"` handler: `querySelector` by
   data attribute → `querySelectorAll('button')` → `bestOptionMatch` on button texts → `click()`.

3. **Location field not filled.** `input[placeholder='Start typing...']` has no id or name so
   `getUniqueSelector` returned null and the scanner skipped it. Fix: added to adapter directly with
   `source: "defaultAnswers.currentLocation"`. Fills "Glassboro, New Jersey" via `fillText`. Whether Ashby
   accepts typed text without a dropdown selection is **UNCONFIRMED** — location may require autocomplete pick.

**Ashby live-test status:** name, email, resume filled (confirmed from one run — `autofill.js` log showed
`filled: 3, unknownFields: 7, AI fill done — filled: 7`). Radio, yesno, and location fixes committed but
**NOT YET tested live.** Run one full Ashby form to confirm.

---

## 2026-05-25 — "lesser AI fallback": measured the split, fixed the 4 real leaks  ·  FIXED (unverified live)

**Context.** The `24f8635` commit name ("needs lesser AI fallback") was a TODO, not done work. Open
question: of the unknown fields a form sends, how many actually hit Claude vs resolve locally? The run logs
couldn't answer it — `sendAiFields` DOM-fills the MERGED (local+AI) resolved set, so "AI fill done —
filled: 24" conflates both, and `ai-fallback.js` logs only on error (the run had 0).

**Measurement.** Added a temp `[Jobby] resolve-split` log in `resolveUnknownFields` (popup.js) printing
`local: X | ai: Y` + the exact labels routed to Claude. One live run on a Remote Engineering-Team-Lead
form: **`unknown: 24 | local: 11 | ai: 13`.**

**Finding — 13-to-AI is mostly correct, not bloat.** Of the 13: **8 are legitimately AI's job** — 5
open-ended essays (Elixir experience, difficult-direct-report story, product-collab story, "what interests
you", "what resonates from our values") + 3 job-specific qualification yes/nos (production backend? manage
engineers? non-technical stakeholder convos?). Those are the permanent floor; you can't pre-can them. The
posting being a senior, essay-heavy role inflates the count — a normal form has 1-2 of these.

**The 4 real leaks (standard fields slipping through narrow label regexes) — FIXED in `lib/resolve.js`:**
- "Privacy notice" `[Acknowledge/Confirm]`, "Notice at Collection for California…"
  `[Acknowledge/Confirm, I am not a CA resident]`, "…confirm you consent your self-identification data…"
  `[Yes, I consent / I don't wish to answer]` — the old ack rule required an action VERB *and* a
  policy/privacy keyword in the LABEL; these miss one or the other. Fix: detect by **option shape** (find
  an option matching `acknowledge|i consent|i agree|yes, i (consent|agree)`) and return it verbatim so the
  matcher gets an exact hit. Returning a bare "Yes" wouldn't have matched "Acknowledge/Confirm". CA notice
  → "Acknowledge/Confirm" by design (existing "always affirm consent gates" policy), not the truer "not a
  CA resident".
- "…LGBTQIA+ community?" `[Yes, No, Prefer not to respond, …]` — demographic rule only matched
  `/sexual orientation/`. Widened to `lgbtq|lbgtq|lesbian|transgender`.
- 1 borderline left on AI **by design**: the work-eligibility *status* dropdown (Citizen/PR/VISA/Sponsor) —
  the country-guard routes it to AI on purpose.

**Guard against over-triggering.** The ack detector keys on consent/acknowledge OPTION text, not a bare
"Yes", so plain `[Yes, No]` qualification questions still route to AI. A `resolve.test.js` case locks this.

**Tests.** +4 in `test/resolve.test.js` (LGBTQIA+, two verb-less ack labels, consent field, plain-Yes/No
guard). Suite 20 → **24 green**.

**Verified?** Logic only (offline, 24 green). **Live fill NOT yet confirmed** — needs reload + one run;
expect the split to move to ~`local: 15 | ai: 9` and the 4 fields to fill with no API call. Strip the temp
resolve-split log after that. Decision stands: don't chase the 8 essays/job-specific — AI is the right tool
there; the win was the 4 regex-gap leaks, and ack/EEO gates repeat on nearly every form.

**Follow-up (same day, `b099f50` → `c1b5bb4`) — CONFIRMED LIVE; tag → FIXED.** A real run showed the AI
field count drop as predicted. The `resolve-split` log is intentionally **KEPT** (not stripped) — it's one
clean line in the popup console and is the ongoing local-vs-AI coverage signal for V4. Comment relabeled
from "temp instrumentation, strip once measured" to a permanent coverage-signal note.

---

## 2026-05-25 — first test suite + `bestOptionMatch` shortest-wins comment is wrong  ·  DECISION / OPEN

**Context.** Added the project's first automated tests (`node --test`, zero deps, `npm test`). The target is
the two pure "chokepoint" functions every form funnels through — `bestOptionMatch` and `localResolveField`.
These carry the nastiest edge-case logic in the app and had **zero** coverage; every logic bug in the
entries below (Lebanon, "No" ⊂ "Not…", country→work-status leak) is now a locked regression case. DOM
mechanics (combobox open/close, checkbox tick) are deliberately NOT tested — sandbox-blind, live-only.

**Logistics.** Pure functions extracted into `extension/lib/*.js` with a dual export
(`if (typeof module !== "undefined") module.exports = …`) so the same source is a browser global AND a
Node import — single source of truth, no duplication.
- `localResolveField` → `extension/lib/resolve.js`, loaded via `<script>` in `popup.html` before `popup.js`.
  **Done & committed this session.** Popup-only, zero impact on the autofill injection path.
- `bestOptionMatch` → `extension/lib/match.js`: **HELD.** Extracting it changes the `executeScript` call
  (`files: ["autofill.js"]` → `["lib/match.js", "autofill.js"]`), which is in the live autofill hot path.
  Held until checkbox + async-location are confirmed on a real Greenhouse form so that run stays on
  known-good `autofill.js`. Until then `test/match.test.js` guards a **verbatim temp copy** of the function
  (loud TODO at the top). If you edit the matcher in `autofill.js` before the extraction, mirror it there.

**Finding the tests surfaced (the reason this is an entry, not just a commit).** Writing the matcher tests
exposed that the `autofill.js:83` comment is **factually wrong**. It claims picking the SHORTEST containing
option makes `"United States"` land on `"United States of America"`, "not the first `…- Alabama` by list
position". But `"United States - Alabama"` (23 chars) is *shorter* than `"United States of America"` (24),
so shortest-wins actually picks **Alabama**. The *mechanism* the comment describes (shortest, not
first-by-position) is real and correctly implemented; only the *example* is a fiction.

**Why it's benign (so far) — hence OPEN, not a fire.** Real country dropdowns expose an exact
`"United States"` option → step-1 exact match handles it before shortest-wins runs. State-split dropdowns
(e.g. Remote) get the state-qualified answer `"United States of America - New Jersey"` from
`localResolveField`, which also exact-matches. The contradiction only bites if a real form ever presents a
bare `"United States"` answer against mixed state/country options with no exact hit — not yet observed.

**Decision.** Did NOT lock the buggy Alabama behavior in a test (that would cement a latent bug against a
wrong comment). Kept a positive property-based shortest-wins test using non-contradictory options. The
comment fix in `autofill.js` is folded into the HELD extraction task (it's a doc-only change, but touching
`autofill.js` waits for the live confirmation per the sequencing above). Revisit if a live form ever shows
the bare-"United States" + state-split combination.

**Follow-up 2026-05-25 (later, `24f8635`) — HELD extraction released, tax paid.** A live Remote/Greenhouse
run confirmed the consent checkbox (`consent: 1`, 0 errors) on known-good `autofill.js`, which was the gate
on the hold. So the extraction landed: `bestOptionMatch` moved into `extension/lib/match.js`, injection
changed to `executeScript files: ["lib/match.js", "autofill.js"]` (popup.js:270), and `test/match.test.js`
switched from its verbatim temp copy to `require("../extension/lib/match.js")` — **the duplicate-copy
maintenance tax is now gone.** Debug logs stripped from `autofill.js` in the same commit. STILL OPEN from
this entry: (a) the wrong "Alabama" comment was NOT fixed in `24f8635` — carry it to the next `autofill.js`
touch; (b) async type-ahead location remains unconfirmed live (the retest form had no location combobox).

---

## 2026-05-24 — react-select combobox cascade: every dropdown filled blank/garbage  ·  FIXED

**Symptom.** On live Greenhouse, dropdowns either filled nothing or filled wildly wrong values — the
phone-code field got set to "Lebanon". The *scan* phase logged the right options for each field, so it
looked like a fill-only bug.

**Root cause.** The fill phase was reading the WRONG menu for every field. Cascade:
1. `#country` (the intl-tel-input phone-country chip) filled first and left its menu stuck open.
2. Every later combobox then failed to open (a menu was already up).
3. `findComboboxMenu`'s document-wide fallback (`querySelector('.select__menu, [role=listbox]')`)
   returned the still-open COUNTRY menu.
4. So every field matched its answer against the 244 country options → blank, or garbage like "Lebanon".

**Dead ends (not in git).** Spent time suspecting the option-matcher and the open/click synthetic events.
The local `.harness/` greenlit two passes that then died on the real form — react-select mechanics in
isolation didn't reproduce the cross-field contamination. **Lesson: the real Greenhouse form is the only
source of truth; the harness validates mechanics, not the cascade.**

**Fix** (`extension/autofill.js`, committed `c1369a9` → `54fdb7c`):
- `findComboboxMenu` resolves the menu ONLY via `aria-controls`→`getElementById`. **Removed the
  document-wide fallback** — that was the contamination source. Worst case is now a blank field (safe),
  never another field's menu.
- Added `isComboboxOpen(el)` (`aria-expanded` true AND its own menu resolvable).
- `openCombobox` / `closeCombobox` now verify their OWN menu actually opened / closed (Escape+blur →
  click-outside fallback). `fillCombobox` requires `opened` and `ok===true`, always closes after.
- `scanUnknownFields` skips `#country` (phone already carries `+1`; it was the cascade trigger).
- `bestOptionMatch` ladder rewritten: exact → leading-clause (comma split) → answer⊂option (shortest
  wins) → option⊂answer(≥4) → token-overlap. Forward-substring needs ≥3 chars (stops "No" ⊂ "Lebanon").

**Verified.** Live on `job-boards.greenhouse.io` and a Remote (greenhouse) job — dropdowns fill correct
values, no cross-contamination. Debug logs (`[Jobby] combobox-debug`, `fill-debug`) intentionally left in
until checkbox + async-location are also confirmed live, then strip.

---

## 2026-05-24 — Claude 429 (TPM rate limit) on forms with many unknown fields  ·  FIXED

**Symptom.** Forms with lots of open-ended/unknown fields threw `429 Too Many Requests` from Claude —
the whole batch resolution failed, so fields that could have been answered got nothing.

**Root cause.** Every unknown field was being sent to the AI. A single dense form burst ~52k tokens at
once, blowing the per-minute token limit (TPM), not the request count.

**Fix** (`extension/popup.js` `localResolveField`, server side, committed `2b176bc`). Added an in-process
pre-resolver that answers ~75% of unknown fields with ZERO API calls — demographics, work auth, location,
legal, salary, availability, acknowledgements — straight from `profile.js` `defaultAnswers`. Only genuinely
open-ended questions ("why this company", "tell us about yourself") fall through to Claude. Token burst
dropped ~52k → ~10k per form. This is the change that made multi-field forms reliable.

**Verified.** Live — no more 429s on dense forms. See also the dropdown-matching entry below; the same
commit added the `fillSelect` ≥4-char guard.

---

## 2026-05-23/24 — dropdowns picking the wrong option ("No" matched inside "not a protected veteran")  ·  FIXED

**Symptom.** Plain `<select>` dropdowns landed on the wrong option. The classic: answer "No" matched as a
substring inside the option text "**No**t a protected veteran", selecting the wrong entry.

**Root cause.** The option-match fallback used a naive bidirectional `includes()` with no length floor, so
a 2-char answer matched inside almost any longer option, and short option text matched inside long answers.

**Fix (evolved over three commits).**
- `a04d2d0` — first added a bidirectional `includes()` fuzzy fallback (so "Eastern Time Zone" matches
  despite whitespace/wording diffs). This is what *introduced* the over-eager substring matching.
- `2b176bc` — option-in-answer substring now requires **≥4 chars**, killing "no" ⊂ "not…".
- Later folded into the react-select `bestOptionMatch` ladder (see the combobox entry at top) — exact →
  leading-clause → shortest-containing → option⊂answer(≥4) → token-overlap, forward-substring ≥3 chars.

**Lesson.** Substring matching for form options needs a length floor in *both* directions; short
yes/no/country tokens are the trap.

---

## 2026-05-23 — resume upload showed "stale", never attached  ·  FIXED

**Symptom.** The resume file field reported as "stale" (selector matched nothing) and no file attached on
Greenhouse.

**Root cause.** Greenhouse renders the file input as `id="resume"` with **no `name` attribute**. The
adapter selector was `input[name='resume']`, which matched zero elements.

**Fix** (`server/data/adapters/greenhouse.json`, committed `e1a3f7c`). Selector → `#resume`. Also bumped
the adapter version to bust the extension's cached adapter map. Upload itself uses DataTransfer — confirmed
live.

---

## 2026-05-23 — "No information available" leaking into form fields; over-aggressive sensitive filter  ·  FIXED

**Symptom.** Two related issues: (1) low-confidence AI answers like "No information available" were being
typed verbatim into fields; (2) the sensitive-keyword filter was blocking salary/compensation/references
questions that we actually want answered.

**Root cause.** No server-side confidence gate before returning AI answers; and `SENSITIVE_KEYWORDS` was
too broad — it lumped salary/comp/references in with hard demographics.

**Fix** (`server/routes/ai-fallback.js`, committed `1a0c1c3`). Low-confidence answers are nulled
server-side before returning (client never sees filler). Removed salary/compensation/wage/references from
`SENSITIVE_KEYWORDS` — only hard demographics (race, gender, etc.) are blocked now. Prompt also told to
pick defensible defaults (No for non-compete, Yes for salary comfort) rather than punt.

---

## 2026-05-23 — swapped Groq (llama-3.3) → Claude Haiku 4.5 for both AI services  ·  DECISION

**Not a bug — a deliberate model swap, logged for the *why*.** Both resume tailoring (`groqService.js`)
and unknown-field resolution (`ai-fallback.js`) moved off Groq's llama-3.3 to `claude-haiku-4-5-20251001`
via the Anthropic SDK (committed `380226b`).

**Why.** Better instruction-following (the prompt rules in `groqService.js` are strict — no inventing
bullets, no changing numbers, banned skill suffixes) and stronger prose for open-ended fields. Cost is
~$0.043/app, acceptable for the 200–300 applications this is built for.

**Footgun left behind + how it's neutralized (2026-05-24).** The file is still named `groqService.js`
and old docs mentioned `GROQ_API_KEY` — the actual key is `ANTHROPIC_API_KEY`, and there is no Groq
dependency at all (`@anthropic-ai/sdk` only). **Decision: the rename is deliberately DEFERRED, not open**
— `groqService.js` is the "single source of truth" import in `tailor.js` + `apply.js` and is woven through
the architecture docs; renaming buys nothing functional and would force a redeploy mid-verification. To
make sure this never derails a future session, the legacy name is now called out loudly in three places:
(1) a header banner at the top of `server/services/groqService.js`, (2) a ⚠️ callout in `CLAUDE.md`'s Stack
section, (3) this entry. All stale "Groq" prose + the wrong `.env` line in `CLAUDE.md` were corrected to
Claude/`ANTHROPIC_API_KEY`. If anyone wants the rename later, it's a clean isolated commit: rename file +
2 import lines + doc refs, then redeploy.

---

## 2026-05-20 — V1 resume: bullets get "and…" clauses appended; resume spills to page 2  ·  OPEN (mitigated)

**Symptom.** (1) Groq tailoring appends keyword clauses to bullet ends ("…, utilizing problem-solving
skills") instead of weaving them in. (2) On keyword-dense JDs the PDF overflows onto a second page.

**Mitigations so far.** `13d31a1` hardened the prompt against bullet-appending and added `changesMade`;
`67abb8c`/`104e49b` aggressively tightened `resume.html` spacing/padding to fight page-2 overflow.

**Status: still OPEN** — both are listed under "Active Issues (V1)" in `CLAUDE.md`. The prompt still
occasionally appends "and…" clauses, and some JDs still spill. Real fix likely needs a harder prompt rule
plus dynamic font/spacing, not just static padding cuts.
