const http      = require("http");
const fs        = require("fs");
const path      = require("path");
const puppeteer = require("puppeteer-core");

const CHROME   = "/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome";
const DIR      = __dirname;
const AUTOFILL = fs.readFileSync(path.join(DIR, "..", "extension", "autofill.js"), "utf8");
const PORT     = 8099;
const MIME     = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const f = (req.url === "/" ? "/page.html" : req.url).split("?")[0];
      fs.readFile(path.join(DIR, f), (err, data) => {
        if (err) { res.writeHead(404); return res.end("nf"); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "text/plain" });
        res.end(data);
      });
    });
    s.listen(PORT, () => resolve(s));
  });
}

const results = [];
const check = (name, pass, detail) =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);

(async () => {
  const server  = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
  const page     = await browser.newPage();
  const pageLogs = [];
  page.on("console",   (m) => pageLogs.push(m.text()));
  page.on("pageerror", (e) => pageLogs.push("PAGEERROR " + e.message));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#ready[data-ready='1']", { timeout: 30000 });
  await page.waitForSelector(".select__input", { timeout: 30000 });

  await page.addScriptTag({ content: AUTOFILL });
  check("autofill api injected", await page.evaluate(() => !!window.__jobbyAutofill?.fillCombobox));

  // Fidelity: confirm the harness react-select matches Greenhouse (role=combobox + select__input)
  const inputHtml = await page.evaluate(() => document.querySelector("#country")?.outerHTML || "NONE");
  console.log("FIDELITY #country input:\n" + inputHtml + "\n");

  // T1 — detection
  const detected = await page.evaluate(() => window.__jobbyAutofill.isReactSelectCombobox(document.querySelector("#country")));
  check("T1 detect #country as combobox", detected === true, "got " + detected);

  // T2 — read options
  const opts = await page.evaluate(async () => await window.__jobbyAutofill.readComboboxOptions(document.querySelector("#country")));
  check("T2 read #country options", Array.isArray(opts) && opts.includes("United States") && opts.length === 4, JSON.stringify(opts));

  const shownValue = (fieldId) => page.evaluate((fid) => {
    const wrap = document.getElementById("field-" + fid);
    return {
      single: wrap?.querySelector(".select__single-value")?.textContent || null,
      multi:  [...(wrap?.querySelectorAll(".select__multi-value__label") || [])].map((x) => x.textContent),
    };
  }, fieldId);

  // T3 — fill single (yes/no)
  const ok3 = await page.evaluate(async () => await window.__jobbyAutofill.fillCombobox(document.querySelector("#work-auth"), "Yes"));
  const v3  = await shownValue("work-auth");
  check("T3 fill #work-auth = Yes", ok3 && v3.single === "Yes", `ok=${ok3} shown=${JSON.stringify(v3)}`);

  // T4 — fill single (gender exact)
  const ok4 = await page.evaluate(async () => await window.__jobbyAutofill.fillCombobox(document.querySelector("#gender"), "Male"));
  const v4  = await shownValue("gender");
  check("T4 fill #gender = Male", ok4 && v4.single === "Male", `ok=${ok4} shown=${JSON.stringify(v4)}`);

  // T5 — wording mismatch (canonical → verbose). Expected FAIL until task #2 is done.
  const ok5 = await page.evaluate(async () => await window.__jobbyAutofill.fillCombobox(document.querySelector("#ethnicity"), "South Asian / Indian"));
  const v5  = await shownValue("ethnicity");
  check("T5 fill #ethnicity = 'South Asian / Indian' (wording match)", v5.multi.some((x) => x.startsWith("South Asian")), `ok=${ok5} shown=${JSON.stringify(v5)}`);

  // T6 — answer is a substring of a more verbose option
  const ok6 = await page.evaluate(async () => await window.__jobbyAutofill.fillCombobox(document.querySelector("#timezone"), "Eastern Time"));
  const v6  = await shownValue("timezone");
  check("T6 fill #timezone = 'Eastern Time'", ok6 && v6.single === "Eastern Time (US & Canada)", `ok=${ok6} shown=${JSON.stringify(v6)}`);

  // T7 — nonsense answer must select NOTHING (no wrong-fill from the token fallback)
  const ok7 = await page.evaluate(async () => await window.__jobbyAutofill.fillCombobox(document.querySelector("#neg"), "Spaceship Helicopter"));
  const v7  = await shownValue("neg");
  check("T7 no-match #neg = 'Spaceship Helicopter' selects nothing", ok7 === false && v7.single === null, `ok=${ok7} shown=${JSON.stringify(v7)}`);

  await browser.close();
  server.close();

  const dbg = pageLogs.filter((l) => l.includes("combobox-debug"));
  const err = pageLogs.filter((l) => l.startsWith("PAGEERROR"));
  if (dbg.length) console.log("=== combobox-debug ===\n" + dbg.join("\n") + "\n");
  if (err.length) console.log("=== page errors ===\n" + err.join("\n") + "\n");
  console.log("=== RESULTS ===\n" + results.join("\n"));
})().catch((e) => { console.error("HARNESS_ERROR", (e && e.stack) || e); process.exit(1); });
