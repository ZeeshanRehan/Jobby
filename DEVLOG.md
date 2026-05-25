# Jobby — Dev Log

Append-only post-mortem record. One entry per bug / debugging saga. This is **not** a changelog
(git has the diffs) and **not** the status snapshot (`CLAUDE.md` → "Last Session Cutoff" is). This is
the *why*: the symptom we saw, the root cause we eventually found, the dead ends along the way, the fix,
and how we verified it. New entries go at the **top**. Never edit old entries — append a follow-up instead.

Entry tags: `FIXED` · `FIXED (unverified live)` · `WORKAROUND` · `OPEN` · `WONTFIX` · `DECISION`

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
