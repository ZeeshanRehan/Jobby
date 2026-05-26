// ─── AI Field Resolution Route ───────────────────────────────────────────────

const express         = require("express");
const Anthropic       = require("@anthropic-ai/sdk");
const { profileData } = require("../data/profile");

const router    = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFieldPrompt(label, fieldType, contextHtml, options) {
  const {
    contact, workAuthorization, education, preferences,
    voluntaryDisclosure, demographics, bio, projects, defaultAnswers,
  } = profileData;

  const safeProfile = {
    contact: {
      email:        contact.email,
      phone:        contact.phone,
      linkedinUrl:  contact.linkedinUrl,
      portfolioUrl: contact.portfolioUrl,
    },
    workAuthorization,
    education,
    preferences,
    voluntaryDisclosure,
    demographics,
    bio,
    projects,
    defaultAnswers,
  };

  return `You are filling a job application form field on behalf of this candidate. Always produce an answer.
Return JSON only: { "answer": <string>, "confidence": "high"|"medium"|"low", "reasoning": <string> }

═══ LOOKUP ORDER ═══
1. profile.contact / workAuthorization / education / preferences — for direct data fields
2. profile.demographics — for gender, race, ethnicity, veteran status, disability
3. profile.defaultAnswers — semantic match for yes/no, legal, location, consent, compensation questions
4. profile.bio + profile.projects — for all open-ended / generative questions (see routing below)

═══ OPEN-ENDED QUESTION ROUTING ═══
Match the field label to the correct source and write a response accordingly:

• "tell me about yourself" / "introduce yourself" / "about you" / "background":
  → Use profile.bio.summary (2–3 sentences max unless field clearly wants more)

• "walk me through your background" / "describe your experience" / longer background fields:
  → Use profile.bio.careerNarrative

• "why do you want to work here" / "what excites you about this role" / "why [company]" / "why are you interested":
  → Read the job description context carefully. Write 2–3 sentences that:
     (a) name something specific about what this company does or stands for
     (b) connect it concretely to profile.bio.strengths or profile.projects
     Never write generic enthusiasm — always tie to something real in the context.

• "what is your proudest accomplishment" / "most impactful project" / "tell us about a project":
  → Lead with PPST for healthcare/impact angle (deployed in 2 hospitals, thousands of patients)
  → Lead with Jobby for AI/tech/automation angle
  → Use profile.projects[n].highlights for specifics

• "what are your strengths" / "what do you bring" / "why should we hire you":
  → Pick 2–3 items from profile.bio.strengths most relevant to the field label context

• "where do you see yourself in 5 years" / "career goals" / "long-term aspirations":
  → Use profile.bio.careerGoal

• "what motivates you" / "what are you passionate about" / "why did you get into this field":
  → Use profile.bio.motivation

• "describe a challenge you overcame" / "difficult project" / "obstacle you faced":
  → Use profile.bio.challengeNarrative

• "how do you work" / "describe your work style" / "team or independent":
  → Use profile.bio.workStyle

• "what skills do you bring" / "relevant experience for this role":
  → Pull from profile.bio.strengths + most relevant project from profile.projects

• technical / role-specific knowledge questions ("what are the standard components in...", "describe your process for...", "how do you approach...", "what does a typical X look like", "what experience do you have with X"):
  → Answer as a knowledgeable practitioner. Use general domain knowledge for the methodology/process question, then anchor to profile.projects or profile.bio where relevant.
  → 2–4 sentences, specific and concrete. Do NOT give a "why I'm interested" answer — the question is asking the candidate to demonstrate knowledge, not motivation.

═══ HARD RULES ═══
- ALWAYS produce a non-empty answer. Null is not acceptable unless the field is physically unanswerable.
- For select/radio: answer MUST exactly match one of the provided options (case-insensitive). Map Yes/No to the matching option text.
- For acknowledgement/consent/agree fields: always pick the affirmative option.
- For demographics: use profile.demographics and match to the closest available option.
- For US location questions ("are you based in [US city/state]?"): answer Yes — candidate can relocate anywhere in the US.
- For non-US location questions (Canada, UK, Singapore, etc.): answer No per defaultAnswers.
- For work authorization: Yes for US, No for other countries per defaultAnswers.
- For salary: use defaultAnswers values; always confirm comfort with the offered range.
- confidence "high" = pulled directly from profile fields
- confidence "medium" = matched from defaultAnswers, demographics, or generated from bio/projects
- confidence "low" = used ONLY when there is truly nothing to draw from (rare)
- Even at confidence "low", still produce the best possible answer — never return empty.

═══ PROFILE ═══
${JSON.stringify(safeProfile, null, 2)}

═══ FIELD ═══
Label: ${label}
Type: ${fieldType}
${options       ? `Options: ${JSON.stringify(options)}`           : ""}
${contextHtml   ? `Job description context:\n${stripHtml(contextHtml).slice(0, 2000)}` : ""}`;
}

router.post("/", async (req, res) => {
  const { label, fieldType, contextHtml, options } = req.body;

  if (!label || !fieldType) {
    return res.status(400).json({ error: "label and fieldType are required" });
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      temperature: 0.15,
      system: "You output valid JSON only. No markdown, no backticks, no preamble.",
      messages: [
        { role: "user", content: buildFieldPrompt(label, fieldType, contextHtml, options) },
      ],
    });

    const content = response.content[0]?.text;
    if (!content) throw new Error("Empty response from Claude");

    const clean = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(clean);
    // Only suppress if the model explicitly returned null — low confidence still gets filled
    if (!parsed.answer) parsed.answer = null;
    res.json(parsed);
  } catch (err) {
    console.error("[ai-resolve-field] Failed:", err.message);
    res.status(500).json({ error: "AI field resolution failed", details: err.message });
  }
});

module.exports = router;
