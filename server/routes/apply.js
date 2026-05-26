// ─── Apply Routes ────────────────────────────────────────────────────────────

const express              = require("express");
const { randomUUID }       = require("crypto");
const fs                   = require("fs");
const path                 = require("path");
const { tailorResume, resumeData } = require("../services/groqService");
const { generateResumePdf }        = require("../services/pdfService");
const { uploadPdf }                = require("../services/uploadService");
const { savePdfLocally }           = require("../services/permanentStorage");
const { appendApplication, updateApplication, findApplication } = require("../services/applicationLogger");
const { hasApplied, recordApplication } = require("../services/idempotencyService");
const { profileData }      = require("../data/profile");

const router      = express.Router();
const ADAPTERS_DIR = path.join(__dirname, "../data/adapters");

function detectPlatform(jobUrl) {
  const files = fs.readdirSync(ADAPTERS_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const adapter = JSON.parse(fs.readFileSync(path.join(ADAPTERS_DIR, f), "utf-8"));
    if (adapter.detect.some((pattern) => jobUrl.includes(pattern))) {
      return adapter.platform;
    }
  }
  return "unknown";
}

function loadAdapter(platform) {
  const filePath = path.join(ADAPTERS_DIR, `${platform}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ─── POST /apply ─────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { jobUrl, jobDescription, mode, force } = req.body;

  if (!jobUrl || !jobDescription) {
    return res.status(400).json({ error: "jobUrl and jobDescription are required" });
  }

  // Dedup guard — skips a re-tailor (and its Claude cost) for a URL we've already tailored.
  // This tracks tailoring, not submission. `force: true` overrides it (reposted/updated listing, re-test)
  if (!force) {
    const existing = hasApplied(jobUrl);
    if (existing) {
      const existingRecord = findApplication(existing.applicationId);
      return res.json({ alreadyTailored: true, existingRecord });
    }
  }

  const applicationId = randomUUID();

  // ─── Step 1: AI Tailoring ─────────────────────────────────────────────────
  let tailored;
  try {
    tailored = await tailorResume(jobDescription, jobUrl);
  } catch (err) {
    console.error("[apply - Step 1 Claude] Failed:", err.message);
    return res.status(500).json({ error: "AI tailoring failed", step: "ai_tailoring" });
  }

  // ─── Step 2: PDF Generation ───────────────────────────────────────────────
  let pdfBuffer;
  try {
    pdfBuffer = await generateResumePdf(resumeData, tailored);
  } catch (err) {
    console.error("[apply - Step 2 PDF] Failed:", err.message);
    return res.status(500).json({ error: "PDF generation failed", step: "pdf_generation" });
  }

  // ─── Step 3: Supabase Upload ──────────────────────────────────────────────
  let resumeUrl;
  try {
    resumeUrl = await uploadPdf(pdfBuffer, `resume_${applicationId}.pdf`);
  } catch (err) {
    console.error("[apply - Step 3 Upload] Failed:", err.message);
    return res.status(500).json({ error: "Supabase upload failed", step: "upload" });
  }

  // ─── Step 4: Permanent Local Copy ────────────────────────────────────────
  let resumeLocalPath;
  try {
    resumeLocalPath = savePdfLocally(pdfBuffer, applicationId);
  } catch (err) {
    console.error("[apply - Step 4 Local Save] Failed:", err.message);
    return res.status(500).json({ error: "Local PDF save failed", step: "local_save" });
  }

  // ─── Step 5: Platform + Adapter ──────────────────────────────────────────
  const platform = detectPlatform(jobUrl);
  const adapter  = loadAdapter(platform);

  // ─── Step 6: Record Application ──────────────────────────────────────────
  const applicationRecord = {
    applicationId,
    timestamp: new Date().toISOString(),
    jobUrl,
    jobTitle: null,  // populated by extension in M3+
    company: null,   // populated by extension in M3+
    platform,
    status: "tailored",
    mode: mode || "dry_run",
    resumeUrl,
    resumeLocalPath,
    changesMade: tailored.changesMade || null,
    keywordsInjected: tailored.skillsToAdd || [],
    coverageReport: { filled: [], skipped: [], unknown: [], stale: [], errors: [] },
  };

  appendApplication(applicationRecord);
  recordApplication(jobUrl, applicationId);

  res.json({
    applicationId,
    resumeUrl,
    resumeLocalPath,
    adapter,
    profileData,
    applicationRecord,
  });
});

// ─── POST /apply/log ──────────────────────────────────────────────────────────

router.post("/log", (req, res) => {
  const { applicationId, status, coverageReport, errors } = req.body;

  if (!applicationId || !status) {
    return res.status(400).json({ error: "applicationId and status are required" });
  }

  try {
    const updated = updateApplication(applicationId, {
      status,
      coverageReport: coverageReport || null,
      errors: errors || [],
    });
    res.json({ success: true, record: updated });
  } catch (err) {
    console.error("[apply/log] Failed:", err.message);
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
