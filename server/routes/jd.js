// ─── Job Description Fetcher ─────────────────────────────────────────────────
// Queue records don't store JD content (too heavy + stale fast). The drain loop
// pulls it lazily here at tailoring time.
//   GET /jd/greenhouse/:token/:id  →  { title, company, location, jobDescription }
// JD is HTML-stripped; tailorResume will further process.

const express = require("express");

const router = express.Router();

const GH_BOARDS_API = "https://boards-api.greenhouse.io/v1/boards";

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

module.exports = router;
