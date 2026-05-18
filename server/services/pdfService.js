const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const TEMPLATE_PATH = path.join(__dirname, "../templates/resume.html");

// ─── HTML Builders ───────────────────────────────────────────────────────────
// Each function takes structured data and returns an HTML string chunk.
// These replace the {{BLOCK}} tokens in resume.html.

function buildSummaryBlock(summary) {
  if (!summary) return "";
  return `
    <div class="section">
      <div class="section-title">Summary</div>
      <div class="summary">${summary}</div>
    </div>
  `;
}

function buildSkillsBlock(baseSkills, skillsToAdd) {
  // Merge skillsToAdd into programming row (deduped, lowercased compare)
  const existing = new Set(
    [...baseSkills.programming, ...baseSkills.frameworks, ...baseSkills.devops]
      .map((s) => s.toLowerCase())
  );
  const newSkills = skillsToAdd.filter((s) => !existing.has(s.toLowerCase()));

  const programming = [...baseSkills.programming, ...newSkills].join(", ");
  const frameworks  = baseSkills.frameworks.join(", ");
  const devops      = baseSkills.devops.join(", ");

  return `
    <div class="skills-row"><strong>Languages:</strong> ${programming}</div>
    <div class="skills-row"><strong>Frameworks & Tools:</strong> ${frameworks}</div>
    <div class="skills-row"><strong>DevOps & Cloud:</strong> ${devops}</div>
  `;
}

function buildExperienceBlock(experienceList, tailoredExperience) {
  return experienceList.map((job) => {
    // Use tailored bullets if present, else fall back to originals
    const bullets = tailoredExperience[job.company] || job.bullets;
    const bulletHtml = bullets.map((b) => `<li>${b}</li>`).join("\n");

    return `
      <div class="entry">
        <div class="entry-header">
          <div>
            <span class="entry-title">${job.company}</span> —
            <span class="entry-role">${job.role}</span>
          </div>
          <div class="entry-date">${job.startDate} – ${job.endDate}</div>
        </div>
        <ul>${bulletHtml}</ul>
      </div>
    `;
  }).join("\n");
}

function buildProjectsBlock(projectsList, tailoredProjects) {
  return projectsList.map((proj) => {
    const bullets = tailoredProjects[proj.name] || proj.bullets;
    const bulletHtml = bullets.map((b) => `<li>${b}</li>`).join("\n");
    const stackLine = proj.stack?.length
      ? `<div class="entry-stack">${proj.stack.join(", ")}</div>`
      : "";

    return `
      <div class="entry">
        <div class="entry-header">
          <div>
            <span class="entry-title">${proj.name}</span> —
            <span class="entry-role">${proj.role}</span>
          </div>
          <div class="entry-date">${proj.startDate} – ${proj.endDate}</div>
        </div>
        ${stackLine}
        <ul>${bulletHtml}</ul>
      </div>
    `;
  }).join("\n");
}

// ─── Template Injector ───────────────────────────────────────────────────────

function buildHtml(resumeData, tailored) {
  let html = fs.readFileSync(TEMPLATE_PATH, "utf-8");

  const { contact, education, skills, experience, projects } = resumeData;
  const { tailoredSummary, skillsToAdd, tailoredExperience, tailoredProjects } = tailored;

  // Simple token replacement for scalar fields
  html = html
    .replace("{{NAME}}",           resumeData.name)
    .replace("{{EMAIL}}",          contact.email)
    .replace("{{PHONE}}",          contact.phone)
    .replace("{{PORTFOLIO}}",      contact.portfolio)
    .replace("{{LINKEDIN_SLUG}}",  contact.linkedin)
    .replace("{{GITHUB}}",         contact.github)
    .replace("{{EDU_SCHOOL}}",     education.school)
    .replace("{{EDU_DEGREE}}",     education.degree)
    .replace("{{EDU_GRAD}}",       education.graduation)
    .replace("{{EDU_COURSEWORK}}", education.coursework.join(", "));

  // Block replacements (dynamic HTML chunks)
  html = html
    .replace("{{SUMMARY_BLOCK}}",    buildSummaryBlock(tailoredSummary))
    .replace("{{SKILLS_BLOCK}}",     buildSkillsBlock(skills, skillsToAdd))
    .replace("{{EXPERIENCE_BLOCK}}", buildExperienceBlock(experience, tailoredExperience))
    .replace("{{PROJECTS_BLOCK}}",   buildProjectsBlock(projects, tailoredProjects));

  return html;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

async function generateResumePdf(resumeData, tailored) {
  const html = buildHtml(resumeData, tailored);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"], // required on Linux VPS
  });

  try {
    const page = await browser.newPage();

    // Load HTML directly as a string — no file server needed
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
    });

    return pdfBuffer;
  } finally {
    // Always close the browser even if pdf() throws
    await browser.close();
  }
}

module.exports = { generateResumePdf };
