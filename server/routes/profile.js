// ─── Profile Routes ──────────────────────────────────────────────────────────

const express     = require("express");
const fs          = require("fs");
const path        = require("path");
const { profileData } = require("../data/profile");

const router = express.Router();

const PROFILE_PATH = path.join(__dirname, "../data/profile.js");

// mtime of profile.js drives cache invalidation in the extension
function getVersion() {
  return fs.statSync(PROFILE_PATH).mtime.toISOString();
}

router.get("/", (req, res) => {
  res.json({ version: getVersion(), data: profileData });
});

router.get("/version", (req, res) => {
  res.json({ version: getVersion() });
});

module.exports = router;
