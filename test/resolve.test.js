"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { localResolveField } = require("../extension/lib/resolve.js");

// Mirrors the real profileData shape (server/data/profile.js) closely enough to exercise
// every branch localResolveField reads. Kept inline so the test is deterministic and
// independent of the real profile's current values.
const profile = {
  identity: { firstName: "Zeshan", lastName: "Rehan" },
  contact: {
    linkedinUrl: "https://www.linkedin.com/in/zeshan-rehan-504ab0128/",
    githubUrl: "https://github.com/ZeeshanRehan",
    portfolioUrl: "https://imzeshan.com",
  },
  demographics: {
    gender: "Male",
    race: "Asian",
    ethnicity: "South Asian / Indian",
    veteranStatus: "I am not a protected veteran",
    disabilityStatus: "No, I do not have a disability",
  },
  defaultAnswers: {
    workAuthorizedUS: "Yes",
    workAuthorizedCanada: "No",
    currentLocation: "Glassboro, NJ",
    salaryExpectationUSD: "$80,000",
    currentSalary: "$60,000",
    howDidYouHear: "LinkedIn",
    sexualOrientation: "Prefer not to say",
  },
  workAuthorization: {},
};

const resolve = (label) => localResolveField({ label }, profile);

test("country: residence question resolves locally", () => {
  assert.equal(resolve("What country do you live in?"), "United States of America - New Jersey");
});

test("country guard: citizenship/eligibility country routes to AI (null), not the US autofill", () => {
  // DEVLOG/cutoff: country rule must NOT fire on work-status/eligibility labels that merely
  // mention "country" — those need a real option pick or AI, never the canned US-NJ answer.
  assert.equal(resolve("Country of citizenship"), null);
});

test("work auth: 'authorized to work' (US) returns Yes, never the country string", () => {
  const ans = resolve("Are you legally authorized to work in the United States?");
  assert.equal(ans, "Yes");
  assert.notEqual(ans, "United States of America - New Jersey");
});

test("work auth: Canada branch resolves separately", () => {
  assert.equal(resolve("Are you authorized to work in Canada?"), "No");
});

test("salary: comfort question and expected-salary question do not collide", () => {
  assert.equal(resolve("Are you comfortable with the salary range?"), "Yes");
  assert.equal(resolve("What is your expected salary?"), "$80,000");
});

test("demographics pass through from profile", () => {
  assert.equal(resolve("Gender"), "Male");
  assert.equal(resolve("Disability status"), "No, I do not have a disability");
  assert.equal(resolve("Are you a protected veteran?"), "I am not a protected veteran");
  assert.equal(resolve("Race"), "Asian");
});

test("gender guard: 'gender preference' is not treated as the demographics gender field", () => {
  assert.equal(resolve("Gender preference"), null);
});

test("contact links resolve from profile", () => {
  assert.equal(resolve("LinkedIn URL"), profile.contact.linkedinUrl);
  assert.equal(resolve("GitHub profile"), profile.contact.githubUrl);
});

test("unrecognized label returns null (routes to Claude) — guards against an over-greedy regex", () => {
  assert.equal(resolve("What is your favorite color?"), null);
  assert.equal(resolve("Describe a time you showed leadership"), null);
});

test("null/empty profile does not throw", () => {
  assert.doesNotThrow(() => localResolveField({ label: "Gender" }, null));
  assert.equal(localResolveField({ label: "Gender" }, null), null);
});

test("demographics: LGBTQIA+ community question resolves like sexual orientation", () => {
  // Live Remote form leaked this to AI — label is "LBGTQIA+ community", not "sexual orientation".
  const label = "Do you identify as part of the Lesbian, Bisexual, Gay, Transgender, Queer, Intersex, and Asexual (LBGTQIA+) community?";
  assert.equal(localResolveField({ label }, profile), "Prefer not to say");
});

test("ack gate: verb-less label is caught by its affirmative option", () => {
  // "Privacy notice" / "Notice at Collection…" have no acknowledge/agree verb in the label, so the
  // label rule alone misses them. The option shape carries the signal.
  assert.equal(
    localResolveField({ label: "Privacy notice", options: ["Acknowledge/Confirm"] }, profile),
    "Acknowledge/Confirm"
  );
  assert.equal(
    localResolveField({ label: "Notice at Collection for California Job Applicants", options: ["Acknowledge/Confirm", "I am not a California resident"] }, profile),
    "Acknowledge/Confirm"
  );
});

test("ack gate: consent field returns the affirmative option verbatim, not a bare 'Yes'", () => {
  assert.equal(
    localResolveField({ label: "Please confirm you consent your self-identification data to be processed for the listed purposes", options: ["Yes, I consent", "I don't wish to answer"] }, profile),
    "Yes, I consent"
  );
});

test("ack guard: a plain Yes/No qualification question is NOT hijacked as an ack gate", () => {
  // Job-specific yes/no must still route to AI — the ack detector keys on consent/acknowledge option
  // text, not on a bare "Yes".
  assert.equal(localResolveField({ label: "Do you have formal experience managing a team of engineers?", options: ["Yes", "No"] }, profile), null);
});
