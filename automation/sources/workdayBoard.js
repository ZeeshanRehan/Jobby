// ─── Workday Board Source ────────────────────────────────────────────────────
// Pulls open roles from a Workday tenant's public board API. Workday is multi-
// tenant: each company hosts its own instance at {tenant}.{wd}.myworkdayjobs.com
// where `wd` is the data-center prefix (wd1–wd12) and `tenant` is the company
// slug. Some tenants expose multiple "sites" (External, Corporate_Jobs, ...);
// we treat (tenant, wd, site) as the source tuple.
//
// JD content is fetched lazily at tailoring time, not stored here — same policy
// as the GH/Ashby/Lever sources.

const WD_API = (tenant, wd, site) =>
  `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;

const APPLY_BASE = (tenant, wd, site) =>
  `https://${tenant}.${wd}.myworkdayjobs.com/${site}`;

// Page size — Workday will cap to 20 regardless of what we ask for above that.
const PAGE_LIMIT = 20;

// Only roles on a Workday-hosted instance are directly fillable by our adapter.
function isFillable(absoluteUrl) {
  try {
    return /\.myworkdayjobs\.com$/.test(new URL(absoluteUrl).host);
  } catch {
    return false;
  }
}

function normalizeJob(job, tuple) {
  const { tenant, wd, site } = tuple;
  const now = new Date().toISOString();
  // job.externalPath looks like "/job/USA-Remote/Senior-SWE_R-12345" — relative.
  // Convert to absolute URL on the tenant's site root.
  const applyUrl = job.externalPath
    ? `${APPLY_BASE(tenant, wd, site)}${job.externalPath}`
    : null;
  return {
    id:            `workday_${tenant}_${job.bulletFields?.[0] || job.title}_${job.externalPath || ""}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 200),
    ats:           "workday",
    source:        "workday_board",
    board_token:   `${tenant}.${wd}.${site}`,
    company:       tenant,          // Workday API has no display-name field; tenant slug is best we have
    title:         job.title || null,
    location:      job.locationsText || null,
    apply_url:     applyUrl,
    fillable:      isFillable(applyUrl),
    status:        "pending",
    attempts:      0,
    last_error:    null,
    discovered_at: now,
    updated_at:    now,
    // Carry the tuple so /jd/workday/... can fetch JD content without re-parsing the URL.
    workday_tenant: tenant,
    workday_wd:     wd,
    workday_site:   site,
  };
}

// Walks one tenant's paginated list. Stops when an empty page is returned or
// when the safety cap of 5 pages (100 jobs) is hit — most tenants surface their
// freshest roles in the first couple pages, and we'd rather re-run than churn.
async function fetchOneTenant(tuple, stats) {
  const records = [];
  for (let offset = 0; offset < PAGE_LIMIT * 5; offset += PAGE_LIMIT) {
    try {
      const res = await fetch(WD_API(tuple.tenant, tuple.wd, tuple.site), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body:    JSON.stringify({ appliedFacets: {}, limit: PAGE_LIMIT, offset, searchText: "" }),
      });
      if (!res.ok) {
        stats.errors.push({ token: `${tuple.tenant}/${tuple.site}`, status: res.status });
        return records;
      }
      const data = await res.json();
      const jobs = data.jobPostings || [];
      if (jobs.length === 0) return records;
      for (const job of jobs) {
        const record = normalizeJob(job, tuple);
        if (!record.apply_url) continue;
        stats.fetched += 1;
        if (record.fillable) stats.fillable += 1;
        records.push(record);
      }
      if (jobs.length < PAGE_LIMIT) return records;
    } catch (err) {
      stats.errors.push({ token: `${tuple.tenant}/${tuple.site}`, status: err.message });
      return records;
    }
  }
  return records;
}

// Tuples = [{ tenant, wd, site }, ...]
// Returns { records, stats }
async function fetchWorkdayJobs(tuples) {
  const records = [];
  const stats   = { tokens: tuples.length, fetched: 0, fillable: 0, errors: [] };
  for (const tuple of tuples) {
    const r = await fetchOneTenant(tuple, stats);
    records.push(...r);
  }
  return { records, stats };
}

module.exports = { fetchWorkdayJobs, isFillable };
