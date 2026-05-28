// ─── Drain Controller ────────────────────────────────────────────────────────
// Persistent in-browser loop: claims jobs from /queue/next, drives the same
// tailor → autofill pipeline the popup uses, optionally submits, logs every
// step to drain.jsonl on the server. Closes when the tab is closed.
//
// Background tabs (active: false) are subject to Chrome's setTimeout throttling
// after ~5min of inactivity. Our per-job work fits well inside that window.

const JITTER_MIN_MS = 25_000;
const JITTER_MAX_MS = 45_000;
const TAB_LOAD_TIMEOUT_MS = 30_000;
const AUTOFILL_TIMEOUT_MS = 60_000;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  startBtn:     $("startBtn"),
  stopBtn:      $("stopBtn"),
  targetCount:  $("targetCount"),
  atsSelect:    $("atsSelect"),
  atsPill:      $("atsPill"),
  dryRun:       $("dryRun"),
  watchMode:    $("watchMode"),
  statusDot:    $("statusDot"),
  statusText:   $("statusText"),
  progressBar:  $("progressBar"),
  statApplied:  $("statApplied"),
  statSkipped:  $("statSkipped"),
  statErrors:   $("statErrors"),
  statTarget:   $("statTarget"),
  curCompany:   $("curCompany"),
  curTitle:     $("curTitle"),
  curStep:      $("curStep"),
  log:          $("log"),
  errBanner:    $("errBanner"),
  bdAts:        $("bdAts"),
  bdCompany:    $("bdCompany"),
  detailsToggle:$("detailsToggle"),
  detailsBody:  $("detailsBody"),
  detailsEmpty: $("detailsEmpty"),
  detailsContent: $("detailsContent"),
  dCompany:     $("dCompany"),
  dTitle:       $("dTitle"),
  dUrl:         $("dUrl"),
  dResult:      $("dResult"),
  dFormFilled:  $("dFormFilled"),
  dFormErrors:  $("dFormErrors"),
  dFormUnknowns:$("dFormUnknowns"),
  dFormList:    $("dFormList"),
  dAiFilled:    $("dAiFilled"),
  dAiErrors:    $("dAiErrors"),
  dAiTbody:     $("dAiTbody"),
};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  running:       false,
  stopRequested: false,
  target:        10,
  ats:           "all",
  dryRun:        false,
  watchMode:     false,
  counts:        { applied: 0, skipped: 0, errors: 0 },
  current:       null,
  byAts:         {},       // { greenhouse: 4, ashby: 2, ... } — successful submits per ATS
  byCompany:     {},       // { GitLab: 3, notable: 1, ... }
  // TESTING ONLY — index that cycles greenhouse → ashby → lever per claim when
  // ats === "round_robin". Remove once the scraper provides natural ATS diversity
  // and we no longer need to force-interleave for proof-of-coverage runs.
  rrIndex:       0,
};

const ATS_LABELS = {
  all: "All ATS", round_robin: "Round-robin", greenhouse: "Greenhouse", ashby: "Ashby", lever: "Lever",
};
const ID_PREFIX  = { greenhouse: "gh_", ashby: "ashby_", lever: "lever_" };
// TESTING ONLY — see state.rrIndex comment above.
const ROUND_ROBIN_ORDER = ["greenhouse", "ashby", "lever"];

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(kind, text) {
  els.statusDot.className = "dot " + kind;
  els.statusText.textContent = text;
}

function updateStats() {
  els.statApplied.textContent = state.counts.applied;
  els.statSkipped.textContent = state.counts.skipped;
  els.statErrors.textContent  = state.counts.errors;
  els.statTarget.textContent  = state.target;
  const done = state.counts.applied + state.counts.skipped + state.counts.errors;
  const pct  = Math.min(100, Math.round((done / Math.max(1, state.target)) * 100));
  els.progressBar.style.width = pct + "%";
  renderBreakdown();
}

