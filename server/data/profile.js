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
    linkedinUrl: "https://www.linkedin.com/in/zeshan-rehan-504ab0128/",
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
    gender: "Male",
    race: "Asian",
    ethnicity: "South Asian / Indian",
    nationality: "Indian",
    veteranStatus: "I am not a protected veteran",
    disabilityStatus: "No, I do not have a disability",
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

  // ─── Bio ─────────────────────────────────────────────────────────────────────
  // Used by Groq for open-ended "tell me about yourself" / background questions.
  bio: {
    // 2–3 sentence punch — used for short "about you" fields
    summary: "Computer Science student at Rowan University (graduating May 2026) with a record of building software that ships and gets real-world use — from a cognitive assessment tool deployed across two hospitals to an AI-powered job automation platform that cuts application time from 30 minutes to under a minute. I'm drawn to problems at the intersection of technology and human productivity, and I bring a naturally global perspective from growing up across India, the Middle East, and the US.",

    // Full narrative — used for "walk me through your background" / longer fields
    careerNarrative: "I'm a Computer Science student at Rowan University, graduating May 2026. I build things that actually get used: the Philadelphia Pointing Scan Test (PPST) is a digital cognitive assessment tool I built that's now deployed in two hospitals and used by thousands of patients to help clinicians evaluate cognitive decline in elderly adults. I also built Are You Hungry, a zero-friction platform that surfaces free food events on campus for Rowan students with no sign-up required, and Jobby, an AI-powered job application system that handles resume tailoring, PDF generation, and full form autofill end-to-end. I grew up across three countries — India, the Middle East, and the US — which has made me adaptable and comfortable navigating diverse teams and contexts. I'm most energized by roles where I can own real problems and ship real solutions.",

    // Used for "what are your strengths" / "what do you bring to this role"
    strengths: [
      "Building practical software that ships and gets real-world use — not just projects on GitHub",
      "Applying AI and automation to reduce friction in real-world workflows",
      "Fast learner who picks up new tools, domains, and codebases quickly",
      "Owning full-stack delivery end to end with strong attention to correctness",
      "Cross-cultural perspective and collaborative communication from growing up across three countries",
    ],

    // Used for "how do you work" / "describe your work style" / culture fit questions
    workStyle: "I work with a bias toward shipping — I move fast, prefer clear ownership, and thrive in environments where done-and-improving beats waiting-for-perfect. I communicate proactively, pick up context quickly, and work well both independently and in tight collaborative loops.",

    // Used for "where do you see yourself in 5 years" / "career goals"
    careerGoal: "To build impactful software products at the intersection of AI and human productivity — and eventually move into a technical founding or leadership role.",

    // Used for "what motivates you" / "why did you get into tech"
    motivation: "I got into CS because I wanted to build things that actually work and that people actually use. Seeing the PPST running in hospitals used by thousands of patients — that's the kind of tangible impact that keeps me going. I'm particularly energized by AI applied to productivity: removing the repetitive so people can focus on the meaningful.",

    // Used for "greatest challenge you've overcome" / "tell me about a difficult project"
    challengeNarrative: "Building the PPST for clinical use meant meeting a much higher standard than a typical student project — reliability, usability for clinicians under pressure, and actual deployment in hospital systems. Navigating the feedback loop between technical constraints and clinical requirements, and seeing it go live and get used, was the most formative thing I've built so far.",
  },

  // ─── Projects ─────────────────────────────────────────────────────────────────
  // Used by Groq for "what's your proudest work" / "describe a project" questions.
  // Lead with PPST for impact/healthcare angle, Jobby for AI/tech angle.
  projects: [
    {
      name: "Philadelphia Pointing Scan Test (PPST)",
      tagline: "Clinical cognitive assessment tool for elderly patients, deployed in two hospitals",
      description: "A digital implementation of a validated cognitive screening instrument used to detect decline in elderly adults. Built for clinicians to administer quickly and consistently, replacing a fragmented paper-based process.",
      impact: "Deployed across two hospital systems, used by thousands of patients to help doctors assess cognitive capacity in elderly adults.",
      highlights: [
        "Active clinical deployment in two hospitals",
        "Thousands of patient assessments completed",
        "Replaced paper-based workflow with a reliable, clinician-friendly digital tool",
        "Built to real healthcare usability standards — designed for use under pressure by non-technical staff",
      ],
      techStack: [],
    },
    {
      name: "Jobby",
      tagline: "AI-powered job application automation — from job post to filled form in under 60 seconds",
      description: "End-to-end job application automation built as a Chrome extension + Express API. Scrapes job descriptions, tailors resumes per role using Groq AI, generates single-page ATS-safe PDFs with Puppeteer, stores them in Supabase, and autofills application forms using adapter-based selector maps with an AI fallback for unknown fields.",
      impact: "Reduces per-application time from 20–30 minutes to under 60 seconds.",
      highlights: [
        "AI resume tailoring per job description — keywords woven in without changing facts or metrics",
        "Chrome extension with adapter-based autofill and Groq-powered fallback for unknown form fields",
        "Full pipeline: scrape → tailor → PDF → upload → autofill",
        "Adapter architecture makes it extensible to any ATS without touching core logic",
      ],
      techStack: ["Node.js", "Express", "Groq AI", "Puppeteer", "Supabase", "Chrome Extension MV3"],
    },
    {
      name: "Are You Hungry",
      tagline: "Campus free food event aggregator for Rowan University students",
      description: "A zero-friction web app that consolidates free food events happening across the Rowan University campus into one accessible feed. No sign-up, no auth, no barriers — open and browse, any time, any device.",
      impact: "Used by hundreds of Rowan University students to discover free food events on campus, surfacing resources that were previously scattered and hard to find.",
      highlights: [
        "Zero friction: no accounts, no sign-up, no install",
        "Aggregates events from multiple campus sources into a single real-time feed",
        "Addresses food insecurity by connecting students with available resources they didn't know existed",
      ],
      techStack: [],
    },
  ],

  // ─── Default Answer Bank ────────────────────────────────────────────────────
  // Groq uses these as a semantic lookup — match by meaning, not exact key name.
  // Rule: if a form question maps to any entry here, use the value. No ambiguity.
  defaultAnswers: {

    // ── Work Authorization ────────────────────────────────────────────────────
    // Only authorized in the US — not applying to non-US in-person roles
    workAuthorizedUS:                         "Yes",
    workAuthorizedCanada:                     "No",
    workAuthorizedUK:                         "No",
    workAuthorizedAustralia:                  "No",
    workAuthorizedEU:                         "No",
    requiresSponsorshipNow:                   "No",
    requiresSponsorshipFuture:                "No",
    isUsCitizen:                              "Yes",
    isPermanentResident:                      "Yes",
    hasWorkPermit:                            "Yes",

    // ── Location — US any city/state Yes; non-US No ───────────────────────────
    basedInUSA:                               "Yes",
    basedInAnyUSCity:                         "Yes",
    basedInNewYork:                           "Yes",
    basedInCalifornia:                        "Yes",
    basedInTexas:                             "Yes",
    basedInIllinois:                          "Yes",
    basedInFlorida:                           "Yes",
    basedInWashington:                        "Yes",
    basedInMassachusetts:                     "Yes",
    basedInNewJersey:                         "Yes",
    basedInGeorgia:                           "Yes",
    basedInOntario:                           "No",
    basedInCanada:                            "No",
    basedInUK:                                "No",
    basedInSingapore:                         "No",
    basedInAustralia:                         "No",
    basedInEurope:                            "No",
    willingToRelocate:                        "Yes",
    willingToRelocateWithinUS:                "Yes",
    willingToRelocateImmediately:             "Yes",
    willingToWorkOnSite:                      "Yes",
    comfortableWithHybrid:                    "Yes",
    comfortableWithRemote:                    "Yes",
    willingToTravel:                          "Yes",
    comfortableWithUpTo25PctTravel:           "Yes",
    comfortableWithUpTo50PctTravel:           "Yes",
    hasReliableTransportation:                "Yes",
    // typed into location autocompletes (city, full state) — matcher picks the geocoded option
    currentLocation:                          "Glassboro, New Jersey",

    // ── Compensation ──────────────────────────────────────────────────────────
    salaryExpectationUSD:                     "$70,000 – $85,000",
    currentSalary:                            "$60,000",
    comfortableWithOfferedSalary:             "Yes",
    comfortableWithSalaryRange:               "Yes",
    openToCompensationDiscussion:             "Yes",
    openToEquityOrStockOptions:               "Yes",
    openToPerformanceBonus:                   "Yes",
    openToCommissionStructure:                "Yes",
    comfortableWithBaseAndCommission:         "Yes",
    expectedHourlyRate:                       "$30 – $40/hr",

    // ── Availability ──────────────────────────────────────────────────────────
    noticePeriod:                             "2 weeks",
    availableImmediately:                     "Yes",
    availableFullTime:                        "Yes",
    availableForOvertime:                     "Yes",
    availableOnWeekends:                      "Yes",
    availableForEarlyOrLateShifts:            "Yes",
    expectedStartDate:                        "2 weeks after offer",
    canStartWithin30Days:                     "Yes",
    seekingFullTimeRole:                      "Yes",
    openToContractToHire:                     "Yes",
    openToContractRole:                       "Yes",

    // ── Legal / Agreements ────────────────────────────────────────────────────
    subjectToNonCompete:                      "No",
    subjectToNonSolicitation:                 "No",
    subjectToConfidentialityAgreement:        "No",
    hasEmploymentRestrictions:                "No",
    willingToSignNda:                         "Yes",
    willingToSignArbitration:                 "Yes",
    willingToSignOfferLetterConditions:       "Yes",
    hasConflictOfInterest:                    "No",
    agreedToCodeOfConduct:                    "Yes",
    agreedToCompanyPolicies:                  "Yes",
    willingToAdhereToPolicies:                "Yes",

    // ── Background & Conduct ──────────────────────────────────────────────────
    hasBeenConvicted:                         "No",
    hasBeenTerminated:                        "No",
    hasBeenSubjectToInvestigation:            "No",
    hasOutstandingLitigation:                 "No",
    agreedToBackgroundCheck:                  "Yes",
    agreedToCreditCheck:                      "Yes",
    agreedToDrugTest:                         "Yes",
    agreedToSocialMediaScreening:             "Yes",
    isPreviousEmployee:                       "No",
    hasBeenBannedFromWorkplace:               "No",

    // ── Education & Qualifications ────────────────────────────────────────────
    hasBachelorsDegree:                       "Yes — Computer Science, Rowan University (May 2026)",
    hasHighSchoolDiploma:                     "Yes",
    currentlyEnrolled:                        "Yes",
    expectedGraduationDate:                   "May 2026",
    highestEducationLevel:                    "Bachelor's degree (in progress)",
    hasDriversLicense:                        "Yes",
    isOver18:                                 "Yes",
    hasRelevantCertifications:                "No",
    hasProfessionalLicense:                   "No",
    hasSecurityClearance:                     "No",

    // ── Technical & Role-Specific ─────────────────────────────────────────────
    hasExperienceWithSalesforce:              "Yes",
    hasExperienceWithHubspot:                 "Yes",
    hasExperienceWithSlack:                   "Yes",
    hasExperienceWithJira:                    "Yes",
    hasExperienceWithGithub:                  "Yes",
    hasExperienceWithGoogleWorkspace:         "Yes",
    hasExperienceWithMicrosoftOffice:         "Yes",
    hasExperienceWithLinkedInSalesNavigator:  "Yes",
    hasExperienceWithSalesloft:               "Yes",
    hasExperienceWithOutreach:                "Yes",
    hasExperienceWithZoomInfo:                "Yes",
    hasExperienceWithAiTools:                 "Yes",
    hasExperienceWithColdCalling:             "Yes",
    hasExperienceWithColdEmailing:            "Yes",
    hasExperienceWithOutboundSales:           "Yes",
    hasExperienceWithEnterpriseAccounts:      "Yes",
    hasExperienceWithB2BSales:                "Yes",
    hasExperienceWithSaaS:                    "Yes",
    hasExperienceWithAgile:                   "Yes",
    hasExperienceManagingProjects:            "Yes",
    hasExperienceWithRemoteWork:              "Yes",
    hasHomeOfficeSetup:                       "Yes",
    hasReliableInternet:                      "Yes",
    hasLaptopOrComputer:                      "Yes",
    comfortableWithVideoConferencing:         "Yes",
    comfortableWithColdCalling:               "Yes",
    comfortableWithSalesTargets:              "Yes",
    comfortableWithQuotas:                    "Yes",
    comfortableWithPerformanceMetrics:        "Yes",
    comfortableWithPresentingToStakeholders:  "Yes",
    comfortableWithOnCallDuties:              "Yes",

    // ── Soft Skills / Culture ─────────────────────────────────────────────────
    openToLearning:                           "Yes",
    openToFeedback:                           "Yes",
    comfortableWithAmbiguity:                 "Yes",
    comfortableInFastPacedEnvironment:        "Yes",
    isATeamPlayer:                            "Yes",
    canWorkIndependently:                     "Yes",
    isDetailOriented:                         "Yes",
    hasStrongCommunicationSkills:             "Yes",
    comfortableWithChangeManagement:          "Yes",
    comfortableWithMultitasking:              "Yes",
    willingToMentor:                          "Yes",
    willingToBeManaged:                       "Yes",
    comfortableWithFeedbackCulture:           "Yes",
    comfortableWithProbationaryPeriod:        "Yes",

    // ── Acknowledgements & Consents ───────────────────────────────────────────
    agreeToTermsAndConditions:                "Yes",
    agreeToPrivacyPolicy:                     "Yes",
    agreeToRecordingPolicy:                   "Yes",
    agreeToInterviewRecording:                "Yes",
    consentToAiScreening:                     "Yes",
    agreeToEqualOpportunityPolicy:            "Yes",
    acknowledgeJobRequirements:               "Yes",
    confirmAccuracyOfApplication:             "Yes",
    agreeToArbitrationPolicy:                 "Yes",
    consentToDataProcessing:                  "Yes",
    agreeToElectronicSignature:               "Yes",

    // ── Additional personal ───────────────────────────────────────────────────
    sexualOrientation:                        "Prefer not to say",
    maritalStatus:                            "Prefer not to say",
    nationality:                              "Indian",

    // ── Sourcing ──────────────────────────────────────────────────────────────
    howDidYouHear:                            "LinkedIn",
    referredByEmployee:                       "No",
    appliedBeforeAtThisCompany:               "No",
    hearAboutRoleViaJobBoard:                 "Yes",
  },
};

module.exports = { profileData };
