"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { bestOptionMatch } = require("../extension/lib/match.js");

// DEVLOG 2026-05-23: "No" must not match the substring inside "Not a protected veteran".
test('"No" does not mismatch inside "Not a protected veteran"', () => {
  const opts = ["I am not a protected veteran", "I am a protected veteran"];
  assert.equal(bestOptionMatch(opts, "No"), -1);
});

// DEVLOG combobox cascade: forward-substring needs ≥3 chars so "No" ⊄ "Lebanon".
test('"No" does not mismatch the "no" inside "Lebanon"', () => {
  const opts = ["Lebanon", "Canada", "United States"];
  assert.equal(bestOptionMatch(opts, "No"), -1);
});

// Leading-clause rule: a verbose canonical answer collapses to its head option.
test('leading clause: "No, I do not have a disability" → "No"', () => {
  const opts = ["Yes", "No"];
  assert.equal(opts[bestOptionMatch(opts, "No, I do not have a disability")], "No");
});

// Token overlap bridges a canonical answer to a verbose option.
test('token overlap: "South Asian / Indian" → verbose "South Asian (...)" option', () => {
  const opts = ["South Asian (inclusive of Bangladesh, Pakistan, India and other countries)", "East Asian", "White"];
  assert.equal(bestOptionMatch(opts, "South Asian / Indian"), 0);
});

// Forward substring (answer ⊂ option) handles whitespace/suffix wording diffs.
test('answer ⊂ option: "Eastern Time" → "Eastern Time (US & Canada)"', () => {
  const opts = ["Eastern Time (US & Canada)", "Pacific Time", "Central Time"];
  assert.equal(bestOptionMatch(opts, "Eastern Time"), 0);
});

// Exact match always wins over any fuzzy rule.
test("exact match wins", () => {
  const opts = ["United States of America", "United States Minor Outlying Islands"];
  assert.equal(opts[bestOptionMatch(opts, "United States of America")], "United States of America");
});

// Shortest-wins property: among options CONTAINING the answer, the shortest by string
// length is chosen (not the first by list position) — asserted as a property so it
// survives reordering. This is shortest by *length*, not "the most country-like option":
// e.g. "United States" against ["United States - Alabama", "United States of America"]
// picks Alabama (23 < 24). Benign in production (real country dropdowns expose an exact
// "United States"; state-split dropdowns get the state-qualified answer that exact-matches).
// The lib/match.js comment documents this honestly (see DEVLOG 2026-05-25).
test("answer ⊂ multiple options → shortest containing option wins (not first by position)", () => {
  const opts = ["United States Minor Outlying Islands", "United States of America"];
  const idx = bestOptionMatch(opts, "United States");
  const containing = opts.filter((o) => o.toLowerCase().includes("united states"));
  const shortest = [...containing].sort((a, b) => a.length - b.length)[0];
  assert.equal(opts[idx], shortest);
});

// Boundary returns.
test("empty option list → -1", () => {
  assert.equal(bestOptionMatch([], "anything"), -1);
});

test("empty answer → -1", () => {
  assert.equal(bestOptionMatch(["only option"], ""), -1);
});

test("no plausible match → -1 (does not force a pick)", () => {
  assert.equal(bestOptionMatch(["Red", "Green", "Blue"], "Salary expectations"), -1);
});
