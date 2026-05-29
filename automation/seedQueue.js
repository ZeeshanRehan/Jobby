// ─── Seed Queue Runner ───────────────────────────────────────────────────────
// Pulls jobs from one or more board sources and enqueues them. Usage:
//   node automation/seedQueue.js                              (seeds all sources, default tokens)
//   node automation/seedQueue.js --source greenhouse          (single source, default tokens)
//   node automation/seedQueue.js --source ashby notable linear (override tokens)
//   node automation/seedQueue.js --source lever mistral palantir
//   node automation/seedQueue.js --source workday             (uses DEFAULTS.workday tuple list)
//
// NOTE: workday tokens are not flat strings — each entry is a {tenant, wd, site}
// tuple (Workday is multi-tenant, multi-DC, multi-site). CLI override of workday
// tokens isn't supported yet; edit DEFAULTS.workday or call fetchWorkdayJobs
// programmatically.

const { fetchGreenhouseJobs } = require("./sources/greenhouseBoard");
const { fetchAshbyJobs }      = require("./sources/ashbyBoard");
const { fetchLeverJobs }      = require("./sources/leverBoard");
const { fetchWorkdayJobs }    = require("./sources/workdayBoard");
const { enqueue }             = require("./queue/queue");

// Default tokens per source — override via CLI args (except workday — see top note).
const DEFAULTS = {
  greenhouse: ["gitlab", "figma", "discord", "duolingo", "stripe"],
  ashby:      ["notable", "linear", "vanta", "ramp"],
  lever:      ["mistral", "palantir", "spotify"],
  // Workday tuples — find these by visiting a tenant's careers page and inspecting
  // the URL: https://{tenant}.{wd}.myworkdayjobs.com/{site}. Site slugs vary per
  // tenant (External, NVIDIAExternalCareerSite, Careers, etc.).
  workday: [
    { tenant: "nvidia",     wd: "wd5",  site: "NVIDIAExternalCareerSite" },
    // Add tuples below as accounts/sites are confirmed. Commented entries are
    // best-guesses pending live verification of {wd, site} slugs.
    // { tenant: "salesforce", wd: "wd12", site: "External_Career_Site" },
    // { tenant: "disney",     wd: "wd1",  site: "disneycareer" },
    // { tenant: "adobe",      wd: "wd5",  site: "external_experienced" },
    // { tenant: "cisco",      wd: "wd1",  site: "External" },
  ],
};

const FETCHERS = {
  greenhouse: fetchGreenhouseJobs,
  ashby:      fetchAshbyJobs,
  lever:      fetchLeverJobs,
  workday:    fetchWorkdayJobs,
};

// Parses { sources, tokens } from argv. Tokens override per-source DEFAULTS for
// the flat-string sources only; workday tuples must be edited in code.
function parseArgs(argv) {
  const args = argv.slice(2);
  const sourceIdx = args.indexOf("--source");
  if (sourceIdx === -1) return { sources: ["greenhouse", "ashby", "lever", "workday"], tokens: null };
  const source = args[sourceIdx + 1];
  if (!source || !FETCHERS[source]) throw new Error(`unknown --source ${source}`);
  const tokens = args.slice(sourceIdx + 2).filter((t) => !t.startsWith("--"));
  return { sources: [source], tokens: tokens.length ? tokens : null };
}

async function main() {
  const { sources, tokens } = parseArgs(process.argv);

  for (const source of sources) {
    // workday ignores the flat-string tokens override; everything else uses it.
    const list = (source === "workday" || !tokens) ? DEFAULTS[source] : tokens;
    const label = source === "workday"
      ? `${list.length} tuples`
      : `${list.length} tokens`;
    console.log(`\n══ ${source} (${label}) ══`);
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