function renderBreakdown() {
  const fillCol = (el, map, emptyMsg, labelFn) => {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      el.innerHTML = `<div class="breakdown-empty">${emptyMsg}</div>`;
      return;
    }
    el.innerHTML = "";
    for (const [k, v] of entries) {
      const row = document.createElement("div");
      row.className = "breakdown-row";
      const lbl = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = labelFn ? labelFn(k) : k;
      const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = v;
      row.appendChild(lbl); row.appendChild(cnt);
      el.appendChild(row);
    }
  };
  fillCol(els.bdAts,     state.byAts,     "No submissions yet.", (k) => ATS_LABELS[k] || k);
  fillCol(els.bdCompany, state.byCompany, "No submissions yet.");
}

function tallyApplied(job) {
  const ats = job?.ats || "unknown";
  const co  = job?.company || "unknown";
  state.byAts[ats]     = (state.byAts[ats]     || 0) + 1;
  state.byCompany[co]  = (state.byCompany[co]  || 0) + 1;
}

function setCurrent(job, step) {
  if (!job) {
    els.curCompany.textContent = "Not running";
    els.curCompany.classList.add("empty");
    els.curTitle.textContent = "";
    els.curStep.style.display = "none";
    return;
  }
  els.curCompany.textContent = job.company;
  els.curCompany.classList.remove("empty");
  els.curTitle.textContent = job.title || "";
  els.curStep.textContent = step;
  els.curStep.style.display = "inline-block";
}

function timeOnly(iso) {
  return iso ? new Date(iso).toLocaleTimeString("en-US", { hour12: false }) : "";
}

function appendLogRow({ ts, step, ok, message }) {
  // first append clears the placeholder
  if (els.log.querySelector(".empty")) els.log.innerHTML = "";
  const row = document.createElement("div");
  row.className = "row";
  const tsSpan = document.createElement("span"); tsSpan.className = "ts";   tsSpan.textContent = timeOnly(ts);
  const stSpan = document.createElement("span"); stSpan.className = "step " + (ok === false ? "err" : (ok === true ? "ok" : "info")); stSpan.textContent = step;
  const msSpan = document.createElement("span"); msSpan.className = "msg";  msSpan.textContent = message;
  row.appendChild(tsSpan); row.appendChild(stSpan); row.appendChild(msSpan);
  els.log.appendChild(row);
  els.log.scrollTop = els.log.scrollHeight;
}

function showError(text) {
  els.errBanner.textContent = text;
  els.errBanner.classList.add("show");
}
function clearError() { els.errBanner.classList.remove("show"); }

// ─── Last-job details panel ───────────────────────────────────────────────────
// Captures the full pipeline outcome for the most-recent job so the user can
// audit what was filled (adapter vs AI), what errored, and why submit succeeded
// or failed — all without tailing drain.jsonl on the server.
const details = {
  job:    null,
  form:   { filled: [], errors: [], unknowns: 0 },
  ai:     { filled: 0, errors: 0, fields: [] },
  result: { kind: null, label: "—" }, // kind: ok|err|skip|null
};

function resetDetails(job) {
  details.job    = job;
  details.form   = { filled: [], errors: [], unknowns: 0 };
  details.ai     = { filled: 0, errors: 0, fields: [] };
  details.result = { kind: null, label: "running…" };
  renderDetails();
}

