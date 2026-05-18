const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const baseResume = `
Name: Zeshan Rehan
Role: Computer Science student and full-stack developer
Skills: JavaScript, React, Node.js, Express, MongoDB, Git, REST APIs
Projects:
- Built full-stack web apps using React, Node, Express, and MongoDB.
- Built APIs with authentication, validation, and database integration.
- Worked on browser-based and backend projects.
`;

async function tailorResume(jobDescription, jobUrl) {
  const response = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: `
You are an expert resume tailoring assistant.

Rules:
- Do not invent fake experience.
- Do not invent fake companies.
- Only tailor based on the provided resume.
- Use keywords from the job description naturally.
- Return JSON only.
- No markdown.
- No backticks.
        `,
      },
      {
        role: "user",
        content: `
BASE RESUME:
${baseResume}

JOB URL:
${jobUrl}

JOB DESCRIPTION:
${jobDescription}

Return JSON with this exact shape:
{
  "tailoredSummary": "",
  "skillsToHighlight": [],
  "tailoredBullets": [],
  "keywordsMatched": [],
  "warnings": []
}
        `,
      },
    ],
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;

  return JSON.parse(content);
}

module.exports = {
  tailorResume,
};
