require("dotenv").config();
const express = require("express");
const cors    = require("cors");

const app = express();

// Reflect request origin so chrome-extension:// requests are accepted
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────────────────────────

const tailorRoute     = require("./routes/tailor");
const profileRoute    = require("./routes/profile");
const adaptersRoute   = require("./routes/adapters");
const aiFallbackRoute = require("./routes/ai-fallback");
const applyRoute      = require("./routes/apply");
const apiKeyAuth      = require("./services/apiKeyAuth");

// ─── Public Endpoints ─────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.send("Jobby API alive");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/tailor-resume", tailorRoute);

// ─── V2 Endpoints (auth required) ────────────────────────────────────────────

app.use("/profile",          apiKeyAuth, profileRoute);
app.use("/adapters",         apiKeyAuth, adaptersRoute);
app.use("/ai-resolve-field", apiKeyAuth, aiFallbackRoute);
app.use("/apply",            apiKeyAuth, applyRoute);

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
