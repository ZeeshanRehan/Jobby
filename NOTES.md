# Jobby — Notes

Append-only scratchpad for the stuff that isn't a bug post-mortem (`DEVLOG.md`) and isn't live
status/rules (`CLAUDE.md`): firsthand recon from real runs, design talks, and uncommitted ideas.
This file is **not** auto-loaded into every session — pull it up when you're reasoning about
direction, a new ATS, or picking up a half-formed idea.

New entries go at the **top**. Never edit old entries — append a follow-up instead. Date every entry.

Entry tags:
- `[RECON]` — firsthand observation of how a site / ATS actually behaves on a real run. The ground truth.
- `[IDEA]` — design / brainstorm capture. The *why* and the tradeoffs behind a lean. Not committed/built.
- `[TALK]` — a session discussion worth keeping that doesn't fit the other two.

---

## 2026-05-26 [IDEA] Coverage ceiling + why LinkedIn/mass-appliers aren't the model

**Coverage if we land Greenhouse + Lever + Ashby + Workday.** Two very different "percents" — depends
entirely on which job population you measure against:
- **Of Jobby's actual target pipeline (tech / early-career, sourced from new-grad GitHub repos + ATS
  job-board APIs): ~80-90%.** This is the number that matters. The repos (SimplifyJobs, vanshb03,
  speedyapply, etc.) are overwhelmingly GH/Lever/Ashby/Workday links — it's just what tech companies use.
- **Of *all* US postings everywhere: ~40-50%.** The non-tech long tail runs on iCIMS, Taleo (Oracle),
  SuccessFactors (SAP), ADP, UKG, Workable, SmartRecruiters, JazzHR… no four-ATS set covers the whole
  market; it's a long tail by design.
- These are reasoned estimates, **not cited figures** (ATS share shifts, Ashby especially; data has a
  cutoff). Pull current market-share data if a defensible number is ever needed.
- **Diminishing returns after the four.** Next tier (iCIMS/Taleo/SuccessFactors) is enterprise = login
  walls + per-tenant variance = more Workday-style "separate projects" for smaller slices each. The four
  ATSs ≈ the natural effort/reward ceiling. **More volume comes from sourcing more jobs *into* those same
  four, not from adding ATS #5.**

**LinkedIn Easy Apply — difficulty is inverted.** The *form* is the easy part (small modal, screening Qs
route straight through `localResolveField` + AI). **LinkedIn the platform is the hard part:**
- Real wall = **behavioral bot-detection** (mouse/timing/navigation fingerprinting) + ToS + account ban.
- In-browser-in-user's-session solves **credential custody** (same win as Workday Google SSO) but **NOT**
  detection or the ToS/ban risk — automated activity in your real session is exactly what they fingerprint.
- **Cost asymmetry is brutal for a job seeker:** a banned Greenhouse doesn't exist; a banned *LinkedIn* =
  losing your professional network, the thing you need most while job hunting.
- **Reframe:** most LinkedIn posts aren't Easy Apply — they "Apply on company site," and that site is
  usually GH/Lever/Ashby/Workday. So LinkedIn's real value is **sourcing into the four we already cover**,
  not Easy Apply itself (and even scraping its listings is anti-bot'd → careful/low-volume).
- **Lean:** late, optional, high-risk / low-volume tier — human pacing + jitter, never headless, one-click
  only (bail to needs-human on multi-step). **Probably never for the SaaS tier.** Don't build it next.

**"How do LazyApply / Sonara / etc. do it then?" — they don't beat detection; they eat the bans and pass
the risk to the user.** Two archetypes:
1. **Extension-in-your-browser (LazyApply & most cheap ones):** your session, no custody (safe on that
   axis — same as us). Survives via **laggy/probabilistic enforcement + jitter + moderate volume**; heavy
   users get flagged faster. **Ban risk externalized to the user** (ToS "at your own risk"). Quality =
   spray-and-pray (wrong screening answers, no tailoring). "LazyApply restricted my LinkedIn" is a common
   complaint — the bans are real, the tool already got paid.
2. **Cloud / managed "apply while you sleep" (Sonara-flavored):** runs on *their* infra → takes creds/
   session (breach honeypot) or only hits no-login sites. **Easier to mass-detect** (same datacenter IPs +
   identical patterns across accounts → wave bans), more fragile, several have been C&D'd / wound down /
   pivoted. (Live status uncertain — cutoff; verify if it matters.)

**Strategic conclusion (validates current direction, doesn't undermine it):** their existence proves Easy
Apply is *technically possible*, not *safe* or *good*. **The no-login four = the safe quadrant: no account
= no ban-risk AND no credential custody.** Worst case there is a per-submission captcha. The mass-appliers
threw away that safety to chase LinkedIn's volume. **Jobby's wedge (tailoring quality + safe no-login
targets) is exactly their weakness** — don't out-blast them on LinkedIn; be the thing that doesn't nuke
your account or submit slop. Foundation = the no-login four; scale volume via better sourcing into them.

---

## 2026-05-26 [RECON] Workday — first manual live run

Walked one Workday application by hand to scout automation difficulty. n=1, so treat as a single data
point, not a rule.

**What the run actually looked like:**
- Had to apply manually (no auto-anything yet).
- **Logged in with Google** → picked my account. No email/password account creation, no verification code.
- Form opened, then **multi-page — but the SPA kind (in-app navigation, no full page refresh)**.
- **No captcha** anywhere in the flow.

**Difficulty read (what's easy vs hard):**
- *Easy / already solved by the in-browser model:* Google login + account pick is **free** — the extension
  runs in the user's already-logged-in browser, so the session is authenticated and we never touch creds
  (this is the whole reason for the in-browser loop over server-side Playwright — see [IDEA] V3+ strategy).
- *Easier than expected:* SPA multi-page is **easier** than the full-reload kind — the content script stays
  alive across steps (document never reloads), so no re-injection per page. One loop does it:
  `fill → click Next → wait for DOM to settle → re-scan → repeat`. Workday's `data-automation-id` attributes
  give stable selectors.
- *The genuinely hard parts (NOT hit on this run):*
  1. **Account creation + email verification code** — the first time on each company's Workday tenant. This
     is the real near-zero-human blocker. **Google SSO sidesteps it** (as it did here). Open question: how
     often is SSO offered across tenants? If common, Workday collapses from "separate project" toward "fat
     adapter + page-loop."
  2. **Custom widgets** — date pickers, typeahead dropdowns, repeating "Add another" sections (work history /
     education). The bulk of the quirk-hunting; needs per-widget helpers.
  3. **Per-tenant variance** — each company customizes its question set; expect iteration.

**Verdict:** the core form-fill is very doable on the existing engine + a page-loop (the smaller lift). The
"separate project" weight comes mostly from account/email management + widget variety, not the filling.

**To validate next time on a Workday form:**
- Does the EEO / demographics page match the standard Workday set? (If so it routes straight through
  `localResolveField` — another half-free chunk.)
- How often do tenants offer Google SSO vs forcing email+code?

---

## 2026-05-26 [IDEA] V3+ strategy — volume autopilot, in-browser loop, SaaS

> Migrated out of CLAUDE.md (it was bloating the always-loaded file). Captured from a long design
> conversation so the *why* survives, not just the *what*. Nothing here is decided or scheduled — it's the
> shape we reasoned toward and the tradeoffs behind each lean. **Revises the "V3 = Playwright everywhere"
> assumption** (see "Playwright's role").

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
