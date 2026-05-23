// ─── Profile Data (Source of Truth for Autofill) ────────────────────────────
// Adapters reference values by path (e.g. "identity.firstName").
// Never duplicate this data in routes or extension code.

const profileData = {
  identity: {
    firstName: "Zeshan",
    lastName: "Rehan",
    middleName: "",
    preferredName: "",
    pronouns: "he/him",
  },
  contact: {
    email: "zeeshanrehan12345@gmail.com",
    phone: "+1-856-526-2323",
    linkedinUrl: "https://linkedin.com/in/Zeshan Rehan",
    githubUrl: "https://github.com/ZeeshanRehan",
    portfolioUrl: "https://imzeshan.com",
    address: {
      street: "",
      city: "Glassboro",
      state: "NJ",
      zip: "08028",
      country: "US",
    },
  },
  workAuthorization: {
    citizenStatus: "us_citizen",
    requiresSponsorshipNow: false,
    requiresSponsorshipFuture: false,
  },
  education: [{
    school: "Rowan University",
    degree: "Bachelor's",
    major: "Computer Science",
    minor: "",
    gpa: "",
    startDate: "Sept 2022",
    endDate: "May 2026",
    expectedGraduation: "May 2026",
    location: "Glassboro, NJ",
  }],
  demographics: {
    gender: "decline_to_answer",
    race: "decline_to_answer",
    ethnicity: "decline_to_answer",
    veteranStatus: "decline_to_answer",
    disabilityStatus: "decline_to_answer",
  },
  preferences: {
    salaryExpectation: "Open to discussion",
    availableStartDate: "Immediately",
    willingToRelocate: true,
    willingToTravel: true,
    remotePreference: "flexible",
  },
  voluntaryDisclosure: {
    howDidYouHear: "LinkedIn",
    referrerName: "",
    previousEmployee: false,
  },
  // ─── Default Answer Bank ────────────────────────────────────────────────────
  // Groq uses these as a lookup when the profile has no direct answer.
  // Keys describe the question theme; values are what to fill.
  defaultAnswers: {
    // ── Work Authorization ───────────────────────────────────────────────────
    workAuthorizedUS:              "Yes",
    workAuthorizedCanada:          "No",
    workAuthorizedUK:              "No",
    workAuthorizedAustralia:       "No",
    requiresSponsorshipNow:        "No",
    requiresSponsorshipFuture:     "No",
    isUsCitizen:                   "Yes",
    isPermanentResident:           "No",

    // ── Location / Relocation ────────────────────────────────────────────────
    willingToRelocate:             "Yes",
    basedInOntario:                "No",
    basedInUK:                     "No",
    willingToWorkOnSite:           "Yes",
    comfortableWithHybrid:         "Yes",
    comfortableWithRemote:         "Yes",
    willingToTravel:               "Yes",
    comfortableWithTravelPercent:  "Yes",

    // ── Compensation ─────────────────────────────────────────────────────────
    salaryExpectation:             "$65,000 – $80,000 USD",
    currentSalary:                 "$60,000 USD",
    comfortableWithOfferedSalary:  "Yes",
    openToCompensationDiscussion:  "Yes",
    openToEquity:                  "Yes",

    // ── Availability ─────────────────────────────────────────────────────────
    noticePeriod:                  "2 weeks",
    availableImmediately:          "Yes",
    availableFullTime:             "Yes",
    availableForOvertime:          "Yes",
    availableOnWeekends:           "As needed",
    expectedStartDate:             "2 weeks after offer",

    // ── Legal / Agreements ───────────────────────────────────────────────────
    subjectToNonCompete:           "No",
    subjectToNonSolicitation:      "No",
    subjectToConfidentialityAgreement: "No",
    hasEmploymentRestrictions:     "No",
    willingToSignNda:              "Yes",
    willingToSignArbitration:      "Yes",
    hasConflictOfInterest:         "No",

    // ── Background & Conduct ─────────────────────────────────────────────────
    hasBeenConvicted:              "No",
    hasBeenTerminated:             "No",
    agreedToBackgroundCheck:       "Yes",
    agreedToDrugTest:              "Yes",
    isPreviousEmployee:            "No",

    // ── Education & Eligibility ──────────────────────────────────────────────
    hasBachelorsDegree:            "Yes — Bachelor's in Computer Science (expected May 2026, Rowan University)",
    hasDriversLicense:             "Yes",
    isOver18:                      "Yes",
    hasRelevantCertifications:     "No",

    // ── Acknowledgements & Consents ──────────────────────────────────────────
    agreeToTermsAndConditions:     "Yes",
    agreeToPrivacyPolicy:          "Yes",
    agreeToRecordingPolicy:        "Yes — Acknowledge",
    consentToAiScreening:          "Yes",
    agreeToEqualOpportunityPolicy: "Yes",

    // ── Role Fit / Standard Soft Questions ───────────────────────────────────
    openToLearning:                "Yes",
    openToFeedback:                "Yes",
    comfortableWithAmbiguity:      "Yes",
    comfortableInFastPacedEnvironment: "Yes",
    hasExperienceInEnterpriseAccounts: "Yes",
    willingToUseAiTools:           "Yes",

    // ── Sourcing ─────────────────────────────────────────────────────────────
    howDidYouHear:                 "LinkedIn",
    referredByEmployee:            "No",
  },
};

module.exports = { profileData };
