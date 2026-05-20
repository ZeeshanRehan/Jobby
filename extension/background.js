// ─── Known Job Boards ────────────────────────────────────────────────────────
const JOB_BOARD_PATTERNS = [
  "linkedin.com/jobs",
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "jobs.ashbyhq.com",
];

function isJobBoard(url) {
  if (!url) return false;
  return JOB_BOARD_PATTERNS.some((pattern) => url.includes(pattern));
}

// ─── Icon Helpers ─────────────────────────────────────────────────────────────
function iconPaths(variant) {
  return {
    16:  `icons/icon-${variant}-16.png`,
    48:  `icons/icon-${variant}-48.png`,
    128: `icons/icon-${variant}-128.png`,
  };
}

function updateIcon(tabId, url) {
  const variant = isJobBoard(url) ? "blue" : "gray";
  chrome.action.setIcon({ tabId, path: iconPaths(variant) });
}

// ─── Tab Listeners ────────────────────────────────────────────────────────────
// onUpdated fires on navigation and URL changes, including SPA route pushes
chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
  if (!tab.url) return;
  try {
    updateIcon(tabId, tab.url);
  } catch (err) {
    console.error("[Jobby] onUpdated icon update failed:", err.message);
  }
});

// onActivated fires when the user switches tabs
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab.url) return;
    try {
      updateIcon(tabId, tab.url);
    } catch (err) {
      console.error("[Jobby] onActivated icon update failed:", err.message);
    }
  });
});