function renderDetails() {
  if (!details.job) {
    els.detailsEmpty.style.display = "block";
    els.detailsContent.style.display = "none";
    return;
  }
  els.detailsEmpty.style.display = "none";
  els.detailsContent.style.display = "flex";

  const j = details.job;
  els.dCompany.textContent = j.company || "—";
  els.dTitle.textContent   = j.title   || "—";
  els.dUrl.textContent     = j.apply_url || "—";
  els.dUrl.href            = j.apply_url || "#";

  els.dResult.textContent  = details.result.label;
  els.dResult.className    = "details-result" + (details.result.kind ? " " + details.result.kind : "");

  els.dFormFilled.textContent   = `${details.form.filled.length} filled`;
  els.dFormErrors.textContent   = `${details.form.errors.length} errors`;
  els.dFormUnknowns.textContent = `${details.form.unknowns} unknowns`;

  els.dFormList.innerHTML = "";
  // filledDetails: [{field, label, value}] — show real form label + value sent.
  // Legacy string form falls back to the bare key.
  for (const f of details.form.filled) {
    const li = document.createElement("li");
    if (typeof f === "string") {
      li.textContent = f;
    } else {
      const label = document.createElement("span");
      label.className = "details-li-label";
      label.textContent = f.label || f.field || "(field)";
      const sep = document.createElement("span");
      sep.className = "details-li-sep";
      sep.textContent = " → ";
      const value = document.createElement("span");
      value.className = "details-li-value";
      value.textContent = f.value == null ? "" : String(f.value);
      li.appendChild(label); li.appendChild(sep); li.appendChild(value);
    }
    els.dFormList.appendChild(li);
  }
  for (const f of details.form.errors) {
    const li = document.createElement("li");
    li.className = "err";
    const name = typeof f === "string" ? f : (f.field || f.selector || "(field)");
    const msg  = typeof f === "object" ? (f.message || f.error) : null;
    li.textContent = name + (msg ? ` — ${msg}` : "");
    els.dFormList.appendChild(li);
  }

  els.dAiFilled.textContent = `${details.ai.filled} filled`;
  els.dAiErrors.textContent = `${details.ai.errors} errors`;
  els.dAiTbody.innerHTML = "";
  for (const f of details.ai.fields) {
    const tr = document.createElement("tr");
    const isErr = f.status && f.status !== "filled";
    const tdStatus = document.createElement("td");
    tdStatus.className = "status-cell";
    const chip = document.createElement("span");
    chip.className = "chip " + (isErr ? "chip-err" : "chip-ok");
    chip.textContent = f.status || "—";
    tdStatus.appendChild(chip);
    const tdLabel = document.createElement("td"); tdLabel.textContent = f.label || "—";
    const tdValue = document.createElement("td"); tdValue.className = "value-cell"; tdValue.textContent = f.value == null ? "" : String(f.value);
    tr.appendChild(tdStatus); tr.appendChild(tdLabel); tr.appendChild(tdValue);
    els.dAiTbody.appendChild(tr);
  }
}

function setDetailsForm(report, unknownCount) {
  // Prefer the rich filledDetails [{field, label, value}] when present; fall back to the
  // legacy string array (older autofill builds or popup-driven runs).
  details.form.filled   = report?.filledDetails?.length ? report.filledDetails : (report?.filled || []);
  details.form.errors   = report?.errors || [];
  details.form.unknowns = unknownCount || 0;
  renderDetails();
}

function setDetailsAi(diag) {
  details.ai.fields = Array.isArray(diag) ? diag : [];
  details.ai.filled = details.ai.fields.filter((f) => f.status === "filled").length;
  details.ai.errors = details.ai.fields.length - details.ai.filled;
  renderDetails();
}

function setDetailsResult(kind, label) {
  details.result = { kind, label };
  renderDetails();
}

