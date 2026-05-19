const express = require("express");
const { tailorResume, resumeData } = require("../services/groqService");
const { generateResumePdf }        = require("../services/pdfService");
const { uploadPdf }                = require("../services/uploadService");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { jobDescription, jobUrl } = req.body;

    if (!jobDescription) {
      return res.status(400).json({
        success: false,
        error: "jobDescription is required",
      });
    }

    // Step 1 — Groq tailors the resume
    const tailored = await tailorResume(jobDescription, jobUrl);

    // Step 2 — Puppeteer renders tailored data + resumeData into a PDF buffer
    const pdfBuffer = await generateResumePdf(resumeData, tailored);

    // Step 3 — Upload buffer to Supabase, get back a signed URL
    // Filename uses timestamp so concurrent requests never collide
    const filename    = `resume_${Date.now()}.pdf`;
    const downloadUrl = await uploadPdf(pdfBuffer, filename);

    // Step 4 — Return everything to the client
    res.json({
      success: true,
      jobUrl,
      downloadUrl,
      result: tailored,
    });

  } catch (error) {
    console.error("Tailor resume error:", error.message, error.stack);

    res.status(500).json({
      success: false,
      error: "Failed to tailor resume",
    });
  }
});

module.exports = router;
