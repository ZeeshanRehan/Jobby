// ─── Queue Routes ────────────────────────────────────────────────────────────
// Powers the in-browser drain controller:
//   GET  /queue/next  — claim the next pending fillable job (atomically marks in_progress)
//   POST /queue/update — patch a job's status (done, error, pending)
//   POST /queue/log    — append one drain.jsonl event
//   GET  /queue/log    — tail last N events (for the controller UI)
//   GET  /queue/stats  — counts by status, for the UI header
// All routes mounted under apiKeyAuth in server.js.

const express = require("express");

const { readQueue, writeQueue, updateStatus } = require("../../automation/queue/queue");
const { hasApplied, recordApplication } = require("../services/idempotencyService");
const { logEvent, tail } = require("../services/drainLogger");

const router = express.Router();

// Claim the next pending fillable job. `ats` filter optional — pass an explicit ATS
// ("greenhouse" | "ashby" | "lever") to scope the claim, or omit / pass "all" to claim
// across every source. Atomic: marks the claimed record `in_progress` so a second
// concurrent claimer (e.g. a controller in two tabs) won't grab the same job.
router.get("/next", (req, res) => {
  const ats = req.query.ats;
  const queue = readQueue();
  const matchesAts = (r) => !ats || ats === "all" || r.ats === ats;
  const idx = queue.findIndex((r) =>
    matchesAts(r) && r.fillable && r.status === "pending" && !hasApplied(r.apply_url)
  );
  if (idx === -1) return res.json({ job: null });

  queue[idx].status     = "in_progress";
  queue[idx].attempts   = (queue[idx].attempts || 0) + 1;
  queue[idx].updated_at = new Date().toISOString();
  writeQueue(queue);

  res.json({ job: queue[idx] });
});

// Patch a job's status. Body: { id, status, last_error?, applicationId? }
router.post("/update", (req, res) => {
  const { id, status, last_error = null, applicationId = null } = req.body || {};
  if (!id || !status) return res.status(400).json({ error: "id and status required" });
  const patch = { last_error };
  if (applicationId) patch.applicationId = applicationId;
  const record = updateStatus(id, status, patch);
  if (!record) return res.status(404).json({ error: "job not found" });
  res.json({ job: record });
});

// Append a drain log entry. Body: { jobId, company, applyUrl, step, ok?, error?, data?, durationMs? }
router.post("/log", (req, res) => {
  const entry = logEvent(req.body || {});
  res.json({ entry });
});

// Tail the log. ?n=50 default.
router.get("/log", (req, res) => {
  const n = Math.max(1, Math.min(500, parseInt(req.query.n, 10) || 50));
  res.json({ entries: tail(n) });
});

// Drain calls this after FILL_SUBMIT confirms a real submit. Splitting record-on-submit from
// record-on-tailor (see apply.js recordOnTailor flag) means a failed submit-click no longer
// poisons applied_urls.json — only actual submissions are recorded.
router.post("/mark-applied", (req, res) => {
  const { jobUrl, applicationId } = req.body || {};
  if (!jobUrl || !applicationId) return res.status(400).json({ error: "jobUrl and applicationId required" });
  recordApplication(jobUrl, applicationId);
  res.json({ ok: true });
});

// Flip login-blocked jobs back to pending after a one-time manual sign-in. A login
// wall (e.g. Workday's per-tenant SSO) can't be crossed unattended, so the drain
// parks those jobs as `needs_login` instead of burning them as `error`. Once the
// session persists in the Chrome profile, this re-arms them for the next run.
// Body: { ats? } — scope to one ATS, or omit/`all` for every source. Returns { reactivated }.
router.post("/reactivate", (req, res) => {
  const { ats } = req.body || {};
  const queue = readQueue();
  let reactivated = 0;
  for (const r of queue) {
    if (r.status !== "needs_login") continue;
    if (ats && ats !== "all" && r.ats !== ats) continue;
    r.status     = "pending";
    r.updated_at = new Date().toISOString();
    reactivated += 1;
  }
  if (reactivated) writeQueue(queue);
  res.json({ reactivated });
});

// Summary for the controller's header — total / pending / in_progress / done / error
router.get("/stats", (req, res) => {
  const ats = req.query.ats;
  const queue = readQueue();
  const counts = { total: 0, pending: 0, in_progress: 0, done: 0, error: 0, fillable: 0 };
  for (const r of queue) {
    if (ats && r.ats !== ats) continue;
    counts.total += 1;
    if (r.fillable) counts.fillable += 1;
    counts[r.status] = (counts[r.status] || 0) + 1;
  }
  res.json({ counts });
});

module.exports = router;
