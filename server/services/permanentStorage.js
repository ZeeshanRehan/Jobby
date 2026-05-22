// ─── Permanent Storage ───────────────────────────────────────────────────────
// Saves PDF buffer to VPS disk so signed URLs expiring doesn't lose the file.

const fs   = require("fs");
const path = require("path");

const RESUMES_DIR = path.join(__dirname, "../data/resumes");

function savePdfLocally(pdfBuffer, applicationId) {
  const localPath = path.join(RESUMES_DIR, `${applicationId}.pdf`);
  fs.writeFileSync(localPath, pdfBuffer);
  return localPath;
}

module.exports = { savePdfLocally };
