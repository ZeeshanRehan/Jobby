// ─── Constants ───────────────────────────────────────────────────────────────
const API_URL    = "http://178.105.161.45:3000/tailor-resume";
const TIMEOUT_MS = 120_000; // Groq + Puppeteer can take 30-60s
const STORAGE_KEY = "lastResult";

// ─── DOM References ───────────────────────────────────────────────────────────
const stateIdle    = document.getElementById("state-idle");
const stateLoading = document.getElementById("state-loading");
const stateSuccess = document.getElementById("state-success");
const stateError   = document.getElementById("state-error");

const elCurrentUrl    = document.getElementById("current-url");
const elLoadingStep   = document.getElementById("loading-step");
const elBulletsCount  = document.getElementById("bullets-count");
const elSkillsCount   = document.getElementById("skills-count");
const elSkillsList    = document.getElementById("skills-list");
const elChangesBlock  = document.getElementById("changes-block");
const elChangesCount  = document.getElementById("changes-count");
const elChangesList   = document.getElementById("changes-list");
const elWarningsBlock = document.getElementById("warnings-block");
const elWarningsList  = document.getElementById("warnings-list");
const elDownloadStatus = document.getElementById("download-status");
const elRestoredNote  = document.getElementById("restored-note");
const elErrorStep     = document.getElementById("error-step");
const elErrorMsg      = document.getElementById("error-msg");

const btnTailor = document.getElementById("btn-tailor");
const btnReset  = document.getElementById("btn-reset");
const btnRetry  = document.getElementById("btn-retry");
const btnBack   = document.getElementById("btn-back");

const elPlatformLine   = document.getElementById("platform-line");
const elPlatformName   = document.getElementById("platform-name");
const elAlreadyApplied = document.getElementById("already-applied");

const stateAutofill    = document.getElementById("state-autofill");
const elAfFilledCount  = document.getElementById("af-filled-count");
const elAfStaleCount   = document.getElementById("af-stale-count");
const elAfErrorsCount  = document.getElementById("af-errors-count");
const elAfStaleBlock   = document.getElementById("af-stale-block");
const elAfStaleList    = document.getElementById("af-stale-list");
const elAfErrorsBlock  = document.getElementById("af-errors-block");
const elAfErrorsList   = document.getElementById("af-errors-list");

const btnAutofill      = document.getElementById("btn-autofill");
const btnAutofillBack  = document.getElementById("btn-autofill-back");

// ─── State Management ─────────────────────────────────────────────────────────
let currentTab = null;

function showState(state) {
  [stateIdle, stateLoading, stateSuccess, stateError, stateAutofill].forEach((s) =>
    s.classList.add("hidden")
  );
  state.classList.remove("hidden");
}

function showError(step, message) {
  elErrorStep.textContent = step;
  elErrorMsg.textContent  = message;
  showState(stateError);
}

// ─── Success Renderer ─────────────────────────────────────────────────────────
// isRestored = true when loading from storage rather than a fresh API call
function renderSuccess(data, isRestored = false) {
  const bulletsReworded = data.bulletsReworded || [];
  const skillsAdded     = data.skillsAdded     || [];
  const warnings        = data.warnings        || [];

  elBulletsCount.textContent = bulletsReworded.length;
  elSkillsCount.textContent  = skillsAdded.length;
  elSkillsList.textContent   = skillsAdded.length > 0 ? skillsAdded.join(", ") : "";

  // ── Bullet changes collapsible ───────────────────────────────────────────
  if (bulletsReworded.length > 0) {
    elChangesCount.textContent = bulletsReworded.length;
    elChangesList.innerHTML = bulletsReworded.map(({ section, original, tailored }) => `
      <div class="change-entry">
        <div class="change-section-label">${section}</div>
        <div class="change-row">
          <span class="change-badge before-badge">Before</span>
          <span class="change-text">${original}</span>
        </div>
        <div class="change-row">
          <span class="change-badge after-badge">After</span>
          <span class="change-text after-text">${tailored}</span>
        </div>
      </div>
    `).join("");
    elChangesBlock.classList.remove("hidden");
  } else {
    elChangesBlock.classList.add("hidden");
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  if (warnings.length > 0) {
    elWarningsList.innerHTML = warnings.map((w) => `<li>${w}</li>`).join("");
    elWarningsBlock.classList.remove("hidden");
  } else {
    elWarningsBlock.classList.add("hidden");
  }

  // ── Download / restore note ───────────────────────────────────────────────
  if (isRestored) {
    elDownloadStatus.textContent = "";
    elRestoredNote.textContent   = "Showing last session — click Tailor Another to start fresh";
  } else {
    elDownloadStatus.textContent = "✓ Saved as resume_tailored.pdf";
    elRestoredNote.textContent   = "";
  }

  showState(stateSuccess);
}

// ─── Storage ──────────────────────────────────────────────────────────────────
async function saveResult(bulletsReworded, skillsAdded, warnings) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: { bulletsReworded, skillsAdded, warnings, savedAt: Date.now() },
  });
}

