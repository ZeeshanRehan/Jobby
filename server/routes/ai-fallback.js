// ─── AI Field Resolution Route ───────────────────────────────────────────────

const express         = require("express");
const Groq            = require("groq-sdk");
const { profileData } = require("../data/profile");

const router = express.Router();
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Demographics, salary, and professional references are never AI-resolved
const SENSITIVE_KEYWORDS = [
  "race", "ethnicity", "gender", "sex", "veteran", "disability",
  "salary", "compensation", "wage", "references",
];

function isSensitiveField(label) {
  const lower = label.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

function buildFieldPrompt(label, fieldType, contextHtml, options) {
  const { preferences, workAuthorization, voluntaryDisclosure, contact, education } = profileData;

  // Pass safe slices only — demographics never reach this function
  const safeProfile = {
    preferences,
    workAuthorization,
    voluntaryDisclosure,
    contact: {
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
      portfolioUrl: contact.portfolioUrl,
    },
    education,
  };

  return `You are an AI assistant filling a job application form field.
Return JSON only: { "answer": <string|null>, "confidence": "high"|"medium"|"low", "reasoning": <string> }

RULES:
- Only answer using the profile data — never invent information
- For radio/select fields, return exactly one of the provided options (matched case-sensitively)
- confidence "high" = clear direct answer in profile data
- confidence "medium" = reasonable inference from profile
- confidence "low" = no clear match

Profile:
${JSON.stringify(safeProfile, null, 2)}

Field label: ${label}
Field type: ${fieldType}
${options ? `Options: ${JSON.stringify(options)}` : ""}
${contextHtml ? `Context: ${contextHtml.slice(0, 500)}` : ""}`;
}

router.post("/", async (req, res) => {
  const { label, fieldType, contextHtml, options } = req.body;

  if (!label || !fieldType) {
    return res.status(400).json({ error: "label and fieldType are required" });
  }

  // Sensitive guard runs before any Groq call — CRITICAL check
  if (isSensitiveField(label)) {
    return res.json({ answer: null, confidence: "low", reasoning: "sensitive field, ask user" });
  }

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "You output valid JSON only. No markdown, no backticks, no preamble.",
        },
        {
          role: "user",
          content: buildFieldPrompt(label, fieldType, contextHtml, options),
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from Groq");

    const clean = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    res.json(JSON.parse(clean));
  } catch (err) {
    console.error("[ai-resolve-field] Failed:", err.message);
    res.status(500).json({ error: "AI field resolution failed", details: err.message });
  }
});

module.exports = router;
