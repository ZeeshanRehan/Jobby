// ─── Server Config ────────────────────────────────────────────────────────────
// DEV = true → talk to local server; false → VPS prod. Keep this false in commits.
const DEV = false;
const API_BASE = DEV ? "http://localhost:3000" : "http://178.105.161.45:3000";
const API_KEY  = "ba9ca71cb4c93bf607cda7b4789464fea4d174a8b89edc0abe0b3f07eb6e2304";
