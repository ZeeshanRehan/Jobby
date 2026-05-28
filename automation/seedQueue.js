// ─── Seed Queue Runner ───────────────────────────────────────────────────────
// Pulls jobs from one or more board sources and enqueues them. Usage:
//   node automation/seedQueue.js                              (seeds all sources, default tokens)
//   node automation/seedQueue.js --source greenhouse          (single source, default tokens)
//   node automation/seedQueue.js --source ashby notable linear (override tokens)
//   node automation/seedQueue.js --source lever mistral palantir

const { fetchGreenhouseJobs } = require("./sources/greenhouseBoard");
const { fetchAshbyJobs }      = require("./sources/ashbyBoard");
const { fetchLeverJobs }      = require("./sources/leverBoard");
const { enqueue }             = require("./queue/queue");

// Default tokens per source — override via CLI args.
const DEFAULTS = {
  greenhouse: ["gitlab", "figma", "discord", "duolingo", "stripe"],
  ashby:      ["notable", "linear", "vanta", "ramp"],
  lever:      ["mistral", "palantir", "spotify"],
};

const FETCHERS = {
  greenhouse: fetchGreenhouseJobs,
  ashby:      fetchAshbyJobs,
  lever:      fetchLeverJobs,
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const sourceIdx = args.indexOf("--source");
  if (sourceIdx === -1) return { sources: ["greenhouse", "ashby", "lever"], tokens: null };
  const source = args[sourceIdx + 1];
  if (!source || !FETCHERS[source]) throw new Error(`unknown --source ${source}`);
  const tokens = args.slice(sourceIdx + 2).filter((t) => !t.startsWith("--"));
  return { sources: [source], tokens: tokens.length ? tokens : null };
}

async function main() {
  const { sources, tokens } = parseArgs(process.argv);

  for (const source of sources) {
    const list = tokens || DEFAULTS[source];
    console.log(`\n══ ${source} (${list.length} tokens) ══`);
    const { records, stats } = await FETCHERS[source](list);
    const enq = enqueue(records);
    console.log("── source ──", JSON.stringify(stats, null, 2));
    console.log("── enqueue ──", JSON.stringify(enq, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
