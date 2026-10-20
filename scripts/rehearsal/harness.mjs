// Tiny assertion/result collector shared by the rehearsal test sections. Writes <evidence>/<section>.json and .md.
import fs from "node:fs";
import path from "node:path";
import { P, writeJson } from "./lib.mjs";

export class Section {
  constructor(name, title) { this.name = name; this.title = title; this.rows = []; this.notes = []; this.started = new Date().toISOString(); this.data = {}; }
  /** status: PASS | FAIL | INFO. `evidence` is a short string for the report table. */
  check(id, cond, detail = "", evidence = "") { this.rows.push({ id, status: cond ? "PASS" : "FAIL", detail: String(detail).slice(0, 600), evidence: String(evidence).slice(0, 400) }); if (!cond) console.error(`  FAIL ${id}${detail ? "  -- " + String(detail).slice(0, 300) : ""}`); return !!cond; }
  info(id, detail, evidence = "") { this.rows.push({ id, status: "INFO", detail: String(detail).slice(0, 800), evidence: String(evidence).slice(0, 400) }); }
  note(t) { this.notes.push(t); }
  get failed() { return this.rows.filter((r) => r.status === "FAIL").length; }
  get passed() { return this.rows.filter((r) => r.status === "PASS").length; }
  save() {
    fs.mkdirSync(P.evidence, { recursive: true });
    const base = path.join(P.evidence, this.name);
    writeJson(base + ".json", { section: this.name, title: this.title, started: this.started, finished: new Date().toISOString(), passed: this.passed, failed: this.failed, notes: this.notes, data: this.data, rows: this.rows });
    const md = [`# ${this.title}`, "", `Run: ${this.started} -> ${new Date().toISOString()}  |  PASS ${this.passed}  FAIL ${this.failed}  INFO ${this.rows.filter((r) => r.status === "INFO").length}`, "", ...this.notes.map((n) => `- ${n}`), "", "| # | status | check | detail / evidence |", "|---|---|---|---|"];
    this.rows.forEach((r, i) => md.push(`| ${i + 1} | ${r.status} | ${r.id.replace(/\|/g, "\\|")} | ${(r.detail + (r.evidence ? " :: " + r.evidence : "")).replace(/\|/g, "\\|").replace(/\n/g, " ")} |`));
    fs.writeFileSync(base + ".md", md.join("\n") + "\n");
    console.log(`  [${this.name}] PASS ${this.passed}  FAIL ${this.failed}  (${base}.md)`);
  }
}
