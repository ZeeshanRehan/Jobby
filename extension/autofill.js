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
    // Lever-style: question text lives in the parent of .application-field, above the inputs
    if (!text) {
      const wrapper = el.closest(".application-field")?.parentElement;
      if (wrapper) {
        const clone = wrapper.cloneNode(true);
        clone.querySelector(".application-field")?.remove();
        const t = clone.textContent.trim();
        if (t) text = t;
      }
    }
    return text ? text.replace(/\s+/g, " ").replace(/[*✱]/g, "").trim() : null;
  }

  // ─── Group Label ──────────────────────────────────────────────────────────
  // Extracts the question label for a radio or checkbox group — tries generic
  // patterns first, then Lever's application-field wrapper pattern.
  function getGroupLabel(el) {
    const fieldset = el.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend) return legend.textContent.replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();
      // Ashby: fieldset without legend — label precedes _option_ divs; strip trailing "Input <name>" a11y noise
      const clone = fieldset.cloneNode(true);
      clone.querySelectorAll('[class*="_option_"]').forEach((o) => o.remove());
      const raw = clone.textContent.replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();
      const text = raw.split(/\s+Input\b/i)[0].trim();
      if (text) return text;
    }
    const ariaGroup = el.closest('[role="group"]');
    if (ariaGroup) {
      const lbId = ariaGroup.getAttribute("aria-labelledby");
      const lbl = lbId && document.getElementById(lbId);
      if (lbl) return lbl.textContent.replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();
    }
    // Lever-style: .application-field parent holds the question text
    const wrapper = el.closest(".application-field")?.parentElement;
    if (wrapper) {
      const clone = wrapper.cloneNode(true);
      clone.querySelector(".application-field")?.remove();
      const text = clone.textContent.replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return null;
  }

  // ─── Unique Selector ──────────────────────────────────────────────────────
  function getUniqueSelector(el) {
    if (el.id)   return `#${CSS.escape(el.id)}`;
    if (el.name) return `[name="${el.name}"]`;
    return null;
  }

  // ─── Blur Commit ────────────────────────────────────────────────────────────
  // Ashby (and other touched/blur-validated forms) only run "required" validation on blur, not
  // on input — so a field can hold the right value yet still fail submit until it loses focus.
  // React's onBlur is wired to the bubbling focusout, so fire both the native blur and focusout.
  function commitBlur(el) {
    el.blur();
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }

  // ─── Text Fill (React-compatible) ─────────────────────────────────────────
  // Uses native setter to bypass React's synthetic event wrapper. No blur — callers that need
  // blur-validation use fillText; the combobox typeahead must NOT blur (it would close the menu).
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillText(el, value) {
    setNativeValue(el, value);
    commitBlur(el); // validation often only clears on blur
  }

  // Full pointer sequence — Ashby (and react widgets) commit on mousedown, not a bare .click()
  function pointerClick(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    el.click();
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

  // Closes the menu and confirms it closed — a stuck-open menu blocks the next field from opening
  // AND leaves visible UX cruft if it persists past submit. Layered fallbacks because one path
  // (escape, body click) doesn't always take on every react-select build:
  //   1. focus → Escape keydown → blur+focusout (focus first so the keydown lands on this input)
  //   2. outside click on documentElement (body can be ambiguous if the form wraps it)
  //   3. click the dropdown-indicator chevron — toggles a still-open menu closed
  async function closeCombobox(el) {
    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    await sleep(30);
    el.blur();
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await sleep(60);
    if (el.getAttribute("aria-expanded") !== "true") return;

    document.documentElement.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    document.documentElement.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    await sleep(60);
    if (el.getAttribute("aria-expanded") !== "true") return;

    const indicator = el.closest('[class*="select__control"]')?.querySelector('[class*="dropdown-indicator"], [class*="indicator"]');
    if (indicator) {
      indicator.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      indicator.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
      indicator.click();
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
    setNativeValue(el, query); // keep focus — blurring here would close the menu before options mount
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
    const opened = await openCombobox(el); // react-select opens on mousedown; Ashby opens on type (below)

    let opts  = opened ? readComboboxOptionEls(findComboboxMenu(el)) : [];
    let texts = opts.map((o) => o.textContent.trim());
    let idx;

    if (opts.length === 0) {
      // empty menu = either async react-select OR a type-to-open combobox (Ashby) — typing handles both
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
    // Ashby (non react-select) reflects the pick in the input's own value rather than a chip element
    const ashbyOk = el instanceof HTMLInputElement && el.value.trim() === texts[idx];
    // Greenhouse renders the picked chip with reformatted text (e.g. option "Glassboro, New Jersey,
    // United States" → chip "Glassboro, NJ, United States"). Match whitespace-normalized substring
    // either direction so a real pick isn't falsely reported as ERROR.
    const norm   = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();
    const target = norm(texts[idx]);
    const ok     = ashbyOk || shown.some((s) => { const n = norm(s); return n === target || n.includes(target) || target.includes(n); });

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
      if (el.closest("[data-jobby-checkgroup]")) continue; // owned by a multi-select group
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
    const processedRadioNames = new Set();

    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (handledEls.has(el)) continue;
      const isCombobox = isReactSelectCombobox(el);

      // Radio groups: collect all inputs sharing the same name as one field with options
      if (el instanceof HTMLInputElement && el.type === "radio") {
        const name = el.name;
        if (!name || processedRadioNames.has(name)) { handledEls.add(el); continue; }
        processedRadioNames.add(name);
        const radios = [...document.querySelectorAll(`input[name="${name}"]`)];
        radios.forEach((r) => handledEls.add(r));
        const label = getGroupLabel(el);
        if (!label) continue;
        const options = radios.map((r) => {
          const lbl = document.querySelector(`label[for="${CSS.escape(r.id)}"]`) || r.closest("label");
          return lbl?.textContent?.trim() || r.value;
        }).filter(Boolean);
        unknownFields.push({ selector: `input[name="${name}"]`, label, fieldType: "radio", options });
        continue;
      }

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

    // Multi-select checkbox groups ("select all that apply") — a fieldset of checkboxes with
    // unique names. Group by fieldset/role=group, tag the container so FILL_AI_FIELDS can re-find
    // the boxes. Consent/marketing boxes are excluded — tickConsentCheckboxes owns those.
    let checkGroupIdx = 0;
    const seenGroups = new Set();
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (handledEls.has(cb) || cb.disabled) continue;
      const group = cb.closest('fieldset, [role="group"]');
      if (!group || seenGroups.has(group)) continue;
      seenGroups.add(group);
      const boxes = [...group.querySelectorAll('input[type="checkbox"]')].filter((b) => {
        if (b.disabled) return false;
        const t = getLabelText(b) || "";
        return !CONSENT_RE.test(t) && !MARKETING_RE.test(t);
      });
      if (boxes.length < 2) continue; // single box = consent/standalone, not a multi-select
      boxes.forEach((b) => handledEls.add(b));
      const label = getGroupLabel(cb);
      if (!label) continue;
      const options = boxes.map((b) => {
        const lbl = document.querySelector(`label[for="${CSS.escape(b.id)}"]`) || b.closest("label");
        return lbl?.textContent?.trim() || b.name;
      }).filter(Boolean);
      group.setAttribute("data-jobby-checkgroup", String(checkGroupIdx));
      unknownFields.push({
        selector: `[data-jobby-checkgroup="${checkGroupIdx}"] input[type="checkbox"]`,
        label, fieldType: "checkboxgroup", options,
      });
      checkGroupIdx++;
    }

    // Ashby Yes/No button groups — _yesno_ containers with Yes/No buttons.
    // Tag each container with data-jobby-yesno so FILL_AI_FIELDS can find the right one.
    let yesNoIdx = 0;
    for (const container of document.querySelectorAll('[class*="_yesno_"]')) {
      const buttons = [...container.querySelectorAll("button")];
      if (buttons.length < 2) continue;
      const fieldEntry = container.parentElement;
      if (!fieldEntry) continue;
      const clone = fieldEntry.cloneNode(true);
      clone.querySelector('[class*="_yesno_"]')?.remove();
      const label = clone.textContent.replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();
      if (!label) continue;
      const options = buttons.map((b) => b.textContent.trim()).filter(Boolean);
      container.setAttribute("data-jobby-yesno", String(yesNoIdx));
      unknownFields.push({ selector: `[data-jobby-yesno="${yesNoIdx}"]`, label, fieldType: "yesno", options });
      yesNoIdx++;
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
            } else if (type === "combobox") {
              const value = resolvePath(profileData, source);
              if (value == null || value === "") {
                report.skipped.push(fieldName);
                continue;
              }
              const ok = await fillCombobox(el, String(value));
              if (ok) report.filled.push(fieldName);
              else report.errors.push({ field: fieldName, message: "combobox pick failed" });
            } else if (type === "file") {
              fillFile(el, resumePdf);
              report.filled.push(fieldName);
            } else {
              report.skipped.push(fieldName);
            }
          } catch (err) {
            console.error(`[Jobby] error on ${fieldName}:`, err);
            report.errors.push({ field: fieldName, message: err.message });
          } finally {
            await sleep(16); // same anti-race yield as the AI-field loop
          }
        }

        const unknownFields = await scanUnknownFields(adapter, handledEls);

        // tick mandatory/consent boxes that gate Submit — never the submit button itself
        const consent = tickConsentCheckboxes();
        report.consent = consent;
        report.filled.push(...consent);

        console.log("[Jobby] report:", report, "unknownFields:", unknownFields.length, "consent:", consent.length);
        // Scan diagnostic — what the scanner DETECTED. A required field missing from BOTH this table
        // and the AI-fill table was never seen by the scanner (bad label / unsupported widget).
        try {
          console.table(unknownFields.map((f) => ({
            label: f.label, fieldType: f.fieldType,
            options: Array.isArray(f.options) ? f.options.length : "",
            selector: f.selector,
          })));
        } catch (e) { console.warn("[Jobby] scan table failed:", e.message); }
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
          try {
            // Ashby Yes/No button groups — find tagged container, click the matching button
            if (fieldType === "yesno") {
              const container = document.querySelector(selector);
              if (!container) { aiErrors.push(selector); continue; }
              const buttons = [...container.querySelectorAll("button")];
              const labels  = buttons.map((b) => b.textContent.trim());
              const idx     = bestOptionMatch(labels, value);
              if (idx >= 0) { pointerClick(buttons[idx]); commitBlur(buttons[idx]); aiFilled.push(selector); }
              else { aiErrors.push(selector); }
              continue;
            }

            // Radio groups need querySelectorAll — handle before the single-element path
            if (fieldType === "radio") {
              const radios = [...document.querySelectorAll(selector)];
              if (!radios.length) { aiErrors.push(selector); continue; }
              const labelEls = radios.map((r) =>
                document.querySelector(`label[for="${CSS.escape(r.id)}"]`) || r.closest("label"));
              const labels = labelEls.map((lbl, i) => lbl?.textContent?.trim() || radios[i].value);
              const idx = bestOptionMatch(labels, value);
              // pointer-click the input itself: its mousedown bubbles input→container→option row to reach
              // Ashby's commit handler, and the click still natively checks the radio. (label-click misses it.)
              if (idx >= 0) { pointerClick(radios[idx]); commitBlur(radios[idx]); aiFilled.push(selector); }
              else { aiErrors.push(selector); }
              continue;
            }

            // Multi-select checkbox groups — value is an array of options to check; tick each match
            if (fieldType === "checkboxgroup") {
              const boxes = [...document.querySelectorAll(selector)];
              if (!boxes.length) { aiErrors.push(selector); continue; }
              const labels = boxes.map((b) => {
                const lbl = document.querySelector(`label[for="${CSS.escape(b.id)}"]`) || b.closest("label");
                return lbl?.textContent?.trim() || b.name;
              });
              const wanted = Array.isArray(value) ? value : (value ? [value] : []);
              for (const w of wanted) {
                const idx = bestOptionMatch(labels, w);
                if (idx >= 0 && !boxes[idx].checked) { pointerClick(boxes[idx]); commitBlur(boxes[idx]); }
              }
              aiFilled.push(selector); // empty selection is a valid resolution for "select all that apply"
              continue;
            }

            const el = document.querySelector(selector);
            if (!el) { aiErrors.push(selector); continue; }
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
          } finally {
            // yield a frame so React commits this field's state before the next event burst — rapid
            // synthetic events race React's render and a subset silently fails to commit (shifting failures)
            await sleep(16);
          }
        }

        // Race guard: a synthetic input can fail to commit to React state, so the field reads filled but is
        // empty at submit (React resets the DOM value to its empty controlled state on re-render). Re-read
        // text-like fields and refill once — the single retry that turns "usually works" into "works".
        const TEXTLIKE = new Set(["text", "textarea", "number", "tel", "url", "email"]);
        for (const { selector, value, fieldType } of fields) {
          if (!TEXTLIKE.has(fieldType)) continue;
          const el = document.querySelector(selector);
          if (!el || el.value.trim() !== "") continue;
          fillText(el, Array.isArray(value) ? value.join(", ") : String(value ?? ""));
          await sleep(16);
        }

        console.log("[Jobby] AI fill done — filled:", aiFilled.length, "errors:", aiErrors.length);
        // Per-field diagnostic — shows what the AI answered for each field and whether it landed.
        // Paste this table back when a field "didn't take" so we can tell empty-answer from failed-fill.
        try {
          console.table(fields.map(({ selector, value, fieldType }) => {
            const first = document.querySelector(selector);
            const label = first ? (getGroupLabel(first) || getLabelText(first) || selector) : selector;
            return {
              label,
              fieldType,
              value: Array.isArray(value) ? value.join(" | ") : String(value ?? "").slice(0, 80),
              status: aiErrors.includes(selector) ? "ERROR" : "filled",
            };
          }));
        } catch (e) { console.warn("[Jobby] diagnostic table failed:", e.message); }
        sendResponse({ aiFilled, aiErrors });
      })();
      return true;
    }

    return false;
  });
  }
}
