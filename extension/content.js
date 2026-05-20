// ─── Guard Against Re-injection ───────────────────────────────────────────────
// executeScript is called each time the button is clicked — only register once
if (!window.__jobbyInjected) {
  window.__jobbyInjected = true;

  // ─── Strip Selectors ──────────────────────────────────────────────────────
  const STRIP_SELECTORS = [
    "nav", "header", "footer",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    ".cookie-banner", ".cookie-consent",
    "#cookie-banner", "#cookie-consent",
    "script", "style", "noscript",
  ];

  // ─── Scraper ──────────────────────────────────────────────────────────────
  function scrapeJobDescription() {
    const clone = document.body.cloneNode(true);

    STRIP_SELECTORS.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    const raw = clone.textContent || "";
    const cleaned = raw
      .replace(/\t/g, " ")
      .replace(/ {2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return cleaned;
  }

  // ─── Message Handler ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "SCRAPE_JOB") return false;

    const text = scrapeJobDescription();

    if (!text) {
      sendResponse({ error: "Scraped text was empty — page may not have loaded fully" });
    } else {
      sendResponse({ text });
    }

    // return true keeps the message channel open for the async sendResponse
    return true;
  });
}
