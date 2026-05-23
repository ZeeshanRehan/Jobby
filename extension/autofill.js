// ─── Guard Against Re-injection ───────────────────────────────────────────────
if (!window.__jobbyAutofillInjected) {
  window.__jobbyAutofillInjected = true;

  // ─── Path Resolver ────────────────────────────────────────────────────────
  // Resolves dot-path strings like "identity.firstName" against profileData
  function resolvePath(obj, dotPath) {
    return dotPath.split(".").reduce((acc, key) => acc?.[key], obj);
  }

  // ─── Text Fill (React-compatible) ─────────────────────────────────────────
  // Uses native setter to bypass React's synthetic event wrapper
  function fillText(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ─── File Fill ────────────────────────────────────────────────────────────
  // Reconstructs a File from a base64 dataURL and attaches via DataTransfer
  function fillFile(el, dataUrl) {
    const [, base64] = dataUrl.split(",");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const file = new File([blob], "resume.pdf", { type: "application/pdf" });
    const dt   = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ─── Message Handler ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "FILL_FORM") return false;

    const { adapter, profileData, resumePdf } = message;
    const report = { filled: [], stale: [], skipped: [], errors: [] };

    for (const [fieldName, fieldDef] of Object.entries(adapter.fields)) {
      const { selector, type, source } = fieldDef;

      const el = document.querySelector(selector);
      if (!el) {
        report.stale.push(fieldName);
        continue;
      }

      try {
        if (type === "text") {
          const value = resolvePath(profileData, source);
          if (value == null || value === "") {
            report.skipped.push(fieldName);
            continue;
          }
          fillText(el, String(value));
          report.filled.push(fieldName);
        } else if (type === "file") {
          fillFile(el, resumePdf);
          report.filled.push(fieldName);
        } else {
          report.skipped.push(fieldName);
        }
      } catch (err) {
        report.errors.push({ field: fieldName, message: err.message });
      }
    }

    sendResponse({ report });
    return true;
  });
}
