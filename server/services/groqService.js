const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ─── Structured Resume (Source of Truth) ────────────────────────────────────
// This object is the single source of truth for all resume content.
// pdfService.js reads this directly — keep it accurate and up to date.

const resumeData = {
  name: "Zeshan Rehan",
  contact: {
    email: "zeeshanrehan12345@gmail.com",
    phone: "+1-856-526-2323",
    linkedin: "Zeshan Rehan",
    portfolio: "imzeshan.com",
    github: "ZeeshanRehan",
  },
  education: {
    school: "Rowan University",
    location: "Glassboro, New Jersey",
    degree: "B.S. in Computer Science",
    graduation: "May 2026",
    coursework: [
      "Data Structures & Algorithms",
      "Full-Stack Engineering",
      "Software Engineering",
      "Object-Oriented Programming",
      "Database Systems",
      "Cloud Computing with AWS",
      "Machine Learning",
      "Artificial Intelligence",
    ],
  },
  skills: {
    programming: [
      "Python", "JavaScript", "TypeScript", "HTML/CSS",
      "PHP", "SQL", "C++", "C", "Java",
    ],
    frameworks: [
      "React.js", "React Native", "Node.js", "Express.js",
      "Django", "ASP.NET", "Angular", "Firebase",
      "MongoDB", "Redis", "Tailwind CSS", "Bootstrap",
      "REST APIs", "GraphQL", "Android Development",
    ],
    devops: [
      "AWS (Lambda, ECS)", "Azure", "Docker", "Terraform",
      "Git/GitHub", "CI/CD", "Agile", "Postman", "Linux",
    ],
  },
  experience: [
    {
      company: "InvolveMINT Inc.",
      location: "Hybrid, Develop For Good",
      role: "Design Manager",
      startDate: "Oct 2025",
      endDate: "Present",
      bullets: [
        "Leading a cross-functional team of 6 designers and product contributors to architect a new end-to-end communication system for involveMINT's mutual-credit marketplace.",
        "Redesigned inquiry, response, and negotiation flows using Figma, React-based prototypes, and structured UX templates for 100+ active small businesses on the platform.",
        "Collaborated with product and engineering teams to remove friction in the discovery-to-deal pipeline, projected to increase transaction conversion rates from ~35% to over 60%, directly impacting 2,500–10,000 community members.",
      ],
    },
    {
      company: "Rowan University Housing Department",
      location: "Glassboro, New Jersey",
      role: "Housing Preparation Assistant (HPA)",
      startDate: "May 2025",
      endDate: "Sept 2025",
      bullets: [
        "Assisted in preparing 500+ residential units for incoming students by managing room assignments and verifying occupancy data using internal housing management systems.",
        "Identified and corrected 100+ database inconsistencies, improving the accuracy of housing reports and reducing last-minute room change requests by 35%.",
      ],
    },
  ],
  projects: [
    {
      name: "SkillSwap – Community Works for All",
      role: "Full-Stack Developer",
      startDate: "Nov 2024",
      endDate: "Dec 2024",
      stack: ["MERN stack"],
      links: { demo: "#", github: "#" }, // replace # with real URLs
      bullets: [
        "Spearheaded a hyper-local webapp using the MERN stack to help communities share skills, services, and help.",
        "Gained 50+ active users from university by presenting at campus Hackathon and student-led showcases.",
        "Launched a crypto alt-token $EAGLES as a form of currency amongst members.",
      ],
    },
    {
      name: "Lyra – AI-Powered Music Discovery",
      role: "Full-Stack Developer",
      startDate: "Jun 2025",
      endDate: "Jul 2025",
      stack: ["React.js", "Node.js", "Express", "MongoDB", "GPT-4"],
      links: { demo: "#", github: "#" }, // replace # with real URLs
      bullets: [
        "Built a full-stack music recommendation platform using React.js, Node.js, Express, MongoDB, and GPT-4, allowing users to describe feelings and receive curated YouTube song recommendations.",
        "Delivered 2,000+ personalized song suggestions to early users in the first week of beta, with average session durations exceeding 4.5 minutes.",
      ],
    },
  ],
  activities: [
    {
      org: "SkillSwap — Temple University",
      location: "Glassboro, New Jersey",
      role: "Team Lead",
      date: "September 2025",
      bullets: [
        "Awarded 3rd place in OwlHacks at Temple University for SkillSwap in the Philly Local Innovation track, recognized for its impact-driven approach to community skill sharing.",
      ],
    },
    {
      org: "Pahal (Non-Profit Organization), LPU",
      location: "Punjab, India",
      role: "Secretary",
      date: "Mar 2023 – Aug 2023",
      bullets: [
        "Organized outreach programs and community initiatives as part of a student-led NGO.",
        "Coordinated with volunteers, managed logistics, and contributed to event planning for freshmen.",
      ],
    },
  ],
};

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(jobDescription, jobUrl) {
  return `
You are an expert ATS-focused resume tailoring assistant.

TASK:
Tailor the resume below to match the job description. Your job is to:
- Sprinkle JD keywords into existing bullets naturally
- Add missing JD keywords to the skills section
- Never fabricate new roles, companies, or metrics

STRICT RULES:
1. NEVER invent new bullets, roles, companies, or experiences.
   Only reword existing bullets to mirror JD language and keywords.
   If a bullet has no relevance to the JD, keep it unchanged.

2. NEVER change, round, or soften any metric.
   "~35% to over 60%", "2,500–10,000", "2,000+", "35%", "100+", "500+", "50+"
   must appear exactly as written if used. Never paraphrase numbers.

3. SKILLS are the primary keyword injection point.
   - skillsToAdd: JD keywords and tools not in the resume but worth adding.
     Include things the candidate may have touched but never listed.
     Also include adjacent skills worth studying to close the gap.
     Be generous — this list is for candidate awareness, not all need to go on resume.

4. EXPERIENCE tailoring:
   - For each role, only reword existing bullets using JD language.
   - Keep the same meaning, same metrics, same structure.
   - If a role has no relevance to the JD, return its bullets unchanged.
   - Subtle keyword injection only — max 1-2 words changed per bullet.
   - Weave keywords into the middle of bullets naturally — never append   them as a clause at the end.

5. PROJECTS tailoring:
   - Same rules as experience. Reword only, never invent.

6. tailoredSummary:
   - Max 2 sentences. Professional tone only.
   - No filler: "excited", "passionate", "confident", "I am", "I believe".
   - Open with role/identity + top 2 JD-matched skills.
   - End with one real metric from the resume.
   - Return empty string if the JD is a genuinely poor fit.
   - Never use the word "metric". Write the number naturally in context.

7. warnings:
   - Flag JD requirements with zero coverage in the resume.
   - Be specific. Max 4 items, max 12 words each.

8. Return valid JSON only. No markdown. No backticks. No explanation.

BASE RESUME:
${JSON.stringify(resumeData, null, 2)}

JOB URL:
${jobUrl || "Not provided"}

JOB DESCRIPTION:
${jobDescription}

Return JSON with EXACTLY this shape — no extra fields, no missing fields:
{
  "tailoredSummary": "2 sentence summary or empty string if poor fit",
  "skillsToAdd": ["skill1", "skill2"],
  "tailoredExperience": {
    "InvolveMINT Inc.": [
      "reworded bullet 1",
      "reworded bullet 2",
      "reworded bullet 3"
    ],
    "Rowan University Housing Department": [
      "reworded bullet 1",
      "reworded bullet 2"
    ]
  },
  "tailoredProjects": {
    "SkillSwap – Community Works for All": [
      "reworded bullet 1",
      "reworded bullet 2",
      "reworded bullet 3"
    ],
    "Lyra – AI-Powered Music Discovery": [
      "reworded bullet 1",
      "reworded bullet 2"
    ]
  },
  "warnings": ["warning 1", "warning 2"]
}
`.trim();
}

// ─── Main Service Function ───────────────────────────────────────────────────

async function tailorResume(jobDescription, jobUrl) {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.15,
    messages: [
      {
        role: "system",
        content:
          "You are an expert ATS resume tailoring assistant. You output valid JSON only. No markdown, no backticks, no preamble. You never invent experience. You only reword what exists.",
      },
      {
        role: "user",
        content: buildPrompt(jobDescription, jobUrl),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from Groq");
  }

  // Strip any accidental markdown fences before parsing
  const clean = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(clean);
}

module.exports = {
  tailorResume,
  resumeData,
};