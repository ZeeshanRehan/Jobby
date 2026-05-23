// ─── Guard Against Re-injection ───────────────────────────────────────────────
if (!window.__jobbyAutofillInjected) {
  window.__jobbyAutofillInjected = true;

  // ─── Path Resolver ────────────────────────────────────────────────────────
  // Resolves dot-path strings like "identity.firstName" against profileData
  function resolvePath(obj, dotPath) {
    return dotPath.split(".").reduce((acc, key) => acc?.[key], obj);
  }

  // ─── Label Extractor ──────────────────────────────────────────────────────
  // Tries id → name → ancestor label → aria-label → placeholder, in order
  function getLabelText(el) {
    let text = null;
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) text = lbl.textContent;
    }
    if (!text && el.name) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.name)}"]`);
      if (lbl) text = lbl.textContent;
    }
    if (!text) {
      const ancestor = el.closest("label");
      if (ancestor) text = ancestor.textContent;
    }
    if (!text) text = el.getAttribute("aria-label");
    if (!text) text = el.placeholder || null;
    return text ? text.replace(/\s+/g, " ").replace(/\*/g, "").trim() : null;
  }

  // ─── Unique Selector ──────────────────────────────────────────────────────
  function getUniqueSelector(el) {
    if (el.id)   return `#${CSS.escape(el.id)}`;
    if (el.name) return `[name="${el.name}"]`;
    return null;
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

  // ─── Select Fill ──────────────────────────────────────────────────────────
  // Tries exact match first, then falls back to substring containment in both directions
  function fillSelect(el, answer) {
    const lower   = answer.toLowerCase().trim();
    const options = Array.from(el.options);

    const match =
      options.find((o) => o.text.trim().toLowerCase() === lower || o.value.toLowerCase() === lower) ||
      options.find((o) => o.text.trim().toLowerCase().includes(lower) || lower.includes(o.text.trim().toLowerCase())) ||
      options.find((o) => o.value.toLowerCase().includes(lower) || lower.includes(o.value.toLowerCase()));

    if (!match) return;
    el.value = match.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ─── File Fill ────────────────────────────────────────────────────────────
  // Reconstructs a File from a base64 dataURL and attaches via DataTransfer
  function fillFile(el, dataUrl) {
    console.log("[Jobby] fillFile: el=", el, "visible=", el.offsetParent !== null, "disabled=", el.disabled);
    const [, base64] = dataUrl.split(",");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const file = new File([blob], "resume.pdf", { type: "application/pdf" });
    const dt   = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    console.log("[Jobby] fillFile: files after set=", el.files.length, el.files[0]?.name);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input",  { bubbles: true }));
  }

  // ─── Unknown Field Scanner ────────────────────────────────────────────────
  // Returns fields not covered by the adapter that have resolvable labels
  const SKIP_INPUT_TYPES = new Set([
    "file", "hidden", "submit", "button", "checkbox", "radio",
    "search", "reset", "image",
  ]);

  function scanUnknownFields(adapter, handledEls) {
    const unknownFields = [];

    document.querySelectorAll("input, textarea, select").forEach((el) => {
      if (handledEls.has(el)) return;
      if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type)) return;
      if (el.id && el.id.includes("recaptcha")) return;

      const label = getLabelText(el);
      if (!label) return;

      const selector = getUniqueSelector(el);
      if (!selector) return;

      const fieldType = el instanceof HTMLSelectElement   ? "select"
                      : el instanceof HTMLTextAreaElement ? "textarea"
                      : el.type || "text";

      const options = el instanceof HTMLSelectElement
        ? Array.from(el.options).slice(1).map((o) => o.text.trim()).filter(Boolean)
        : null;

      console.log(`[Jobby] unknown field — "${label}" (${fieldType}) selector="${selector}"`);
      unknownFields.push({ selector, label, fieldType, options });
    });

    return unknownFields;
  }

  // ─── Message Handler ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    // ── FILL_FORM — adapter fields + unknown field scan ───────────────────
    if (message.type === "FILL_FORM") {
      const { adapter, profileData, resumePdf } = message;
      const report      = { filled: [], stale: [], skipped: [], errors: [] };
      const handledEls  = new WeakSet();

      console.log("[Jobby] FILL_FORM received, fields:", Object.keys(adapter.fields));

      for (const [fieldName, fieldDef] of Object.entries(adapter.fields)) {
        const { selector, type, source } = fieldDef;

        const el = document.querySelector(selector);
        if (!el) {
          console.log(`[Jobby] stale — ${fieldName} selector "${selector}" matched nothing`);
          report.stale.push(fieldName);
          continue;
        }

        handledEls.add(el);
        console.log(`[Jobby] found ${fieldName} (${type}) — el:`, el);

        try {
          if (type === "text") {
            const value = resolvePath(profileData, source);
            if (value == null || value === "") {
              console.log(`[Jobby] skipped ${fieldName} — no value at path "${source}"`);
              report.skipped.push(fieldName);
              continue;
            }
            fillText(el, String(value));
            console.log(`[Jobby] filled ${fieldName} =`, value);
            report.filled.push(fieldName);
          } else if (type === "file") {
            fillFile(el, resumePdf);
            console.log(`[Jobby] file attached for ${fieldName}`);
            report.filled.push(fieldName);
          } else {
            console.log(`[Jobby] skipped ${fieldName} — unknown type "${type}"`);
            report.skipped.push(fieldName);
          }
        } catch (err) {
          console.error(`[Jobby] error on ${fieldName}:`, err);
          report.errors.push({ field: fieldName, message: err.message });
        }
      }

      const unknownFields = scanUnknownFields(adapter, handledEls);
      console.log("[Jobby] report:", report, "unknownFields:", unknownFields.length);
      sendResponse({ report, unknownFields });
      return true;
    }

    // ── FILL_AI_FIELDS — fill fields resolved by Groq ─────────────────────
    if (message.type === "FILL_AI_FIELDS") {
      const { fields } = message; // [{ selector, value, fieldType }]
      const aiFilled = [];
      const aiErrors = [];

      for (const { selector, value, fieldType } of fields) {
        const el = document.querySelector(selector);
        if (!el) { aiErrors.push(selector); continue; }
        try {
          if (fieldType === "select") {
            fillSelect(el, value);
          } else {
            fillText(el, value);
          }
          console.log(`[Jobby] AI filled "${selector}" =`, value);
          aiFilled.push(selector);
        } catch (err) {
          console.error(`[Jobby] AI fill error on "${selector}":`, err);
          aiErrors.push(selector);
        }
      }

      console.log("[Jobby] AI fill done — filled:", aiFilled.length, "errors:", aiErrors.length);
      sendResponse({ aiFilled, aiErrors });
      return true;
    }

    return false;
  });
}