async function clearResult() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

async function loadSavedResult() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || null;
}

// ─── Scraping ─────────────────────────────────────────────────────────────────
async function scrapeCurrentTab(tabId) {
  // Inject content.js — idempotent due to __jobbyInjected guard in content.js
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (err) {
    throw new Error(`Cannot inject into this page: ${err.message}`);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Content script did not respond within 10 seconds"));
    }, 10_000);

    chrome.tabs.sendMessage(tabId, { type: "SCRAPE_JOB" }, (response) => {
      clearTimeout(timeout);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      if (!response?.text) {
        reject(new Error("Page returned empty text — try reloading the page"));
        return;
      }

      resolve(response.text);
    });
  });
}

// ─── API Request ──────────────────────────────────────────────────────────────
async function callTailorApi(jobDescription, jobUrl) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobDescription, jobUrl }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw { step: "network", message: "Request timed out after 2 minutes" };
    }
    throw { step: "network", message: `Connection failed: ${err.message}` };
  }

  clearTimeout(timeoutId);

  if (!response.ok) {
    let detail = `Server returned ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) detail = body.error;
    } catch (_) {
      // use the status-only message if body isn't parseable
    }
    throw { step: "api", message: detail };
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw { step: "parsing", message: "Server returned invalid JSON" };
  }

  if (!data.success) {
    throw { step: "api", message: data.error || "Server reported failure" };
  }

  return data;
}

// ─── Autofill API ─────────────────────────────────────────────────────────────
async function callApplyApi(jobDescription, jobUrl) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${API_BASE}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ jobUrl, jobDescription, mode: "dry_run" }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw { step: "network", message: "Request timed out after 2 minutes" };
    }
    throw { step: "network", message: `Connection failed: ${err.message}` };
  }

  clearTimeout(timeoutId);

  if (!response.ok) {
    let detail = `Server returned ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) detail = body.error;
    } catch (_) {}
    throw { step: "api", message: detail };
  }

  return response.json();
}

// Fetches the resume PDF and returns it as a base64 dataURL
// Done in the popup (not the content script) to avoid Supabase CORS issues
async function fetchResumeAsDataUrl(resumeUrl) {
  const res  = await fetch(resumeUrl);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

// Injects autofill.js then sends FILL_FORM — returns the coverage report
async function injectAndFill(tabId, adapter, profileData, resumePdf) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["autofill.js"] });
  } catch (err) {
    throw { step: "injection", message: `Cannot inject into this page: ${err.message}` };
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject({ step: "autofill", message: "Autofill timed out — page may have navigated" });
    }, 10_000);

    chrome.tabs.sendMessage(
      tabId,
      { type: "FILL_FORM", adapter, profileData, resumePdf },
      (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject({ step: "autofill", message: chrome.runtime.lastError.message });
          return;
        }
        resolve(response?.report || { filled: [], stale: [], skipped: [], errors: [] });
      }
    );
  });
}

// ─── Autofill Success Renderer ────────────────────────────────────────────────
function renderAutofillSuccess(report) {
  const { filled = [], stale = [], errors = [] } = report;

  elAfFilledCount.textContent = filled.length;
  elAfStaleCount.textContent  = stale.length;
  elAfErrorsCount.textContent = errors.length;

  if (stale.length > 0) {
    elAfStaleList.innerHTML = stale.map((f) => `<li>${f}</li>`).join("");
    elAfStaleBlock.classList.remove("hidden");
  } else {
    elAfStaleBlock.classList.add("hidden");
  }

  if (errors.length > 0) {
    elAfErrorsList.innerHTML = errors
      .map(({ field, message }) => `<li>${field}: ${message}</li>`)
      .join("");
    elAfErrorsBlock.classList.remove("hidden");
  } else {
    elAfErrorsBlock.classList.add("hidden");
  }

  showState(stateAutofill);
}

// ─── Download ─────────────────────────────────────────────────────────────────
async function downloadResume(downloadUrl) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: downloadUrl, filename: "resume_tailored.pdf", saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(downloadId);
      }
    );
  });
}

