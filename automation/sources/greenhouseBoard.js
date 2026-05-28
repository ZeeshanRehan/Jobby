// ─── Greenhouse Board Source ─────────────────────────────────────────────────
// Pulls open roles from the public Greenhouse board API and normalizes them into
// queue records. One list fetch per board token gives title/company/location/url
// for free — JD content is fetched lazily at tailoring time, not stored here.

const BOARDS_API = "https://boards-api.greenhouse.io/v1/boards";

// Only roles on Greenhouse's hosted forms are directly fillable by our adapter.
// Custom embedded boards (e.g. stripe.com/jobs) point off-platform — mark unfillable.
const FILLABLE_HOSTS = new Set(["job-boards.greenhouse.io", "boards.greenhouse.io"]);

function isFillable(absoluteUrl) {
  try {
    return FILLABLE_HOSTS.has(new URL(absoluteUrl).host);
  } catch {
    return false;
  }
}

function normalizeJob(job, boardToken) {
  const now = new Date().toISOString();
  return {
    id:            `gh_${job.id}`,
    ats:           "greenhouse",
    source:        "greenhouse_board",
    board_token:   boardToken,
    company:       job.company_name || boardToken,
    title:         job.title || null,
    location:      job.location?.name || null,
    apply_url:     job.absolute_url,
    fillable:      isFillable(job.absolute_url),
    status:        "pending",
    attempts:      0,
    last_error:    null,
    discovered_at: now,
    updated_at:    now,
  };
}

// Returns { records, stats } — stats surfaces the fillable funnel per run
async function fetchGreenhouseJobs(boardTokens) {
  const records = [];
  const stats   = { tokens: boardTokens.length, fetched: 0, fillable: 0, errors: [] };

  for (const token of boardTokens) {
    try {
      const res = await fetch(`${BOARDS_API}/${token}/jobs`);
      if (!res.ok) {
        stats.errors.push({ token, status: res.status });
        continue;
      }
      const { jobs = [] } = await res.json();
      for (const job of jobs) {
        const record = normalizeJob(job, token);
        stats.fetched += 1;
        if (record.fillable) stats.fillable += 1;
        records.push(record);
      }
    } catch (err) {
      stats.errors.push({ token, status: err.message });
    }
  }

  return { records, stats };
}

module.exports = { fetchGreenhouseJobs, isFillable };
