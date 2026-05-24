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
  // Maps a resolved answer to the best option. Priority: exact → answer-in-option →
  // option-in-answer (≥4 chars, blocks "no" ⊂ "not…") → token overlap, which bridges
  // canonical answers and verbose options (e.g. "South Asian / Indian" → "South Asian
  // (inclusive of Bangladesh, Pakistan, India…)"). Returns the best index, or -1.
  const MATCH_STOP = new Set(["with", "that", "from", "your", "this", "have", "will", "other", "please", "than", "into", "they"]);

  function bestOptionMatch(texts, answer) {
    const lower = String(answer).toLowerCase().trim();
    if (!lower) return -1;

    let i = texts.findIndex((t) => t.toLowerCase().trim() === lower);
    if (i >= 0) return i;
    i = texts.findIndex((t) => t.toLowerCase().includes(lower));
    if (i >= 0) return i;
    i = texts.findIndex((t) => { const x = t.toLowerCase().trim(); return x.length >= 4 && lower.includes(x); });
    if (i >= 0) return i;

    // token overlap — pick the option sharing the most distinctive words, only if a clear winner
    const tokens = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !MATCH_STOP.has(w));
    if (!tokens.length) return -1;
    let best = -1, bestScore = 0, tie = false;
    texts.forEach((t, idx) => {
      const tl = t.toLowerCase();
      const score = tokens.reduce((n, w) => n + (tl.includes(w) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = idx; tie = false; }
      else if (score === bestScore && score > 0) { tie = true; }
    });
    return (best >= 0 && bestScore > 0 && !tie) ? best : -1;
  }

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

  // react-select links the input to its listbox via aria-controls — resolves the menu
  // whether it renders inline or is portaled to <body>. We open one menu at a time
  // (open → read → close serially), so the document-wide fallback is unambiguous.
  function findComboboxMenu(el) {
    const controls = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    if (controls) {
      const byId = document.getElementById(controls);
      if (byId) return byId;
    }
    return document.querySelector('.select__menu, [role="listbox"]') || null;
  }

  function readComboboxOptionEls(menu) {
    return menu ? Array.from(menu.querySelectorAll(".select__option, [role='option']")) : [];
  }

  async function openCombobox(el) {
    el.focus();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    await sleep(200);
    // react-select also opens on ArrowDown when focused — fallback if the synthetic click didn't take
    if (el.getAttribute("aria-expanded") !== "true") {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true }));
      await sleep(200);
    }
  }

  // Closes without selecting; blur triggers react-select's closeMenuOnBlur
  function closeCombobox(el) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    el.blur();
  }

  // Opens the menu, captures the real option strings, closes it clean
  async function readComboboxOptions(el) {
    await openCombobox(el);
    const menu      = findComboboxMenu(el);
    const optionEls = readComboboxOptionEls(menu);
    // discriminator: expanded=true + a menu in doc but opts=0 → find bug; expanded!=true → open bug
    console.log(`[Jobby] combobox-debug "${getUniqueSelector(el)}" expanded=${el.getAttribute("aria-expanded")} controls=${el.getAttribute("aria-controls")} menusInDoc=${document.querySelectorAll('.select__menu, [role="listbox"]').length} menuFound=${!!menu} opts=${optionEls.length}`);
    const options = optionEls.map((o) => o.textContent.trim()).filter(Boolean);
    closeCombobox(el);
    await sleep(60);
    return options;
  }

  // Opens, maps the answer to the best live option, clicks it. Handles single + multi-select.
  async function fillCombobox(el, answer) {
    await openCombobox(el);
    const opts = readComboboxOptionEls(findComboboxMenu(el));
    if (opts.length === 0) { closeCombobox(el); return false; }

    const texts = opts.map((o) => o.textContent.trim());
    const idx   = bestOptionMatch(texts, answer);
    if (idx < 0) { closeCombobox(el); return false; }
    const pick  = opts[idx];

    pick.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    pick.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    pick.click();
    await sleep(120);

    // verify the option now shows as a selected value — covers single (single-value) and multi (chip)
    const vc    = el.closest('[class*="value-container"]');
    const shown = vc ? Array.from(vc.querySelectorAll(".select__single-value, .select__multi-value__label")).map((x) => x.textContent.trim()) : [];
    const ok    = shown.includes(texts[idx]);

    // multi-select leaves the menu open after a pick — close it cleanly
    if (el.getAttribute("aria-expanded") === "true") closeCombobox(el);
    return ok || el.getAttribute("aria-expanded") === "false";
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

  // Async: combobox fields are opened to read their real options for the resolver
  async function scanUnknownFields(adapter, handledEls) {
    const unknownFields = [];

    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (handledEls.has(el)) continue;
      const isCombobox = isReactSelectCombobox(el);
      if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type) && !isCombobox) continue;
      if (el.id && el.id.includes("recaptcha")) continue;

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

      console.log(`[Jobby] unknown field — "${label}" (${fieldType}) selector="${selector}" options=${options ? options.length : 0}`);
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

        const unknownFields = await scanUnknownFields(adapter, handledEls);
        console.log("[Jobby] report:", report, "unknownFields:", unknownFields.length);
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
              console.log(`[Jobby] AI filled "${selector}" =`, value);
              aiFilled.push(selector);
            } else {
              console.log(`[Jobby] AI fill no-match "${selector}" =`, value);
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
