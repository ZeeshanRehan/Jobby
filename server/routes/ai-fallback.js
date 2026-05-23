// ─── AI Field Resolution Route ───────────────────────────────────────────────

const express         = require("express");
const Groq            = require("groq-sdk");
const { profileData } = require("../data/profile");

const router = express.Router();
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Only hard demographic fields are blocked — salary/comp questions are safe to answer
const SENSITIVE_KEYWORDS = [
  "race", "ethnicity", "gender", "sex", "veteran", "disability",
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
- Use profile data as the primary source; if the profile has no direct answer, pick the most defensible default
- For legal agreement questions (non-compete, NDA, arbitration) where the profile is silent, default to "No"
- For salary comfort questions ("are you comfortable with $X?"), default to "Yes"
- For select/radio fields return exactly one of the provided options — never return text not in the options list
- confidence "high" = direct answer from profile data
- confidence "medium" = reasonable inference or clear defensible default
- confidence "low" = genuine ambiguity — no profile data and no safe default exists
- Never return "No information available" — always give a best-effort answer

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

    const parsed = JSON.parse(clean);
    // Suppress low-confidence answers — let the user fill those manually
    if (parsed.confidence === "low") parsed.answer = null;
    res.json(parsed);
  } catch (err) {
    console.error("[ai-resolve-field] Failed:", err.message);
    res.status(500).json({ error: "AI field resolution failed", details: err.message });
  }
});

module.exports = router;
