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
    if (!text) {
      // react-select associates labels via aria-labelledby, not label[for]
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const lbl = document.getElementById(labelledby.split(" ")[0]);
        if (lbl) text = lbl.textContent;
      }
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

  // ─── Option Matching ────────────────────────────────────────────────────────
  // bestOptionMatch lives in lib/match.js (single source of truth, unit-tested) and is
  // injected as a content-script global immediately before this file — see popup.js injectAndFill.

  // ─── Select Fill ──────────────────────────────────────────────────────────
  function fillSelect(el, answer) {
    const options = Array.from(el.options);
    let idx = bestOptionMatch(options.map((o) => o.text.trim()), answer);
    if (idx < 0) {
      const lower = String(answer).toLowerCase().trim();
      idx = options.findIndex((o) => o.value.toLowerCase() === lower);
    }
    if (idx < 0) return;
    el.value = options[idx].value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ─── React-Select Combobox ─────────────────────────────────────────────────
  // Greenhouse questions render as react-select: an <input role="combobox"
  // class="select__input"> whose options only mount in the DOM while open.
  // Verified interaction: mousedown+mouseup on the input opens the menu;
  // mousedown+mouseup+click on a .select__option selects it and closes the menu.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isReactSelectCombobox(el) {
    return el instanceof HTMLInputElement
      && el.getAttribute("role") === "combobox"
      && el.classList.contains("select__input");
  }

  // react-select sets aria-controls to its listbox id ONLY while open, and clears it on close.
  // Resolve strictly by that id — never a document-wide query, which would hand back some OTHER
  // field's open menu (e.g. the country-code list) and cross-contaminate every fill.
  function findComboboxMenu(el) {
    const controls = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    if (!controls) return null;
    return document.getElementById(controls) || null;
  }

  // Open = aria-expanded true AND its own menu resolvable (guards a stale expanded flag)
  function isComboboxOpen(el) {
    return el.getAttribute("aria-expanded") === "true" && !!findComboboxMenu(el);
  }

  function readComboboxOptionEls(menu) {
    return menu ? Array.from(menu.querySelectorAll(".select__option, [role='option']")) : [];
  }

  // Returns true only if THIS field's own menu is open afterward
  async function openCombobox(el) {
    if (isComboboxOpen(el)) return true;
    el.focus();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    await sleep(200);
    // react-select also opens on ArrowDown when focused — fallback if the synthetic click didn't take
    if (!isComboboxOpen(el)) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true }));
      await sleep(200);
    }
    return isComboboxOpen(el);
  }

  // Closes the menu and confirms it closed — a stuck-open menu blocks the next field from opening.
  // Escape+blur first; if that doesn't take on this build, a click outside closes react-select.
  async function closeCombobox(el) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    el.blur();
    await sleep(60);
    if (el.getAttribute("aria-expanded") === "true") {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
      await sleep(60);
    }
  }

  // Opens the menu, captures the real option strings, closes it clean
  async function readComboboxOptions(el) {
    const opened    = await openCombobox(el);
    const menu      = findComboboxMenu(el);
    const optionEls = readComboboxOptionEls(menu);
    const options   = optionEls.map((o) => o.textContent.trim()).filter(Boolean);
    await closeCombobox(el);
    return options;
  }

  // Async react-select (e.g. Greenhouse location) mounts options only after typing. Type the
  // first answer clause (the city) to trigger the remote load, then poll until real options mount.
  async function typeAheadOptions(el, answer) {
    const query = String(answer).split(",")[0].trim(); // "Glassboro, New Jersey" → "Glassboro"
    el.focus();
    fillText(el, query);
    for (let t = 0; t < 13; t++) { // ~2.6s
      await sleep(200);
      let menu = findComboboxMenu(el);
      if (!menu) { await openCombobox(el); menu = findComboboxMenu(el); } // re-nudge open if it closed
      const els  = readComboboxOptionEls(menu);
      const txts = els.map((o) => o.textContent.trim());
      const settling = txts.length === 0 || txts.some((x) => /^(loading|searching)/i.test(x)) || txts.every((x) => /no options/i.test(x));
      if (!settling) return els;
    }
    return [];
  }

  // Location-specific pick: prefer an option containing city + full state, longest (most-qualified) wins.
  // Bypasses bestOptionMatch whose leading-clause rule would land on a bare "Glassboro" over the full entry.
  function pickLocationOption(texts, answer) {
    if (!texts.length) return -1;
    const parts = String(answer).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    const city  = parts[0] || "";
    const state = parts[1] || "";
    const lc    = texts.map((t) => t.toLowerCase());

    let bi = -1, blen = -1;
    lc.forEach((t, k) => { if (t.includes(city) && (!state || t.includes(state)) && t.length > blen) { blen = t.length; bi = k; } });
    if (bi >= 0) return bi;

    blen = -1;
    lc.forEach((t, k) => { if (city && t.includes(city) && t.length > blen) { blen = t.length; bi = k; } });
    if (bi >= 0) return bi;

    return -1; // no city match → blank (the async branch fires for any 0-option combobox; a blind
               // first-pick would repeat the wrong-menu bug). The log shows the options for diagnosis
  }

  // Opens, maps the answer to the best live option, clicks it. Handles single + multi-select,
  // and async type-ahead selects (open → 0 options → type → re-read → location-aware pick).
  async function fillCombobox(el, answer) {
    const opened = await openCombobox(el);
    if (!opened) { await closeCombobox(el); return false; }

    let opts  = readComboboxOptionEls(findComboboxMenu(el));
    let texts = opts.map((o) => o.textContent.trim());
    let idx;

    if (opts.length === 0) {
      opts  = await typeAheadOptions(el, answer);
      texts = opts.map((o) => o.textContent.trim());
      idx   = pickLocationOption(texts, answer);
    } else {
      idx   = bestOptionMatch(texts, answer);
    }

    if (opts.length === 0) { await closeCombobox(el); return false; }
    if (idx < 0) { await closeCombobox(el); return false; }
    const pick  = opts[idx];

    pick.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    pick.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    pick.click();
    await sleep(120);

    // verify the option actually rendered as a selected value IN THIS field — covers single + multi chip
    const vc    = el.closest('[class*="value-container"]');
    const shown = vc ? Array.from(vc.querySelectorAll(".select__single-value, .select__multi-value__label")).map((x) => x.textContent.trim()) : [];
    const ok    = shown.includes(texts[idx]);

    // always close so a still-open menu can't block the next field
    await closeCombobox(el);
    return ok;
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
    el.dispatchEvent(new Event("input",  { bubbles: true }));
  }

  // ─── Consent Checkbox Ticking ───────────────────────────────────────────────
  // Ticks the mandatory + consent/agreement boxes that gate Submit (GDPR, terms, "info is accurate").
  // Targets ONLY checkbox elements, so the submit button is structurally unreachable. Never submits.
  const CONSENT_RE   = /(agree|consent|acknowledge|gdpr|terms|privacy|authoriz|certif|confirm|i have read|policy|conditions|accurate|true and complete)/i;
  const MARKETING_RE = /(newsletter|subscribe|promotion|marketing|mailing list|offers|updates about|opt.?in to receive)/i;

  // consent prose often lives in aria-describedby, not label[for] — fold it into the match string
  function describedByText(el) {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent || "").join(" ");
  }

  function tickCheckbox(el) {
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      if (!el.checked) el.click(); // native click toggles + fires change so React sees it
      return el.checked;
    }
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    el.click();
    return el.getAttribute("aria-checked") === "true";
  }

  // required is the primary trigger (a required box before Submit is consent by definition); the
  // keyword path is a bonus. Marketing is skipped UNLESS it's required (rare, but still gates submit).
  function tickConsentCheckboxes() {
    const ticked = [];
    for (const el of document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')) {
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      const checked = el.type === "checkbox" ? el.checked : el.getAttribute("aria-checked") === "true";
      if (checked) continue;

      const label     = `${getLabelText(el) || ""} ${describedByText(el)}`.trim();
      const required  = el.required || el.getAttribute("aria-required") === "true";
      const consent   = CONSENT_RE.test(label);
      const marketing = MARKETING_RE.test(label);

      if (!(required || (consent && !marketing))) continue;
      const ok = tickCheckbox(el);
      if (ok) ticked.push(getLabelText(el) || el.name || el.id || "checkbox");
    }
    return ticked;
  }

  // ─── Unknown Field Scanner ────────────────────────────────────────────────
  // Returns fields not covered by the adapter that have resolvable labels
  const SKIP_INPUT_TYPES = new Set([
    "file", "hidden", "submit", "button", "checkbox", "radio",
    "search", "reset", "image",
  ]);

  // Async: combobox fields are opened to read their real options for the resolver
  async function scanUnknownFields(adapter, handledEls) {
    const unknownFields = [];

    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (handledEls.has(el)) continue;
      const isCombobox = isReactSelectCombobox(el);
      if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type) && !isCombobox) continue;
      if (el.id && el.id.includes("recaptcha")) continue;
      // intl-tel-input bundles a country-code combobox (id="country") with the phone field —
      // the phone value already carries the +1, and opening it left a stuck menu that broke every later fill
      if (isCombobox && el.id === "country") continue;

      const label = getLabelText(el);
      if (!label) continue;

      const selector = getUniqueSelector(el);
      if (!selector) continue;

      let fieldType, options = null;
      if (isCombobox) {
        fieldType = "combobox";
        // one broken combobox must not reject the whole scan (→ silent popup timeout)
        try {
          options = await readComboboxOptions(el);
        } catch (err) {
          console.warn(`[Jobby] combobox scan failed for "${selector}":`, err);
          options = [];
        }
      } else if (el instanceof HTMLSelectElement) {
        fieldType = "select";
        options   = Array.from(el.options).slice(1).map((o) => o.text.trim()).filter(Boolean);
      } else if (el instanceof HTMLTextAreaElement) {
        fieldType = "textarea";
      } else {
        fieldType = el.type || "text";
      }

      unknownFields.push({ selector, label, fieldType, options });
    }

    return unknownFields;
  }

  // ─── Test Hook ────────────────────────────────────────────────────────────
  // Exposes the DOM helpers so the local harness can drive them outside the extension
  window.__jobbyAutofill = {
    isReactSelectCombobox, findComboboxMenu, readComboboxOptionEls,
    openCombobox, closeCombobox, readComboboxOptions, fillCombobox,
    fillSelect, fillText, getLabelText, scanUnknownFields,
    tickConsentCheckboxes, typeAheadOptions, pickLocationOption,
  };

  // ─── Message Handler ──────────────────────────────────────────────────────
  // Guarded so the file can be injected into a plain page (harness) where chrome is undefined
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    // ── FILL_FORM — adapter fields + unknown field scan ───────────────────
    if (message.type === "FILL_FORM") {
      (async () => {
        const { adapter, profileData, resumePdf } = message;
        const report      = { filled: [], stale: [], skipped: [], errors: [] };
        const handledEls  = new WeakSet();

        console.log("[Jobby] FILL_FORM received, fields:", Object.keys(adapter.fields));

        for (const [fieldName, fieldDef] of Object.entries(adapter.fields)) {
          const { selector, type, source } = fieldDef;

          const el = document.querySelector(selector);
          if (!el) {
            report.stale.push(fieldName);
            continue;
          }

          handledEls.add(el);

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
            console.error(`[Jobby] error on ${fieldName}:`, err);
            report.errors.push({ field: fieldName, message: err.message });
          }
        }

        const unknownFields = await scanUnknownFields(adapter, handledEls);

        // tick mandatory/consent boxes that gate Submit — never the submit button itself
        const consent = tickConsentCheckboxes();
        report.consent = consent;
        report.filled.push(...consent);

        console.log("[Jobby] report:", report, "unknownFields:", unknownFields.length, "consent:", consent.length);
        sendResponse({ report, unknownFields });
      })();
      return true;
    }

    // ── FILL_AI_FIELDS — fill fields resolved by the AI/local resolver ────
    if (message.type === "FILL_AI_FIELDS") {
      (async () => {
        const { fields } = message; // [{ selector, value, fieldType }]
        const aiFilled = [];
        const aiErrors = [];

        for (const { selector, value, fieldType } of fields) {
          const el = document.querySelector(selector);
          if (!el) { aiErrors.push(selector); continue; }
          try {
            let ok = true;
            if (fieldType === "combobox") {
              ok = await fillCombobox(el, value);
            } else if (fieldType === "select") {
              fillSelect(el, value);
            } else {
              fillText(el, value);
            }
            if (ok) {
              aiFilled.push(selector);
            } else {
              aiErrors.push(selector);
            }
          } catch (err) {
            console.error(`[Jobby] AI fill error on "${selector}":`, err);
            aiErrors.push(selector);
          }
        }

        console.log("[Jobby] AI fill done — filled:", aiFilled.length, "errors:", aiErrors.length);
        sendResponse({ aiFilled, aiErrors });
      })();
      return true;
    }

    return false;
  });
  }
}
