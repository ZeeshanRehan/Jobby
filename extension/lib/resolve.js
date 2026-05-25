// ─── Local Field Resolver ─────────────────────────────────────────────────────
// Single source of truth for localResolveField, shared by popup.js (browser global)
// and the Node test suite (module.exports). No DOM/chrome deps — pure (field, profile) → answer.

// Resolves common fields locally without an API call — handles ~75% of unknowns.
// Returns an answer string or null if the field needs Claude.
function localResolveField(field, profileData) {
  const label = field.label.toLowerCase();
  const { demographics, defaultAnswers, contact, workAuthorization } = profileData || {};
  const da = defaultAnswers || {};

  // ── Demographics ────────────────────────────────────────────────────────────
  if (/\bgender\b/.test(label) && !/preference/.test(label))
    return demographics?.gender ?? null;
  if (/\brace\b/.test(label))
    return demographics?.race ?? null;
  if (/\bethnicit/.test(label))
    return demographics?.ethnicity ?? null;
  if (/\bveteran\b/.test(label))
    return demographics?.veteranStatus ?? null;
  if (/\bdisabilit/.test(label))
    return demographics?.disabilityStatus ?? null;
  if (/sexual\s+orientation/.test(label))
    return da.sexualOrientation ?? "Prefer not to say";
  if (/pronouns/.test(label))
    return "He/Him";

  // ── Contact / identity ──────────────────────────────────────────────────────
  if (/linkedin/.test(label))            return contact?.linkedinUrl ?? null;
  if (/github/.test(label))              return contact?.githubUrl   ?? null;
  if (/\bwebsite\b|\bportfolio\b/.test(label)) return contact?.portfolioUrl ?? null;
  if (/preferred\s+first\s+name/.test(label))  return contact ? (profileData.identity?.firstName ?? null) : null;
  if (/preferred\s+last\s+name/.test(label))   return contact ? (profileData.identity?.lastName  ?? null) : null;

  // ── Work authorization ──────────────────────────────────────────────────────
  if (/(authorized|eligible|right)\s+to\s+work/.test(label) && /canada/i.test(label))
    return da.workAuthorizedCanada ?? "No";
  if (/(authorized|eligible|right)\s+to\s+work/.test(label))
    return da.workAuthorizedUS ?? "Yes";
  if (/(visa|sponsorship)\s*(required|needed|now|future)?/i.test(label) ||
      /(require|need)\s+(visa|sponsorship)/i.test(label))
    return "No";

  // ── Location ────────────────────────────────────────────────────────────────
  // Resolve country locally — keeps the big country dropdown out of Claude. Guard against
  // work-status/eligibility labels that merely mention "country" (those need a real option pick).
  // State-qualified so it also lands on dropdowns that split the US by state (e.g. Remote); on a
  // plain dropdown the matcher's option-in-answer rule still resolves it to "United States".
  if (/\bcountry\b/.test(label) &&
      !/(status|eligib|visa|sponsor|citizen|authoriz|permanent\s+resident|refugee|work\s+permit)/.test(label))
    return "United States of America - New Jersey";
  // free-text city autocomplete (Greenhouse candidate-location) — type city, matcher picks the geocoded option.
  // guarded against location-type/preference dropdowns and the "based in X?" yes/no questions handled below
  if ((/(current\s+)?location\b|where\s+are\s+you\s+(currently\s+)?(based|located|living)|current\s+city|^city\b/.test(label)) &&
      !/(type|prefer|remote|hybrid|on.?site|relocat|willing|country)/.test(label))
    return da.currentLocation ?? null;
  if (/\brelocate\b/.test(label))                  return "Yes";
  if (/based\s+in/.test(label) &&
      /canada|ontario|uk|united kingdom|singapore|australia|europe/.test(label))
    return "No";
  if (/based\s+in/.test(label))                    return "Yes";
  if (/time\s+zone/.test(label))                   return "Eastern Time";

  // ── Legal / agreements ──────────────────────────────────────────────────────
  if (/non.?compete/.test(label))                  return "No";
  if (/non.?solicitation/.test(label))             return "No";
  if (/confidentiality\s+agreement/.test(label))   return "No";
  if (/employment\s+restriction/.test(label))      return "No";
  if (/background\s+check/.test(label))            return "Yes";
  if (/drug\s+test/.test(label))                   return "Yes";
  if (/criminal\s+(record|conviction|history)/.test(label)) return "No";
  if (/felony/.test(label))                        return "No";
  if (/terminated|fired\s+for\s+cause/.test(label)) return "No";

  // ── Compensation ────────────────────────────────────────────────────────────
  if (/(comfortable|okay|ok|happy|agree)\s+with.*(salary|pay|compensation|wage|range)/i.test(label))
    return "Yes";
  if (/salary\s+expect|expected\s+salary|desired\s+salary|target\s+salary/i.test(label))
    return da.salaryExpectationUSD ?? "$70,000 – $85,000";
  if (/current\s+salary|current\s+comp/i.test(label))
    return da.currentSalary ?? "$60,000";

  // ── Availability ────────────────────────────────────────────────────────────
  if (/notice\s+period/.test(label))               return "2 weeks";
  if (/when\s+can\s+you\s+start|start\s+date/.test(label)) return "2 weeks after offer";
  if (/full.?time/.test(label) && !/part.?time/.test(label)) return "Yes";
  if (/over\s*18|at\s+least\s+18|18\s+years/.test(label))   return "Yes";

  // ── Acknowledgements ────────────────────────────────────────────────────────
  if (/(acknowledge|agree|confirm|consent)\b/.test(label) &&
      /(policy|terms|recording|privacy|condition|guidelines?)\b/.test(label))
    return "Yes";

  // ── Sourcing ────────────────────────────────────────────────────────────────
  if (/how\s+did\s+you\s+hear/.test(label))        return da.howDidYouHear ?? "LinkedIn";
  if (/referred\s+by/.test(label))                 return "No";
  if (/previously\s+(work|employ|applied)/.test(label)) return "No";

  return null; // needs Claude
}

// Node test suite imports this; in the browser `module` is undefined and the function is a global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { localResolveField };
}
