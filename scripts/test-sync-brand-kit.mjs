// Tests of scripts/sync-brand-kit.mjs against a TEMP theme (never a real Control Plane theme): --to copies byte-for-byte, --to removes stale kit files (only under
// assets/brand/), --dry-run changes nothing, --verify warns on stale files and --verify --strict fails on them and on drift.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/load.mjs";

const SCRIPT = path.join(ROOT, "scripts", "sync-brand-kit.mjs");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log("ok      " + name); } else { fail++; console.log("FAIL    " + name + (extra ? " :: " + extra : "")); } };
const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: "utf8" });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicc-brand-sync-"));
try {
  const theme = path.join(tmp, "theme");
  const kit = path.join(theme, "assets", "brand");
  fs.mkdirSync(theme, { recursive: true });
  let r = run("--to", theme);
  check("--to into an empty theme succeeds", r.status === 0, r.stderr);
  r = run("--verify", theme, "--strict");
  check("--verify --strict passes right after --to", r.status === 0, r.stderr);

  // a kit file that no longer exists upstream, one in a sub-directory, and a file OUTSIDE assets/brand that must never be touched
  fs.mkdirSync(path.join(kit, "old-dir", "deeper"), { recursive: true });
  fs.writeFileSync(path.join(kit, "removed-upstream.css"), "x");
  fs.writeFileSync(path.join(kit, "old-dir", "deeper", "gone.png"), "x");
  fs.mkdirSync(path.join(theme, "assets", "img"), { recursive: true });
  fs.writeFileSync(path.join(theme, "assets", "img", "keep.png"), "keep");
  fs.writeFileSync(path.join(theme, "style.css"), "/* theme */");
  const before = fs.readFileSync(path.join(kit, "MANIFEST.json"), "utf8");

  r = run("--verify", theme);
  check("--verify (default) only WARNS about stale files and still passes", r.status === 0 && /WARNING: 2 stale file/.test(r.stderr), r.stderr);
  r = run("--verify", theme, "--strict");
  check("--verify --strict FAILS on stale files", r.status === 1 && /stale removed-upstream\.css/.test(r.stderr) && /stale old-dir\/deeper\/gone\.png/.test(r.stderr), r.stderr);

  r = run("--to", theme, "--dry-run");
  check("--to --dry-run lists the stale files", r.status === 0 && /would remove 2 stale file/.test(r.stdout) && /removed-upstream\.css/.test(r.stdout) && /old-dir\/deeper\/gone\.png/.test(r.stdout), r.stdout);
  check("--dry-run removed nothing", fs.existsSync(path.join(kit, "removed-upstream.css")) && fs.existsSync(path.join(kit, "old-dir", "deeper", "gone.png")));

  r = run("--to", theme);
  check("--to removes the stale files and says which", r.status === 0 && /removed 2 stale file/.test(r.stdout) && /removed-upstream\.css/.test(r.stdout), r.stdout);
  check("...the stale files and their now-empty directories are gone", !fs.existsSync(path.join(kit, "removed-upstream.css")) && !fs.existsSync(path.join(kit, "old-dir")));
  check("...a file outside assets/brand is untouched", fs.readFileSync(path.join(theme, "assets", "img", "keep.png"), "utf8") === "keep" && fs.existsSync(path.join(theme, "style.css")));
  check("...the kit's MANIFEST.json copy is kept", fs.readFileSync(path.join(kit, "MANIFEST.json"), "utf8") === before);
  r = run("--verify", theme, "--strict");
  check("--verify --strict passes after the cleanup", r.status === 0, r.stderr);

  // drift is still caught
  const first = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "brand", "MANIFEST.json"), "utf8")).files).find((f) => f !== "aicc-tokens.css");
  fs.appendFileSync(path.join(kit, first), "x");
  r = run("--verify", theme, "--strict");
  check("a modified kit file is still reported as drift", r.status === 1 && r.stderr.includes("differs " + first), r.stderr);
  r = run("--to", theme);
  check("--to repairs the drift", r.status === 0 && run("--verify", theme, "--strict").status === 0);

  // a symlinked assets/brand is never followed or cleaned through
  const real = path.join(tmp, "elsewhere"); fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, "important.txt"), "do not delete");
  const theme2 = path.join(tmp, "theme2"); fs.mkdirSync(path.join(theme2, "assets"), { recursive: true });
  fs.symlinkSync(real, path.join(theme2, "assets", "brand"));
  r = run("--to", theme2, "--dry-run");
  check("a symlinked assets/brand is not enumerated by --dry-run", r.status === 0 && /would remove 0 stale/.test(r.stdout), r.stdout);
  run("--to", theme2);
  check("...and nothing in the link target is deleted by --to", fs.existsSync(path.join(real, "important.txt")));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nbrand-sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