// ─── Server I/O ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// Pushes one log entry to the server JSONL AND mirrors it to the UI. Server is the source of truth;
// the UI append happens whether or not the post succeeds so a server hiccup doesn't blind us live.
async function logStep(job, step, ok, message, data = null) {
  const ts = new Date().toISOString();
  appendLogRow({ ts, step, ok, message });
  try {
    await fetch(`${API_BASE}/queue/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        jobId: job?.id || null,
        company: job?.company || null,
        applyUrl: job?.apply_url || null,
        step, ok,
        error: ok === false ? message : null,
        data,
      }),
    });
  } catch (_) { /* swallow — UI still has the line */ }
}

async function claimNextJob() {
  // Round-robin: rotate greenhouse → ashby → lever. If the picked ATS has no
  // pending fillable jobs left, fall through to the next in the cycle so the
  // loop doesn't stall on an empty bucket.
  // TESTING ONLY — remove once scraper diversity makes forced rotation pointless.
  if (state.ats === "round_robin") {
    for (let i = 0; i < ROUND_ROBIN_ORDER.length; i++) {
      const ats = ROUND_ROBIN_ORDER[(state.rrIndex + i) % ROUND_ROBIN_ORDER.length];
      const { job } = await api(`/queue/next?ats=${encodeURIComponent(ats)}`);
      if (job) {
        state.rrIndex = (state.rrIndex + i + 1) % ROUND_ROBIN_ORDER.length;
        return job;
      }
    }
    return null;
  }
  const { job } = await api(`/queue/next?ats=${encodeURIComponent(state.ats)}`);
  return job;
}

async function fetchJD(job) {
  const prefix = ID_PREFIX[job.ats];
  if (!prefix) throw new Error(`JD fetch not implemented for ${job.ats}`);
  const rawId = String(job.id).replace(new RegExp(`^${prefix}`), "");
  const { jobDescription, title, company } = await api(
    `/jd/${job.ats}/${encodeURIComponent(job.board_token)}/${encodeURIComponent(rawId)}`
  );
  return { jobDescription, title, company };
}

async function callApply(jobDescription, jobUrl) {
  // force: true — the queue is the authority for "should we drain this URL", not applied_urls.json.
  // recordOnTailor: false — only record applied AFTER a real submit (see /queue/mark-applied), so a
  // failed submit-click can't leave a phantom applied record.
  const res = await fetch(`${API_BASE}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ jobUrl, jobDescription, mode: "dry_run", force: true, recordOnTailor: false }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const body = await res.json(); if (body.error) detail = body.error; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

async function markApplied(jobUrl, applicationId) {
  return api("/queue/mark-applied", {
    method: "POST",
    body: JSON.stringify({ jobUrl, applicationId }),
  });
}

async function fetchResumeAsDataUrl(resumeUrl) {
  const res  = await fetch(resumeUrl);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

async function updateQueue(jobId, status, last_error = null, applicationId = null) {
  return api("/queue/update", {
    method: "POST",
    body: JSON.stringify({ id: jobId, status, last_error, applicationId }),
  });
}

// ─── Tab control ──────────────────────────────────────────────────────────────
function openTabAndWaitForLoad(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: state.watchMode }, (tab) => {
      let done = false;
      const cleanup = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); };
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete" && !done) {
          done = true; cleanup(); resolve(tab.id);
        }
      };
      const timer = setTimeout(() => {
        if (!done) { done = true; cleanup(); reject(new Error("tab load timeout")); }
      }, TAB_LOAD_TIMEOUT_MS);
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

function closeTab(tabId) {
  return new Promise((resolve) => chrome.tabs.remove(tabId, resolve));
}

async function injectAutofill(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["lib/match.js", "autofill.js"],
  });
}

function sendMessage(tabId, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), timeoutMs);
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(response);
    });
  });
}

