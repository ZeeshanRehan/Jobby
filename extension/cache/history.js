// ─── Application History Cache ────────────────────────────────────────────────
const APPLIED_KEY  = "jobby_applied_urls";
const PDF_REFS_KEY = "jobby_pdf_refs";
const MAX_PDF_REFS = 5;

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).toLowerCase().replace(/\/$/, "");
  } catch (_) {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

// Returns { timestamp, applicationId } if URL was previously applied, null otherwise
async function isUrlApplied(url) {
  const key    = normalizeUrl(url);
  const stored = await chrome.storage.local.get(APPLIED_KEY);
  const applied = stored[APPLIED_KEY] || {};
  return applied[key] || null;
}

async function markUrlApplied(url, applicationId, timestamp) {
  const key    = normalizeUrl(url);
  const stored = await chrome.storage.local.get(APPLIED_KEY);
  const applied = stored[APPLIED_KEY] || {};
  applied[key] = { timestamp: timestamp || new Date().toISOString(), applicationId };
  await chrome.storage.local.set({ [APPLIED_KEY]: applied });
}

// Stores a PDF reference keyed by applicationId; evicts oldest when over LRU limit
async function savePdfReference(applicationId, url) {
  const stored = await chrome.storage.local.get(PDF_REFS_KEY);
  const refs   = stored[PDF_REFS_KEY] || {};
  refs[applicationId] = { url, timestamp: new Date().toISOString() };
  const entries = Object.entries(refs);
  if (entries.length > MAX_PDF_REFS) {
    entries.sort((a, b) => new Date(a[1].timestamp) - new Date(b[1].timestamp));
    entries.slice(0, entries.length - MAX_PDF_REFS).forEach(([id]) => delete refs[id]);
  }
  await chrome.storage.local.set({ [PDF_REFS_KEY]: refs });
}
