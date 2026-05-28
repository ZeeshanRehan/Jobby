// ─── Lever Board Source ──────────────────────────────────────────────────────
// Pulls open roles from the public Lever postings API and normalizes them into
// queue records. JD content is fetched lazily at tailoring time, not stored here.

const LEVER_API = "https://api.lever.co/v0/postings";

// Only roles on Lever's hosted forms are directly fillable by our adapter.
const FILLABLE_HOSTS = new Set(["jobs.lever.co"]);

function isFillable(absoluteUrl) {
  try {
    return FILLABLE_HOSTS.has(new URL(absoluteUrl).host);
  } catch {
    return false;
  }
}

function normalizeJob(job, org) {
  const now = new Date().toISOString();
  const applyUrl = job.applyUrl || (job.hostedUrl ? `${job.hostedUrl}/apply` : null);
  return {
    id:            `lever_${job.id}`,
    ats:           "lever",
    source:        "lever_board",
    board_token:   org,
    company:       org, // Lever payload has no company display field; org slug is best we have
    title:         job.text || null,
    location:      job.categories?.location || job.categories?.allLocations?.[0] || null,
    apply_url:     applyUrl,
    fillable:      isFillable(applyUrl),
    status:        "pending",
    attempts:      0,
    last_error:    null,
    discovered_at: now,
    updated_at:    now,
  };
}

// Returns { records, stats }
async function fetchLeverJobs(orgs) {
  const records = [];
  const stats   = { tokens: orgs.length, fetched: 0, fillable: 0, errors: [] };

  for (const org of orgs) {
    try {
      const res = await fetch(`${LEVER_API}/${encodeURIComponent(org)}?mode=json`);
      if (!res.ok) {
        stats.errors.push({ token: org, status: res.status });
        continue;
      }
      const jobs = await res.json();
      if (!Array.isArray(jobs)) {
        stats.errors.push({ token: org, status: "non-array response" });
        continue;
      }
      for (const job of jobs) {
        const record = normalizeJob(job, org);
        if (!record.apply_url) continue;
        stats.fetched += 1;
        if (record.fillable) stats.fillable += 1;
        records.push(record);
      }
    } catch (err) {
      stats.errors.push({ token: org, status: err.message });
    }
  }

  return { records, stats };
}

module.exports = { fetchLeverJobs, isFillable };
