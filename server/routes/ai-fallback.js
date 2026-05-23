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
  const { preferences, workAuthorization, voluntaryDisclosure, contact, education, defaultAnswers } = profileData;

  // Pass safe slices only — demographics never reach this function
  const safeProfile = {
    contact: {
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
      portfolioUrl: contact.portfolioUrl,
    },
    workAuthorization,
    education,
    preferences,
    voluntaryDisclosure,
    defaultAnswers,
  };

  return `You are an AI assistant filling a job application form field.
Return JSON only: { "answer": <string|null>, "confidence": "high"|"medium"|"low", "reasoning": <string> }

LOOKUP ORDER:
1. profile.contact / workAuthorization / education / preferences — direct match
2. profile.defaultAnswers — find the semantically closest key and use its value
3. If truly ambiguous with no safe default, return confidence "low"

RULES:
- For select/radio fields, your answer MUST exactly match one of the provided options (case-insensitive) — never return text outside the options list
- For yes/no selects, map "Yes"/"No" answers to the closest matching option
- For acknowledgement/consent fields, answer "Yes" or use the confirmation option
- confidence "high" = direct answer from profile
- confidence "medium" = matched via defaultAnswers or close inference
- confidence "low" = genuinely cannot determine a reasonable answer
- Never return "No information available" — if in doubt, pick the safest default from defaultAnswers

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
