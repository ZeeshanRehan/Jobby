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
  defaultAnswers: {},
};

module.exports = { profileData };
