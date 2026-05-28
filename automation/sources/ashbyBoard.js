// ─── Ashby Board Source ──────────────────────────────────────────────────────
// Pulls open roles from the public Ashby job board API and normalizes them into
// queue records. The list endpoint already includes descriptionHtml — but per the
// queue policy we don't store JD content here (heavy + stales fast). The drain
// loop re-lists at tailoring time via /jd/ashby/:org/:id.

const ASHBY_API = "https://api.ashbyhq.com/posting-api/job-board";

// Only roles on Ashby's hosted forms are directly fillable by our adapter.
const FILLABLE_HOSTS = new Set(["jobs.ashbyhq.com"]);

function isFillable(absoluteUrl) {
  try {
    return FILLABLE_HOSTS.has(new URL(absoluteUrl).host);
  } catch {
    return false;
  }
}

function normalizeJob(job, org) {
  const now = new Date().toISOString();
  const applyUrl = job.applyUrl || (job.jobUrl ? `${job.jobUrl}/application` : null);
  return {
    id:            `ashby_${job.id}`,
    ats:           "ashby",
    source:        "ashby_board",
    board_token:   org,
    company:       org, // Ashby payload has no display name field; org slug is best we have
    title:         job.title || null,
    location:      job.location || job.secondaryLocations?.[0] || null,
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
async function fetchAshbyJobs(orgs) {
  const records = [];
  const stats   = { tokens: orgs.length, fetched: 0, fillable: 0, errors: [] };

  for (const org of orgs) {
    try {
      const res = await fetch(`${ASHBY_API}/${encodeURIComponent(org)}?includeCompensation=false`);
      if (!res.ok) {
        stats.errors.push({ token: org, status: res.status });
        continue;
      }
      const { jobs = [] } = await res.json();
      for (const job of jobs) {
        if (job.isListed === false) continue; // Ashby exposes draft/unlisted via the same endpoint
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

module.exports = { fetchAshbyJobs, isFillable };
