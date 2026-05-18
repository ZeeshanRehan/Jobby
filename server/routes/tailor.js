const express = require("express");

const router = express.Router();

router.post("/", async (req, res) => {
  const { jobDescription, jobUrl } = req.body;

  console.log("Received JD");
  console.log(jobUrl);

  res.json({
    success: true,
    message: "Tailor route working",
    received: {
      jobDescriptionLength: jobDescription?.length || 0,
      jobUrl
    }
  });
});

module.exports = router;