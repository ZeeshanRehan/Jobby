const express = require("express");
const { tailorResume, resumeData } = require("../services/groqService");
const { generateResumePdf }        = require("../services/pdfService");
const { uploadPdf }                = require("../services/uploadService");

const router = express.Router();

router.post("/", async (req, res) => {
  // ─── Step 1: AI Tailoring ─────────────────────────────────────────────────
// Send jobDescription + jobUrl to Groq. Returns structured JSON with
// tailoredExperience, tailoredProjects, skillsToAdd, warnings.
// Fails if Groq API is down, key is invalid, or response isn't valid JSON.
let tailored;
try {
  tailored = await tailorResume(jobDescription, jobUrl);
} catch (err) {
  console.error("[Step 1 - Groq] Failed:", err.message);
  return res.status(500).json({
    success: false,
    step: "ai_tailoring",
    error: "AI tailoring failed — check Groq API key or model availability",
  });
}

// ─── Step 2: PDF Generation ───────────────────────────────────────────────
// Puppeteer renders the HTML resume template with tailored data injected.
// Fails if Chromium dependencies are missing on VPS or template file not found.
let pdfBuffer;
try {
  pdfBuffer = await generateResumePdf(resumeData, tailored);
} catch (err) {
  console.error("[Step 2 - PDF] Failed:", err.message);
  return res.status(500).json({
    success: false,
    step: "pdf_generation",
    error: "PDF generation failed — check Puppeteer/Chromium setup on VPS",
  });
}

// ─── Step 3: Upload to Supabase ───────────────────────────────────────────
// Uploads PDF buffer to Supabase Storage bucket "Resumes".
// Filename is timestamped to prevent collisions on concurrent requests.
// Fails if SUPABASE_URL/ANON_KEY are wrong or bucket permissions are off.
let downloadUrl;
try {
  const filename = `resume_${Date.now()}.pdf`;
  downloadUrl = await uploadPdf(pdfBuffer, filename);
} catch (err) {
  console.error("[Step 3 - Upload] Failed:", err.message);
  return res.status(500).json({
    success: false,
    step: "upload",
    error: "Supabase upload failed — check bucket name, URL, and anon key permissions",
  });
}

});

module.exports = router;
