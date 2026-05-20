// ─── Constants ───────────────────────────────────────────────────────────────
const API_URL    = "http://178.105.161.45:3000/tailor-resume";
const TIMEOUT_MS = 120_000; // Groq + Puppeteer can take 30-60s

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
const elWarningsBlock = document.getElementById("warnings-block");
const elWarningsList  = document.getElementById("warnings-list");
const elDownloadStatus = document.getElementById("download-status");
const elErrorStep     = document.getElementById("error-step");
const elErrorMsg      = document.getElementById("error-msg");

const btnTailor = document.getElementById("btn-tailor");
const btnReset  = document.getElementById("btn-reset");
const btnRetry  = document.getElementById("btn-retry");
const btnBack   = document.getElementById("btn-back");

// ─── State Management ─────────────────────────────────────────────────────────
let currentTab = null;

function showState(state) {
  [stateIdle, stateLoading, stateSuccess, stateError].forEach((s) =>
    s.classList.add("hidden")
  );
  state.classList.remove("hidden");
}

function showError(step, message) {
  elErrorStep.textContent = step;
  elErrorMsg.textContent  = message;
  showState(stateError);
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
  const changesMade = result.changesMade || { skillsAdded: [], bulletsReworded: [] };
  const warnings    = result.warnings    || [];
  const { skillsAdded, bulletsReworded } = changesMade;

  try {
    await downloadResume(downloadUrl);
  } catch (err) {
    showError("download", err.message);
    return;
  }

  // ── Step 4: Show Success ──────────────────────────────────────────────────
  elBulletsCount.textContent  = bulletsReworded.length;
  elSkillsCount.textContent   = skillsAdded.length;
  elSkillsList.textContent    = skillsAdded.length > 0 ? skillsAdded.join(", ") : "";
  elDownloadStatus.textContent = "✓ Saved as resume_tailored.pdf";

  if (warnings.length > 0) {
    elWarningsList.innerHTML = warnings.map((w) => `<li>${w}</li>`).join("");
    elWarningsBlock.classList.remove("hidden");
  }

  showState(stateSuccess);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
btnTailor.addEventListener("click", runTailoring);

btnRetry.addEventListener("click", runTailoring);

btnReset.addEventListener("click", () => {
  elWarningsBlock.classList.add("hidden");
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
});
