// ─── Adapter Routes ──────────────────────────────────────────────────────────

const express = require("express");
const fs      = require("fs");
const path    = require("path");

const router = express.Router();

const ADAPTERS_DIR = path.join(__dirname, "../data/adapters");

function loadAdapter(platform) {
  const filePath = path.join(ADAPTERS_DIR, `${platform}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// Returns summary (platform, version, detect) — not the full adapter with selectors
router.get("/list", (req, res) => {
  const files = fs.readdirSync(ADAPTERS_DIR).filter((f) => f.endsWith(".json"));
  const list = files.map((f) => {
    const adapter = JSON.parse(fs.readFileSync(path.join(ADAPTERS_DIR, f), "utf-8"));
    return { platform: adapter.platform, version: adapter.version, detect: adapter.detect };
  });
  res.json(list);
});

router.get("/:platform", (req, res) => {
  const { platform } = req.params;
  const adapter = loadAdapter(platform);
  if (!adapter) return res.status(404).json({ error: `Adapter '${platform}' not found` });
  res.json(adapter);
});

module.exports = router;
