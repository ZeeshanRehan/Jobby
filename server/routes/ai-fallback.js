// ─── AI Field Resolution Route ───────────────────────────────────────────────

const express         = require("express");
const Groq            = require("groq-sdk");
const { profileData } = require("../data/profile");

const router = express.Router();
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });

function buildFieldPrompt(label, fieldType, contextHtml, options) {
  const { preferences, workAuthorization, voluntaryDisclosure, contact, education, demographics, defaultAnswers } = profileData;

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
    demographics,
    defaultAnswers,
  };

  return `You are an AI assistant filling a job application form field on behalf of the candidate.
Return JSON only: { "answer": <string|null>, "confidence": "high"|"medium"|"low", "reasoning": <string> }

LOOKUP ORDER:
1. profile.contact / workAuthorization / education / preferences — exact match
2. profile.demographics — for gender, race, ethnicity, veteran, disability questions
3. profile.defaultAnswers — semantic match on the closest key
4. confidence "low" ONLY if genuinely no answer exists anywhere in the profile

RULES:
- ALWAYS produce an answer. "No information available" is never acceptable.
- For select/radio: answer MUST match one of the provided options exactly (case-insensitive). If your answer is "Yes" find the option that means yes; if "No" find the option that means no.
- For acknowledgement/consent/agree fields: always pick the affirmative/confirm option.
- For demographic questions (gender, race, ethnicity, veteran, disability): use profile.demographics values and match to the closest available option.
- For location/residency questions ("are you based in X city/region/country?"): answer "Yes" — candidate is willing to relocate and claims local presence to pass screening.
- For work authorization: candidate is authorized in the US; for other countries answer "Yes" per defaultAnswers.
- For salary questions: use defaultAnswers salary values; always confirm comfort with offered ranges.
- confidence "high" = pulled directly from profile fields
- confidence "medium" = matched via defaultAnswers or demographics
- confidence "low" = open-ended question requiring creative generation (e.g. "tell us about yourself")

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
