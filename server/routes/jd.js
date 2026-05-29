// ─── Job Description Fetcher ─────────────────────────────────────────────────
// Queue records don't store JD content (too heavy + stale fast). The drain loop
// pulls it lazily here at tailoring time.
//   GET /jd/greenhouse/:token/:id  →  { title, company, location, jobDescription }
// JD is HTML-stripped; tailorResume will further process.

const express = require("express");

const router = express.Router();

const GH_BOARDS_API = "https://boards-api.greenhouse.io/v1/boards";
const ASHBY_API     = "https://api.ashbyhq.com/posting-api/job-board";
const LEVER_API     = "https://api.lever.co/v0/postings";
// Workday: per-tenant data-center prefix (wd1-wd12) + site slug — see jd.js workday route below.

function stripHtml(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

router.get("/greenhouse/:token/:id", async (req, res) => {
  const { token, id } = req.params;
  try {
    const url = `${GH_BOARDS_API}/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}?content=true`;
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: `greenhouse API ${r.status}` });
    const job = await r.json();
    res.json({
      title:    job.title || null,
      company:  job.company_name || token,
      location: job.location?.name || null,
      jobDescription: stripHtml(job.content || ""),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ashby's single-job endpoint requires auth, so we re-list the org and find by id.
// One extra HTTP per drained job — acceptable for low-volume drain.
router.get("/ashby/:org/:id", async (req, res) => {
  const { org, id } = req.params;
  try {
    const r = await fetch(`${ASHBY_API}/${encodeURIComponent(org)}?includeCompensation=false`);
    if (!r.ok) return res.status(r.status).json({ error: `ashby API ${r.status}` });
    const { jobs = [] } = await r.json();
    const job = jobs.find((j) => j.id === id);
    if (!job) return res.status(404).json({ error: "job not found in board listing" });
    res.json({
      title:    job.title || null,
      company:  org,
      location: job.location || null,
      jobDescription: stripHtml(job.descriptionHtml || ""),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/lever/:org/:id", async (req, res) => {
  const { org, id } = req.params;
  try {
    const r = await fetch(`${LEVER_API}/${encodeURIComponent(org)}/${encodeURIComponent(id)}?mode=json`);
    if (!r.ok) return res.status(r.status).json({ error: `lever API ${r.status}` });
    const job = await r.json();
    res.json({
      title:    job.text || null,
      company:  org,
      location: job.categories?.location || null,
      jobDescription: job.descriptionPlain || stripHtml(job.description || ""),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Workday's job-detail endpoint sits next to the listing endpoint:
//   GET https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{externalPath}
// We pass the externalPath as a single URL-encoded segment to avoid path-parsing it.
router.get("/workday/:tenant/:wd/:site/*", async (req, res) => {
  const { tenant, wd, site } = req.params;
  // Everything after /:site/ is the externalPath (which itself contains slashes).
  const externalPath = "/" + req.params[0];
  try {
    const url = `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/job${externalPath}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return res.status(r.status).json({ error: `workday API ${r.status}` });
    const job = await r.json();
    res.json({
      title:    job.jobPostingInfo?.title || null,
      company:  tenant,
      location: job.jobPostingInfo?.location || null,
      jobDescription: stripHtml(job.jobPostingInfo?.jobDescription || ""),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
