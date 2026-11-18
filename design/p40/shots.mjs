// Screenshots of the prototype pages.
//   node --no-warnings design/p40/shots.mjs --out <dir> [--langs en,he] [--states off,open] [--widths 390,1440] [--text 125|200] [--full] [--strike]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "../../scripts/lib/browser.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : process.argv[i + 1]; };
const flag = (n) => process.argv.includes("--" + n);
const out = arg("out", path.join(HERE, "shots"));
const langs = arg("langs", "en,he,es,ru").split(",");
const states = arg("states", "off,open").split(",");
const widths = arg("widths", "390,1440").split(",").map(Number);
const text = arg("text", "");
fs.mkdirSync(out, { recursive: true });
const b = await launch();
for (const w of widths) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: Number(arg("dsf", w < 700 ? 2 : 1)) });
  const p = await ctx.newPage();
  for (const lang of langs) for (const st of states) {
    const name = `${lang}__${st}${flag("strike") ? "__strike" : ""}.html`;
    await p.goto(pathToFileURL(path.join(HERE, "out", name)).href);
    if (text) await p.evaluate((t) => { document.documentElement.style.fontSize = t + "%"; }, text);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    const file = path.join(out, `${lang}-${st}${flag("strike") ? "-strike" : ""}-${w}${text ? "-t" + text : ""}.png`);
    if (flag("full")) await p.screenshot({ path: file, fullPage: true });
    else { const el = await p.$(arg("sel", "main")); await el.screenshot({ path: file }); }
  }
  await ctx.close();
}
await b.close();
console.log("shots ->", out);
