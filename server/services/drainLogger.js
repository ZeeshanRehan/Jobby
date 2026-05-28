// ─── Drain Logger ────────────────────────────────────────────────────────────
// Append-only JSONL log for the drain loop. One line per step transition per job
// (claim → jd → tailor → open_tab → fill_form → fill_ai → submit → done|error).
// Sync append so concurrent writers (drain controller + manual /apply runs) can't
// interleave. JSONL — not JSON — so a crash mid-line at worst loses one entry.

const fs   = require("fs");
const path = require("path");

const LOG_PATH = path.join(__dirname, "../data/drain.jsonl");

// Ensure the file exists on first write (touch). Avoids ENOENT on the first appendFileSync.
function ensureFile() {
  try { fs.accessSync(LOG_PATH); }
  catch { fs.writeFileSync(LOG_PATH, ""); }
}

function logEvent({ jobId, company, applyUrl, step, ok = true, error = null, data = null, durationMs = null }) {
  ensureFile();
  const entry = {
    ts: new Date().toISOString(),
    jobId, company, applyUrl, step, ok,
    ...(error      != null ? { error }      : {}),
    ...(data       != null ? { data }       : {}),
    ...(durationMs != null ? { durationMs } : {}),
  };
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  return entry;
}

// Reads the last N entries — used by the drain controller's UI tail
function tail(n = 50) {
  try {
    const raw = fs.readFileSync(LOG_PATH, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { logEvent, tail, LOG_PATH };
