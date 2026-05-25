// ─── Idempotency Service ─────────────────────────────────────────────────────
// Prevents duplicate tailoring runs for the same job URL, saving Claude tokens.

const fs   = require("fs");
const path = require("path");

const APPLIED_URLS_PATH = path.join(__dirname, "../data/applied_urls.json");

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.origin + parsed.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

function readAppliedUrls() {
  return JSON.parse(fs.readFileSync(APPLIED_URLS_PATH, "utf-8"));
}

// Returns { timestamp, applicationId } if already applied, null otherwise
function hasApplied(url) {
  const normalized = normalizeUrl(url);
  const applied = readAppliedUrls();
  return applied[normalized] || null;
}

function recordApplication(url, applicationId) {
  const normalized = normalizeUrl(url);
  const applied = readAppliedUrls();
  applied[normalized] = { timestamp: new Date().toISOString(), applicationId };
  fs.writeFileSync(APPLIED_URLS_PATH, JSON.stringify(applied, null, 2));
}

module.exports = { normalizeUrl, hasApplied, recordApplication };