// ─── AI fallback (re-use shared lib/resolve.js localResolveField + bestOptionMatch) ─────
async function resolveAndFillUnknowns(tabId, unknownFields, jobDescription, profileData) {
  const resolved = [];
  const needsAi  = [];

  for (const field of unknownFields) {
    const answer = localResolveField(field, profileData);
    if (answer !== null) {
      const hasOptions = Array.isArray(field.options) && field.options.length > 0;
      if (!hasOptions || bestOptionMatch(field.options, answer) >= 0) {
        resolved.push({ selector: field.selector, value: answer, fieldType: field.fieldType });
        continue;
      }
    }
    needsAi.push(field);
  }

  const BATCH = 3;
  for (let i = 0; i < needsAi.length; i += BATCH) {
    const batch   = needsAi.slice(i, i + BATCH);
    const answers = await Promise.all(batch.map(async (f) => {
      try {
        const res = await fetch(`${API_BASE}/ai-resolve-field`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: JSON.stringify({ ...f, contextHtml: jobDescription }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.answer ?? null;
      } catch (_) { return null; }
    }));
    for (let j = 0; j < batch.length; j++) {
      if (answers[j] != null && answers[j] !== "") {
        resolved.push({ selector: batch[j].selector, value: answers[j], fieldType: batch[j].fieldType });
      }
    }
  }

  if (resolved.length === 0) return { aiFilled: 0, aiErrors: 0, aiFieldsDiag: [] };
  const resp = await sendMessage(tabId, { type: "FILL_AI_FIELDS", fields: resolved }, AUTOFILL_TIMEOUT_MS);
  return {
    aiFilled:      resp?.aiFilled?.length || 0,
    aiErrors:      resp?.aiErrors?.length || 0,
    aiFieldsDiag:  resp?.aiFieldsDiag || [],
  };
}

// ─── Per-job pipeline ─────────────────────────────────────────────────────────
async function processJob(job) {
  state.current = job;
  setCurrent(job, "starting");
  resetDetails(job);
  await logStep(job, "claim", true, `${job.title} @ ${job.company}`);

  let tabId, jd, applyData, resumePdf;

  // 1. JD fetch
  try {
    setCurrent(job, "fetching JD");
    jd = await fetchJD(job);
    if (!jd.jobDescription) throw new Error("empty JD");
    await logStep(job, "jd", true, `${jd.jobDescription.length} chars`);
  } catch (err) {
    await logStep(job, "jd", false, err.message);
    await updateQueue(job.id, "error", `jd: ${err.message}`);
    state.counts.errors += 1;
    setDetailsResult("err", `JD fetch failed — ${err.message}`);
    return;
  }

  // 2. Tailor + adapter + profile
  try {
    setCurrent(job, "tailoring");
    applyData = await callApply(jd.jobDescription, job.apply_url);
    if (!applyData.adapter) throw new Error("no adapter for url");
    await logStep(job, "tailor", true, `applicationId=${applyData.applicationId}`);
  } catch (err) {
    await logStep(job, "tailor", false, err.message);
    await updateQueue(job.id, "error", `tailor: ${err.message}`);
    state.counts.errors += 1;
    setDetailsResult("err", `Tailor failed — ${err.message}`);
    return;
  }

  // 3. Download PDF
  try {
    setCurrent(job, "preparing resume");
    resumePdf = await fetchResumeAsDataUrl(applyData.resumeUrl);
    await logStep(job, "pdf", true, "ready");
  } catch (err) {
    await logStep(job, "pdf", false, err.message);
    await updateQueue(job.id, "error", `pdf: ${err.message}`, applyData.applicationId);
    state.counts.errors += 1;
    setDetailsResult("err", `PDF failed — ${err.message}`);
    return;
  }

  // 4. Open tab + wait for load
  try {
    setCurrent(job, "opening tab");
    tabId = await openTabAndWaitForLoad(job.apply_url);
    await logStep(job, "open_tab", true, `tabId=${tabId}`);
  } catch (err) {
    await logStep(job, "open_tab", false, err.message);
    await updateQueue(job.id, "error", `open_tab: ${err.message}`, applyData.applicationId);
    state.counts.errors += 1;
    setDetailsResult("err", `Open tab failed — ${err.message}`);
    return;
  }

  // 5. Inject + FILL_FORM
  let report, unknownFields;
  try {
    setCurrent(job, "filling form");
    await injectAutofill(tabId);
    const resp = await sendMessage(tabId, {
      type: "FILL_FORM",
      adapter: applyData.adapter,
      profileData: applyData.profileData,
      resumePdf,
    }, AUTOFILL_TIMEOUT_MS);
    report = resp?.report || { filled: [], errors: [] };
    unknownFields = resp?.unknownFields || [];
    setDetailsForm(report, unknownFields.length);
    await logStep(job, "fill_form", true,
      `filled=${report.filled.length} errors=${report.errors.length} unknowns=${unknownFields.length}`,
      { report, unknownCount: unknownFields.length });
  } catch (err) {
    await logStep(job, "fill_form", false, err.message);
    await updateQueue(job.id, "error", `fill_form: ${err.message}`, applyData.applicationId);
    state.counts.errors += 1;
    setDetailsResult("err", `Fill form failed — ${err.message}`);
    if (tabId) await closeTab(tabId);
    return;
  }

  // 6. AI fallback for unknowns
  try {
    setCurrent(job, "AI fallback");
    const { aiFilled, aiErrors, aiFieldsDiag } = await resolveAndFillUnknowns(tabId, unknownFields, jd.jobDescription, applyData.profileData);
    setDetailsAi(aiFieldsDiag);
    // Persist the full per-field {label, value, status} table so we can audit AI answers after the tab closes.
    await logStep(job, "fill_ai", true, `ai_filled=${aiFilled} ai_errors=${aiErrors}`, { fields: aiFieldsDiag });
  } catch (err) {
    await logStep(job, "fill_ai", false, err.message);
    // not fatal — try to submit anyway
  }

  // 7. Submit (or dry-run)
  if (state.dryRun) {
    await logStep(job, "submit", true, "DRY-RUN — fill complete, not submitting");
    await updateQueue(job.id, "pending", "dry-run completed", applyData.applicationId); // put back in queue
    state.counts.skipped += 1;
    setDetailsResult("skip", "Dry-run — not submitted");
  } else {
    try {
      setCurrent(job, "submitting");
      const resp = await sendMessage(tabId, { type: "FILL_SUBMIT" }, AUTOFILL_TIMEOUT_MS);
      if (resp?.submitted) {
        await logStep(job, "submit", true, "submitted");
        await updateQueue(job.id, "done", null, applyData.applicationId);
        try { await markApplied(job.apply_url, applyData.applicationId); } catch (_) { /* queue status is source of truth */ }
        state.counts.applied += 1;
        tallyApplied(job);
        setDetailsResult("ok", "Submitted");
      } else {
        const reason = resp?.reason || "unknown";
        await logStep(job, "submit", false, reason);
        await updateQueue(job.id, "error", `submit: ${reason}`, applyData.applicationId);
        state.counts.errors += 1;
        setDetailsResult("err", `Submit failed — ${reason}`);
      }
    } catch (err) {
      await logStep(job, "submit", false, err.message);
      await updateQueue(job.id, "error", `submit: ${err.message}`, applyData.applicationId);
      setDetailsResult("err", `Submit error — ${err.message}`);
      state.counts.errors += 1;
    }
  }

  // 8. Close tab + brief settle
  await new Promise((r) => setTimeout(r, 1500)); // let any post-submit redirects settle for observability
  if (tabId) await closeTab(tabId);
  state.current = null;
}

// ─── Main loop ────────────────────────────────────────────────────────────────
function jitterMs() {
  return Math.floor(JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
}

async function loop() {
  state.running = true;
  state.stopRequested = false;
  clearError();
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  setStatus("running", "Running");

  let done = 0;
  while (state.running && !state.stopRequested && done < state.target) {
    let job;
    try {
      job = await claimNextJob();
    } catch (err) {
      showError(`Queue claim failed: ${err.message}`);
      await logStep(null, "claim", false, err.message);
      break;
    }
    if (!job) {
      await logStep(null, "claim", false, "no pending fillable jobs");
      showError(`No pending fillable jobs in queue (filter: ${state.ats}).`);
      break;
    }

    try {
      await processJob(job);
    } catch (err) {
      // Defensive — processJob handles its own errors, but if anything escapes we don't kill the loop.
      await logStep(job, "fatal", false, err.message);
      state.counts.errors += 1;
    }
    updateStats();
    done += 1;

    if (state.stopRequested || done >= state.target) break;

    // Jitter
    const wait = jitterMs();
    setCurrent(null);
    setStatus("running", `Waiting ${Math.round(wait/1000)}s before next job…`);
    await new Promise((r) => setTimeout(r, wait));
  }

  state.running = false;
  setCurrent(null);
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  setStatus(state.counts.errors > 0 ? "error" : "stopped", state.stopRequested ? "Stopped" : "Done");
}

// ─── Wire up controls ─────────────────────────────────────────────────────────
els.startBtn.addEventListener("click", async () => {
  state.target = Math.max(1, parseInt(els.targetCount.value, 10) || 10);
  state.ats = els.atsSelect.value || "all";
  state.dryRun = els.dryRun.checked;
  state.watchMode = els.watchMode.checked;
  state.counts = { applied: 0, skipped: 0, errors: 0 };
  state.byAts = {};
  state.byCompany = {};
  state.rrIndex = 0;
  els.statTarget.textContent = state.target;
  els.atsPill.textContent = ATS_LABELS[state.ats] || state.ats;
  updateStats();
  await loop();
});

els.atsSelect.addEventListener("change", () => {
  els.atsPill.textContent = ATS_LABELS[els.atsSelect.value] || els.atsSelect.value;
});

els.detailsToggle.addEventListener("click", () => {
  const collapsed = els.detailsBody.style.display === "none";
  els.detailsBody.style.display = collapsed ? "" : "none";
  els.detailsToggle.textContent = collapsed ? "Hide" : "Show";
});

els.stopBtn.addEventListener("click", () => {
  state.stopRequested = true;
  setStatus("stopped", "Stopping after current job…");
});

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  els.statTarget.textContent = els.targetCount.value;
  setStatus("stopped", "Idle — click Start Applying");
  updateStats();
})();
