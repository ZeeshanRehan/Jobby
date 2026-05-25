// ─── Option Matcher ──────────────────────────────────────────────────────────
// Single source of truth for bestOptionMatch, shared by autofill.js (injected as a
// content-script global immediately before it) and the Node test suite (module.exports).
// Pure (texts, answer) → index, no DOM/chrome deps.
//
// Re-injection note: autofill.js is re-injected on every run, so this file must be too.
// Keep it to a single top-level `function` (functions redeclare safely) — a top-level
// `const`/`let` would throw "already declared" on the second injection. MATCH_STOP lives
// inside the function for that reason.

// Maps a resolved answer to the best option. Priority:
//   1. exact
//   2. leading clause (comma split) — "No, I do not have a disability" → "No"
//   3. answer ⊂ option — shortest CONTAINING option by char length (deterministic, but not
//      necessarily the "clean" country on state-split lists; relies on the resolver supplying
//      a state-qualified answer, e.g. "United States of America - New Jersey")
//   4. option ⊂ answer (≥4 chars, blocks "no" ⊂ "not…")
//   5. token overlap — bridges canonical answers and verbose options (e.g. "South Asian /
//      Indian" → "South Asian (inclusive of Bangladesh, Pakistan, India…)"), clear winner only
// Returns the best index, or -1.
function bestOptionMatch(texts, answer) {
  const MATCH_STOP = new Set(["with", "that", "from", "your", "this", "have", "will", "other", "please", "than", "into", "they"]);

  const lower = String(answer).toLowerCase().trim();
  if (!lower) return -1;

  const lc = texts.map((t) => t.toLowerCase().trim());

  // 1. exact
  let i = lc.findIndex((t) => t === lower);
  if (i >= 0) return i;

  // 2. leading clause — "No, I do not have a disability" → "No"; "Yes, I am a veteran" → "Yes"
  const head = lower.split(",")[0].trim();
  if (head && head !== lower) {
    i = lc.findIndex((t) => t === head);
    if (i >= 0) return i;
  }

  // 3. answer ⊂ option — pick the SHORTEST containing option by char length
  if (lower.length >= 3) {
    let bi = -1, blen = Infinity;
    lc.forEach((t, k) => { if (t.includes(lower) && t.length < blen) { blen = t.length; bi = k; } });
    if (bi >= 0) return bi;
  }

  // 4. option ⊂ answer (≥4 chars, blocks "no" ⊂ "not…")
  i = lc.findIndex((t) => t.length >= 4 && lower.includes(t));
  if (i >= 0) return i;

  // 5. token overlap — pick the option sharing the most distinctive words, only if a clear winner
  const tokens = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !MATCH_STOP.has(w));
  if (!tokens.length) return -1;
  let best = -1, bestScore = 0, tie = false;
  lc.forEach((t, idx) => {
    const score = tokens.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = idx; tie = false; }
    else if (score === bestScore && score > 0) { tie = true; }
  });
  return (best >= 0 && bestScore > 0 && !tie) ? best : -1;
}

// Node test suite imports this; injected before autofill.js in the browser it's a content-script global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { bestOptionMatch };
}
