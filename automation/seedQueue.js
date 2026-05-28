// ─── Seed Queue Runner ───────────────────────────────────────────────────────
// Pulls jobs from the Greenhouse board source and enqueues them. Run directly:
//   node automation/seedQueue.js                  (uses SEED_TOKENS below)
//   node automation/seedQueue.js gitlab figma      (override tokens via argv)

const { fetchGreenhouseJobs } = require("./sources/greenhouseBoard");
const { enqueue }             = require("./queue/queue");

// TODO: placeholder list — swap for the real target companies once decided
const SEED_TOKENS = ["gitlab", "figma", "discord", "duolingo", "stripe"];

async function main() {
  const tokens = process.argv.slice(2).length ? process.argv.slice(2) : SEED_TOKENS;

  const { records, stats } = await fetchGreenhouseJobs(tokens);
  const enq = enqueue(records);

  console.log("── source ──", JSON.stringify(stats, null, 2));
  console.log("── enqueue ──", JSON.stringify(enq, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
