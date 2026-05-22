// ─── Application Logger ──────────────────────────────────────────────────────
// Synchronous read/write to prevent interleaved writes on concurrent requests.

const fs   = require("fs");
const path = require("path");

const APPLICATIONS_PATH = path.join(__dirname, "../data/applications.json");

function readApplications() {
  return JSON.parse(fs.readFileSync(APPLICATIONS_PATH, "utf-8"));
}

function appendApplication(record) {
  const records = readApplications();
  records.push(record);
  fs.writeFileSync(APPLICATIONS_PATH, JSON.stringify(records, null, 2));
}

function updateApplication(applicationId, updates) {
  const records = readApplications();
  const idx = records.findIndex((r) => r.applicationId === applicationId);
  if (idx === -1) throw new Error(`Application not found: ${applicationId}`);
  records[idx] = { ...records[idx], ...updates };
  fs.writeFileSync(APPLICATIONS_PATH, JSON.stringify(records, null, 2));
  return records[idx];
}

function findApplication(applicationId) {
  return readApplications().find((r) => r.applicationId === applicationId) || null;
}

module.exports = { readApplications, appendApplication, updateApplication, findApplication };
