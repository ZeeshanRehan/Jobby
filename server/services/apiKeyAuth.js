// ─── API Key Auth Middleware ─────────────────────────────────────────────────
// Applied to all V2 routes. x-api-key must match JOBBY_API_KEY in .env.

function apiKeyAuth(req, res, next) {
  // Skip OPTIONS — CORS preflight must pass through before auth check
  if (req.method === "OPTIONS") return next();

  const key = req.headers["x-api-key"];
  if (!key || key !== process.env.JOBBY_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

module.exports = apiKeyAuth;
