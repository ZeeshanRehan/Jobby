// ─── Job Queue ───────────────────────────────────────────────────────────────
// JSON-backed queue of jobs to apply to. ATS-agnostic: every source emits the
// same record shape (see greenhouseBoard.normalizeJob), the drain loop dispatches
// on `ats`. Writes are atomic (tmp + rename) since the scraper and the drain loop
// are separate writers.

const fs   = require("fs");
const path = require("path");

const { hasApplied } = require("../../server/services/idempotencyService");

const QUEUE_PATH = path.join(__dirname, "../../server/data/queue.json");

function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
  } catch {
    return [];
  }
}

// Atomic so a mid-write crash can't corrupt the queue
function writeQueue(queue) {
  const tmp = `${QUEUE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2));
  fs.renameSync(tmp, QUEUE_PATH);
}

// Adds records not already queued and not already applied to.
// Returns { added, dupQueue, dupApplied }
function enqueue(records) {
  const queue   = readQueue();
  const queued  = new Set(queue.map((r) => r.id));
  const stats   = { added: 0, dupQueue: 0, dupApplied: 0 };

  for (const record of records) {
    if (queued.has(record.id)) {
      stats.dupQueue += 1;
      continue;
    }
    if (hasApplied(record.apply_url)) {
      stats.dupApplied += 1;
      continue;
    }
    queue.push(record);
    queued.add(record.id);
    stats.added += 1;
  }

  writeQueue(queue);
  return stats;
}

// Patches a record's status (+ optional fields like last_error) for the drain loop
function updateStatus(id, status, patch = {}) {
  const queue = readQueue();
  const record = queue.find((r) => r.id === id);
  if (!record) return null;
  record.status     = status;
  record.updated_at = new Date().toISOString();
  Object.assign(record, patch);
  writeQueue(queue);
  return record;
}

module.exports = { readQueue, writeQueue, enqueue, updateStatus, QUEUE_PATH };