// ─── Autofill Flow ────────────────────────────────────────────────────────────
async function runAutofill() {
  const { id: tabId, url: tabUrl } = currentTab;

  showState(stateLoading);
  elLoadingStep.textContent = "Scraping job description...";

  // ── Step 1: Scrape ────────────────────────────────────────────────────────
  let jobDescription;
  try {
    jobDescription = await scrapeCurrentTab(tabId);
  } catch (err) {
    showError("scraping", err.message);
    return;
  }

  // ── Step 2: Tailor + generate PDF ────────────────────────────────────────
  elLoadingStep.textContent = "Tailoring & generating resume...";

  let applyData;
  try {
    applyData = await callApplyApi(jobDescription, tabUrl);
  } catch (err) {
    showError(err.step, err.message);
    return;
  }

  if (applyData.alreadyApplied) {
    showError("already applied", "This URL is already on record. Click Back to continue.");
    return;
  }

  const { applicationId, resumeUrl, adapter, profileData } = applyData;

  if (!adapter) {
    showError("adapter", "No adapter found for this job board — autofill is not supported here.");
    return;
  }

  // ── Step 3: Fetch PDF as dataURL (popup context avoids CORS issues) ───────
  elLoadingStep.textContent = "Preparing resume...";

  let resumePdf;
  try {
    resumePdf = await fetchResumeAsDataUrl(resumeUrl);
  } catch (err) {
    showError("resume fetch", `Could not load resume PDF: ${err.message}`);
    return;
  }

  // ── Step 4: Inject autofill.js and fill fields ────────────────────────────
  elLoadingStep.textContent = "Filling form...";

  let report;
  try {
    report = await injectAndFill(tabId, adapter, profileData, resumePdf);
  } catch (err) {
    showError(err.step, err.message);
    return;
  }

  // ── Step 5: Log coverage report (fire and forget) ─────────────────────────
  fetch(`${API_BASE}/apply/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      applicationId,
      status: "filled",
      coverageReport: {
        filled:  report.filled,
        skipped: report.skipped || [],
        unknown: [],
        stale:   report.stale,
        errors:  report.errors,
      },
    }),
  }).catch(() => {});

  // ── Step 6: Persist ───────────────────────────────────────────────────────
  await markUrlApplied(tabUrl, applicationId);
  await savePdfReference(applicationId, resumeUrl);

  renderAutofillSuccess(report);
}

// ─── Main Flow ────────────────────────────────────────────────────────────────
async function runTailoring() {
  const { id: tabId, url: tabUrl } = currentTab;

  showState(stateLoading);
  elLoadingStep.textContent = "Scraping job description...";

  // ── Step 1: Scrape ────────────────────────────────────────────────────────
  let jobDescription;
  try {
    jobDescription = await scrapeCurrentTab(tabId);
  } catch (err) {
    showError("scraping", err.message);
    return;
  }

  // ── Step 2: AI Tailoring + PDF Generation ────────────────────────────────
  elLoadingStep.textContent = "Tailoring your resume...";

  let apiData;
  try {
    apiData = await callTailorApi(jobDescription, tabUrl);
  } catch (err) {
    showError(err.step, err.message);
    return;
  }

  // ── Step 3: Download ──────────────────────────────────────────────────────
  elLoadingStep.textContent = "Downloading resume...";

  const { downloadUrl, result } = apiData;
  const changesMade     = result.changesMade || { skillsAdded: [], bulletsReworded: [] };
  const warnings        = result.warnings    || [];
  const { skillsAdded, bulletsReworded } = changesMade;

  try {
    await downloadResume(downloadUrl);
  } catch (err) {
    showError("download", err.message);
    return;
  }

  // ── Step 4: Persist and show success ─────────────────────────────────────
  await saveResult(bulletsReworded, skillsAdded, warnings);
  renderSuccess({ bulletsReworded, skillsAdded, warnings }, false);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
btnTailor.addEventListener("click", runTailoring);
btnAutofill.addEventListener("click", runAutofill);
btnAutofillBack.addEventListener("click", () => showState(stateIdle));

btnRetry.addEventListener("click", runTailoring);

btnReset.addEventListener("click", async () => {
  await clearResult();
  elChangesBlock.classList.add("hidden");
  elWarningsBlock.classList.add("hidden");
  elChangesList.innerHTML  = "";
  elWarningsList.innerHTML = "";
  showState(stateIdle);
});

btnBack.addEventListener("click", () => {
  showState(stateIdle);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  elCurrentUrl.textContent = tab?.url || "No URL detected";

  if (tab?.url) {
    // Show platform badge if adapter cache has a match for this URL
    const adapter = await findAdapterForUrl(tab.url);
    if (adapter) {
      elPlatformName.textContent = adapter.platform;
      elPlatformLine.classList.remove("hidden");
    }

    // Warn if user has already applied to this URL
    const applied = await isUrlApplied(tab.url);
    if (applied) {
      elAlreadyApplied.classList.remove("hidden");
    }

    // Background version checks — fire and forget, never block the UI
    checkVersion().catch(() => {});
    checkAdapterVersions().catch(() => {});
  }

  // Restore last result if present — saves the user from re-tailoring on every popup open
  const saved = await loadSavedResult();
  if (saved) {
    renderSuccess(saved, true);
  }
});
