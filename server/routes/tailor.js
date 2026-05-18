const express = require("express");
const { tailorResume } = require("../services/groqService");

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

    const result = await tailorResume(jobDescription, jobUrl);

    res.json({
      success: true,
      jobUrl,
      result,
    });
  } catch (error) {
    console.error("Tailor resume error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to tailor resume",
    });
  }
});

module.exports = router;