# Jobby — Dev Log

Append-only post-mortem record. One entry per bug / debugging saga. This is **not** a changelog
(git has the diffs) and **not** the status snapshot (`CLAUDE.md` → "Last Session Cutoff" is). This is
the *why*: the symptom we saw, the root cause we eventually found, the dead ends along the way, the fix,
and how we verified it. New entries go at the **top**. Never edit old entries — append a follow-up instead.

Entry tags: `FIXED` · `FIXED (unverified live)` · `WORKAROUND` · `OPEN` · `WONTFIX` · `DECISION`

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
