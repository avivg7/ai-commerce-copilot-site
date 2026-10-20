#!/usr/bin/env node
// AICC edge rehearsal, PHASE 2: REAL BROWSER flows (Chrome via playwright-core) through the already-running real-Caddy rehearsal edge.
//
//   node scripts/rehearsal/browser-flows.mjs [--only 1,3,5] [--keep-users] [--no-screenshots]      (or: npm run rehearsal:browser)
//
// Sections (one results .json + .md each, plus 00-summary, in ~/Downloads/AICC-cutover-evidence/rehearsal/phase2/, screenshots in phase2/screenshots/):
//   1 cookies+session (EN, HE)      2 csrf/nonces/no-store/back-button     3 password reset (EN, HE, ES, RU)       4 locale routing + link crawl
//   5 Watch demo (desktop, mobile, reduced motion, product, he/es/ru)      6 checkout infra (no payment)          7 structured data / SEO
//   8 performance (lightweight)     9 client IP in the browser path     10 round-4a public surface (CORS, users, feeds, footer, lang/dir, legal link, copy)
//
// Prerequisites (this script checks them and stops): the stack is running (`node scripts/rehearsal/rehearsal.mjs status`): real Caddy on :80/:443,
// the CP fixture on 127.0.0.1:18982 (`bash scripts/rehearsal/cp-fixture.sh status`). Names www.copilt.org and copilt.org map to 127.0.0.1 ONLY inside the
// launched Chrome (--host-resolver-rules); the rehearsal CA is trusted through --ignore-certificate-errors-spki-list (pins of root, intermediate, leaf).
//
// SAFETY: no payment is ever submitted (checkout is only loaded; the block checkout's own load-time totals call is the only POST); no public DNS or
// server is touched; only fake @example.test accounts are created in the disposable CP fixture, with random passwords that exist only in this process's
// memory (never written to a file, a result, a screenshot or a log) and are deleted at the end. Cookie VALUES, reset keys, nonces and passwords never appear in
// any output: cookies are reported by name/attributes only, reset keys only as the fact "present, N chars", and the edge log is searched for them.
// Port 8982 (QA), 8981/8983, 9111-9114 are never used. REST traffic is kept low (the CP rate-limits REST routes per IP).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import { P, REPO, INSTANCES, sleep, sh, req, cpEchoToken, writeJson, portListening } from "./lib.mjs";

const EDGE = INSTANCES.edge;
const BASE = "https://www.copilt.org";
const APEX = "https://copilt.org";
const OUT = path.join(P.evidence, "phase2");
const SHOTS = path.join(OUT, "screenshots");
const CHROME = process.env.AICC_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LOCALES = ["en", "he", "es", "ru"];
const pre = (l) => (l === "en" ? "" : `/${l}`);
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = (() => { const i = args.indexOf("--only"); return i >= 0 ? args[i + 1].split(",").map((x) => x.trim()) : null; })();
const KEEP_USERS = flag("--keep-users");
const NO_SHOTS = flag("--no-screenshots");
const RUN_ID = crypto.randomBytes(3).toString("hex");

/* ------------------------------------------------------------------ result collector */
class Result {
  constructor(id, title) { this.id = id; this.title = title; this.rows = []; this.notes = []; this.data = {}; this.started = new Date().toISOString(); this.findings = []; }
  /** label: VERIFIED (observed in this run) | INFERRED | UNVERIFIED. */
  check(name, cond, detail = "", label = "VERIFIED") {
    this.rows.push({ name, status: cond ? "PASS" : "FAIL", label, detail: String(detail).slice(0, 700) });
    if (!cond) console.error(`  FAIL [${this.id}] ${name}${detail ? "  -- " + String(detail).slice(0, 300) : ""}`);
    return !!cond;
  }
  info(name, detail = "", label = "VERIFIED") { this.rows.push({ name, status: "INFO", label, detail: String(detail).slice(0, 900) }); }
  note(t) { this.notes.push(t); }
  finding(severity, text) { this.findings.push({ severity, text }); }
  get failed() { return this.rows.filter((r) => r.status === "FAIL").length; }
  get passed() { return this.rows.filter((r) => r.status === "PASS").length; }
  verdict() { return this.failed ? (this.passed ? "PARTIAL" : "FAIL") : "PASS"; }
  save() {
    fs.mkdirSync(OUT, { recursive: true });
    const base = path.join(OUT, this.id);
    writeJson(base + ".json", { section: this.id, title: this.title, started: this.started, finished: new Date().toISOString(), passed: this.passed, failed: this.failed, verdict: this.verdict(), notes: this.notes, findings: this.findings, data: this.data, rows: this.rows });
    const md = [`# ${this.title}`, "", `Run ${RUN_ID}: ${this.started} -> ${new Date().toISOString()} | PASS ${this.passed} FAIL ${this.failed} INFO ${this.rows.filter((r) => r.status === "INFO").length} | ${this.verdict()}`, "", ...this.notes.map((n) => `- ${n}`), ""];
    if (this.findings.length) md.push("Findings:", ...this.findings.map((f) => `- [${f.severity}] ${f.text}`), "");
    md.push("| # | status | label | check | detail |", "|---|---|---|---|---|");
    this.rows.forEach((r, i) => md.push(`| ${i + 1} | ${r.status} | ${r.label} | ${r.name.replace(/\|/g, "\\|")} | ${r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`));
    fs.writeFileSync(base + ".md", md.join("\n") + "\n");
    console.log(`  [${this.id}] ${this.verdict()}: PASS ${this.passed} FAIL ${this.failed}  (${base}.md)`);
  }
}

/* ------------------------------------------------------------------ small utilities */
const cookieHashRe = /[0-9a-f]{32}/g;
const normName = (n) => n.replace(cookieHashRe, "<hash>");
const rand = (n = 9) => crypto.randomBytes(n).toString("base64url");
const redact = (s) => String(s).replace(/([?&](?:key|login|pass|password|pwd|token|nonce|_wpnonce|reset)=)[^&"'\s<>]*/gi, "$1REDACTED");
const wp = (...a) => sh("bash", [P.cpFixture, "wp", ...a]);
const wpOut = (...a) => wp(...a).stdout.trim().split("\n").filter((l) => !/^(PHP |Deprecated|Warning|Notice)/i.test(l)).pop() || "";

async function shot(page, name, o = {}) {
  if (NO_SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  try { await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: !!o.full, mask: [page.locator("input[type=password]"), page.locator("input[name=user_login], input[name=username], #reg_email, input[type=email]")], animations: "disabled" }); } catch (e) { void e; }
}

/** Disposable fake accounts in the CP fixture. The password exists only here (memory), is passed to wp-cli on the command line of a local process and is never logged. */
const createdUsers = [];
function createUser(tag) {
  const login = `bf-${tag}-${RUN_ID}`.toLowerCase();
  const email = `${login}@example.test`;
  const password = `Bf-${rand(10)}-7a!`;
  const id = wpOut("user", "create", login, email, "--role=customer", `--user_pass=${password}`, "--porcelain");
  if (!/^\d+$/.test(id)) throw new Error(`could not create fixture user ${login}`);
  createdUsers.push(id);
  return { id, login, email, password };
}
function setPassword(user, password) { wp("user", "update", user.id, `--user_pass=${password}`); user.password = password; }
function cleanupUsers() { if (KEEP_USERS) return; for (const id of createdUsers.splice(0)) wp("user", "delete", id, "--yes"); }

/* ------------------------------------------------------------------ the mailbox (captured .eml) */
function mailList() { try { return fs.readdirSync(P.mail).filter((f) => f.endsWith(".eml")).map((f) => ({ f, t: fs.statSync(path.join(P.mail, f)).mtimeMs })).sort((a, b) => a.t - b.t); } catch { return []; } }
async function waitMail(to, since, subjectRe, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const m of mailList().reverse()) {
      if (m.t < since - 1500) continue;
      const raw = fs.readFileSync(path.join(P.mail, m.f), "utf8");
      const head = raw.slice(0, raw.indexOf("\n\n") > 0 ? raw.indexOf("\n\n") : 800);
      if (!new RegExp(`^To:.*${to.replace(/[.+]/g, "\\$&")}`, "mi").test(head)) continue;
      if (subjectRe && !subjectRe.test(head)) continue;
      return { file: m.f, raw, head };
    }
    await sleep(400);
  }
  return null;
}
const mailLinks = (raw) => [...raw.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

/* ------------------------------------------------------------------ cookies, sanitized */
function parseSetCookie(h) {
  const parts = h.split(";").map((s) => s.trim());
  const eq = parts[0].indexOf("=");
  const name = parts[0].slice(0, eq);
  const val = parts[0].slice(eq + 1);
  const a = { name, emptyValue: val === "" || /^deleted$/i.test(val), attrs: {} };
  for (const p of parts.slice(1)) { const i = p.indexOf("="); const k = (i < 0 ? p : p.slice(0, i)).toLowerCase(); a.attrs[k] = i < 0 ? true : p.slice(i + 1); }
  return a;
}
function expiryClass(attrs, dateHeader) {
  if ("max-age" in attrs) { const s = Number(attrs["max-age"]); if (s <= 0) return "deleted"; return humanSecs(s); }
  if (attrs.expires) { const d = Date.parse(attrs.expires), base = dateHeader ? Date.parse(dateHeader) : Date.now(); const s = (d - base) / 1000; if (s <= 0) return "deleted"; return humanSecs(s); }
  return "session";
}
function humanSecs(s) { if (s >= 86400 * 300) return `~${Math.round(s / 86400 / 365)}y`; if (s >= 86400) return `~${Math.round(s / 86400)}d`; if (s >= 3600) return `~${Math.round(s / 3600)}h`; return `~${Math.round(s / 60)}min`; }
function jarExpiry(c) { if (!(c.expires > 0)) return "session"; return humanSecs(c.expires - Date.now() / 1000); }

/** Wrap a browser context: records every Set-Cookie (sanitized: name + attributes, NEVER values) and the Cookie request header names per request. */
function instrument(ctx) {
  const log = { setCookies: [], requests: [], responses: [] };
  ctx.on("response", async (res) => {
    try {
      const u = res.url();
      if (!/^https?:\/\/(www\.)?copilt\.org/.test(u)) return;
      const hs = await res.headersArray();
      const date = hs.find((h) => h.name.toLowerCase() === "date")?.value;
      const sc = hs.filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => ({ ...parseSetCookie(h.value), expiry: "" }));
      for (const c of sc) c.expiry = expiryClass(c.attrs, date);
      log.responses.push({ url: redact(u), status: res.status(), method: res.request().method(), setCookieCount: sc.length, cc: hs.find((h) => h.name.toLowerCase() === "cache-control")?.value || "", location: redact(hs.find((h) => h.name.toLowerCase() === "location")?.value || "") });
      for (const c of sc) log.setCookies.push({ url: redact(u).replace(BASE, "").replace(APEX, "(apex)"), host: new URL(u).host, status: res.status(), name: normName(c.name), domain: c.attrs.domain ?? null, path: c.attrs.path ?? null, secure: !!c.attrs.secure, httpOnly: !!c.attrs.httponly, sameSite: c.attrs.samesite ?? null, expiry: c.expiry, cleared: c.expiry === "deleted" || c.emptyValue });
    } catch { /* page closed */ }
  });
  ctx.on("request", async (rq) => {
    try {
      const u = rq.url();
      if (!/^https?:\/\/(www\.)?copilt\.org/.test(u)) return;
      const hs = await rq.allHeaders();
      log.requests.push({ url: redact(u), host: new URL(u).host, cookieNames: (hs.cookie || "").split(/;\s*/).filter(Boolean).map((c) => normName(c.split("=")[0])) });
    } catch { /* closed */ }
  });
  return log;
}
async function jar(ctx, urls) {
  const cs = urls ? await ctx.cookies(urls) : await ctx.cookies();
  return cs.map((c) => ({ name: normName(c.name), domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expiry: jarExpiry(c) }));
}
const jarRow = (c) => `${c.name} | ${c.domain} | ${c.path} | ${c.secure} | ${c.httpOnly} | ${c.sameSite} | ${c.expiry}`;
/** Cookie names the platform sets on purpose without HttpOnly (WooCommerce's cart-fragments script and the language switcher read them in JS). */
const JS_READABLE_OK = new Set(["aicc_lang", "woocommerce_items_in_cart", "woocommerce_cart_hash", "wordpress_test_cookie"]);
const SECURE_EXCEPTIONS = new Set(); // none: the CP makes WooCommerce's cart markers Secure too (AICC_LM_Commerce_UX::harden_cart_cookie_options)

/* ------------------------------------------------------------------ browser */
let SPKI = "";
function spkiPins() {
  if (SPKI) return SPKI;
  const spkiOf = (cmd) => sh("bash", ["-c", `${cmd} | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`]).stdout.trim();
  SPKI = [`cat ${P.rootCrt}`, `cat ${path.dirname(P.rootCrt)}/intermediate.crt`, `echo | openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org 2>/dev/null`].map(spkiOf).filter(Boolean).join(",");
  return SPKI;
}
let BROWSER = null;
async function browser() {
  if (BROWSER) return BROWSER;
  BROWSER = await chromium.launch({
    executablePath: CHROME,
    args: ["--host-resolver-rules=MAP www.copilt.org 127.0.0.1, MAP copilt.org 127.0.0.1", `--ignore-certificate-errors-spki-list=${spkiPins()}`, "--disable-features=CertificateTransparencyComponentUpdater"],
  });
  return BROWSER;
}
const PROFILES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  reduced: { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" },
  mobileReduced: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: "reduce" },
};
async function newCtx(profile = "desktop", extra = {}) {
  const b = await browser();
  const ctx = await b.newContext({ ...PROFILES[profile], locale: extra.locale || "en-US", ...extra.ctx });
  ctx.setDefaultTimeout(20000);
  ctx.setDefaultNavigationTimeout(30000);
  return ctx;
}
async function closeBrowser() { if (BROWSER) { try { await BROWSER.close(); } catch { /* gone */ } BROWSER = null; } }

/** Page facts used all over: language, direction, title, robots meta, canonical, hreflang, JSON-LD, links. */
async function facts(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      url: location.href, title: document.title, lang: document.documentElement.lang, dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction,
      bodyDir: getComputedStyle(document.body).direction, h1: (q("h1")?.textContent || "").trim().slice(0, 120),
      robots: q('meta[name="robots"]')?.content || "", canonical: q('link[rel="canonical"]')?.href || "",
      hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => [l.getAttribute("hreflang"), l.href]),
      jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || ""),
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, cookie: document.cookie.split(/;\s*/).filter(Boolean).map((c) => c.split("=")[0]),
    };
  });
}
async function allLinks(page, scope = "a[href]") {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].map((a) => ({ href: a.href, raw: a.getAttribute("href"), text: (a.textContent || a.getAttribute("aria-label") || "").trim().slice(0, 50), where: a.closest("header,[role=banner]") ? "header" : a.closest("footer,[role=contentinfo]") ? "footer" : a.closest("nav") ? "nav" : "body" })), scope);
}
const goto = async (page, url, o = {}) => page.goto(url, { waitUntil: "load", ...o });
const text = async (page, sel = "body") => (await page.locator(sel).first().innerText().catch(() => "")) || "";

async function login(page, user, prefix = "") {
  await goto(page, `${BASE}${prefix}/my-account/`);
  await page.fill("#username", user.login);
  await page.fill("#password", user.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("form.login button[type=submit]")]);
}
const isLoggedInPage = async (page) => (await page.locator(".woocommerce-MyAccount-navigation").count()) > 0;

/* ================================================================== 1. COOKIES AND SESSION */
function assertCookieHygiene(R, label, jarRows, log) {
  const wrong = jarRows.filter((c) => c.domain !== "www.copilt.org");
  R.check(`${label}: every cookie in the jar is host-only on www.copilt.org (no leading dot, no apex, no api host)`, jarRows.length > 0 && wrong.length === 0, wrong.length ? JSON.stringify(wrong.map((c) => `${c.name}@${c.domain}`)) : `${jarRows.length} cookies`);
  const withDomainAttr = log.setCookies.filter((c) => c.domain !== null);
  R.check(`${label}: no Set-Cookie header in the whole flow carries a Domain= attribute`, withDomainAttr.length === 0, JSON.stringify(withDomainAttr.map((c) => c.name)));
  const insecure = [...new Set(log.setCookies.filter((c) => !c.secure && !c.cleared).map((c) => c.name))];
  const unexpectedInsecure = insecure.filter((n) => !SECURE_EXCEPTIONS.has(n));
  R.check(`${label}: every Set-Cookie is Secure (WooCommerce's cart markers included)`, unexpectedInsecure.length === 0, `non-Secure: ${JSON.stringify(insecure)}`);
  R.info(`${label}: cookies set WITHOUT Secure`, JSON.stringify(insecure));
  const cartNoSame = log.setCookies.filter((c) => /^(woocommerce_items_in_cart|woocommerce_cart_hash|wp_woocommerce_session_)/.test(c.name) && !c.cleared && String(c.sameSite).toLowerCase() !== "lax");
  R.check(`${label}: WooCommerce cart/session cookies carry an explicit SameSite=Lax`, cartNoSame.length === 0, JSON.stringify(cartNoSame.map((c) => [c.name, c.sameSite])));
  const authNoSame = [...new Set(log.setCookies.filter((c) => /^wordpress_(logged_in|sec)_/.test(c.name) && !c.cleared && !c.sameSite).map((c) => c.name))];
  R.info(`${label}: WordPress auth cookies without an explicit SameSite attribute (Chrome applies Lax by default; Firefox/Safari treat the absence differently)`, JSON.stringify(authNoSame));
  const nonHttpOnly = [...new Set(jarRows.filter((c) => !c.httpOnly).map((c) => c.name))];
  const badNonHttpOnly = nonHttpOnly.filter((n) => !JS_READABLE_OK.has(n));
  R.check(`${label}: every cookie is HttpOnly except the deliberate JS-readable ones (aicc_lang, WooCommerce cart markers)`, badNonHttpOnly.length === 0, `non-HttpOnly: ${JSON.stringify(nonHttpOnly)}`);
  R.check(`${label}: no cookie uses SameSite=None; none outside Path=/ except WordPress's own wp-admin / wp-content/plugins / reset-password paths`, jarRows.every((c) => c.sameSite !== "None") && jarRows.every((c) => c.path === "/" || /^(\/wp-admin|\/wp-content\/plugins|(\/(he|es|ru))?\/my-account\/lost-password\/?)$/.test(c.path)), JSON.stringify([...new Set(jarRows.map((c) => c.path))]));
  const byName = {};
  for (const c of jarRows) (byName[c.name] ||= []).push(c);
  const dup = Object.entries(byName).filter(([n, l]) => l.length > 1 && !/^wordpress_sec_/.test(n));
  R.check(`${label}: no duplicate or conflicting cookie (same name twice with different path/domain); wordpress_sec_* has its two standard paths`, dup.length === 0, JSON.stringify(dup.map(([n, l]) => `${n}: ${l.map((c) => c.path).join(",")}`)));
  R.check(`${label}: no sbjs_* (Order Attribution) tracking cookie, in the jar or in any Set-Cookie`, !jarRows.some((c) => /^sbjs_/.test(c.name)) && !log.setCookies.some((c) => /^sbjs_/.test(c.name)));
  const apexSets = log.setCookies.filter((c) => c.host === "copilt.org");
  R.check(`${label}: nothing ever sets a cookie from the apex host copilt.org`, apexSets.length === 0, JSON.stringify(apexSets.map((c) => c.name)));
}

async function jsCookieNames(page) { return page.evaluate(() => document.cookie.split(/;\s*/).filter(Boolean).map((c) => c.split("=")[0])); }
const fingerprint = async (ctx, nameRe) => crypto.createHash("sha256").update((await ctx.cookies()).filter((c) => nameRe.test(c.name)).map((c) => c.name + "=" + c.value).sort().join("|")).digest("hex").slice(0, 10);
const cartRows = async (page) => {
  // the block cart paints skeleton rows (no text) first; wait until every row has content, or the empty-cart view is shown
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll(".wc-block-cart-items__row, tr.cart_item")];
    if (rows.length) return rows.every((r) => /\d/.test(r.textContent || ""));
    return !!document.querySelector(".wp-block-woocommerce-empty-cart-block, .wc-block-cart__empty-cart__title, .cart-empty") && !document.querySelector(".wc-block-cart.is-loading");
  }, null, { timeout: 20000 }).catch(() => {});
  return page.evaluate(() => [...document.querySelectorAll(".wc-block-cart-items__row, tr.cart_item")].filter((r) => /\d/.test(r.textContent || "")).length);
};

async function cookieFlow(R, loc, store) {
  const p = pre(loc), L = `[${loc}]`;
  const ctx = await newCtx("desktop", { locale: loc === "he" ? "he-IL" : "en-US" });
  const log = instrument(ctx);
  const page = await ctx.newPage();
  try {
    // anonymous: no cookie at all from static or CP pages
    for (const u of [`${p}/`, `${p}/product/`, `${p}/pricing/`, `${p}/my-account/`]) await goto(page, BASE + u);
    const anon = await ctx.cookies();
    R.check(`${L} anonymous visits (static home + product, CP pricing + sign-in) set no cookie at all`, anon.length === 0 && log.setCookies.length === 0, `jar=${anon.length} set-cookie headers=${log.setCookies.length}`);
    const f0 = await facts(page);
    R.check(`${L} sign-in page: html lang/dir correct`, loc === "he" ? f0.dir === "rtl" && /^he/.test(f0.lang) : f0.dir === "ltr" && /^en/.test(f0.lang), `${f0.lang}/${f0.dir}`);
    await shot(page, `01-${loc}-signin-anonymous`);

    // register through the real form
    const email = `bf-reg-${loc}-${RUN_ID}@example.test`;
    const t0 = Date.now();
    await page.fill("#reg_email", email);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("form.register button[type=submit]")]);
    R.check(`${L} registration through ${p}/my-account/ logs the new customer in and lands on the localized account page`, (await isLoggedInPage(page)) && page.url() === `${BASE}${p}/my-account/`, redact(page.url()));
    const uid = wpOut("user", "get", email, "--field=ID");
    const ulogin = wpOut("user", "get", email, "--field=user_login");
    if (/^\d+$/.test(uid)) createdUsers.push(uid);
    const user = { id: uid, login: ulogin, email, password: `Bf-${rand(10)}-7a!` };
    const mail = await waitMail(email, t0, /account/i, 15000);
    const mlinks = mail ? mailLinks(mail.raw).filter((h) => /lost-password/.test(h)) : [];
    R.check(`${L} new-account email captured; its set-password link is https://www.copilt.org${p}/my-account/lost-password/?action=newaccount...`, mlinks.length > 0 && mlinks.every((h) => h.startsWith(`${BASE}${p}/my-account/lost-password/?`)), mlinks.map(redact).join(" "));
    await shot(page, `01-${loc}-registered-account`);
    const afterLogin = await jar(ctx);
    R.info(`${L} cookies right after registration`, afterLogin.map(jarRow).join("; "));
    R.check(`${L} login produced wordpress_logged_in_* at Path=/ plus wordpress_sec_* at /wp-admin and /wp-content/plugins, all Secure+HttpOnly`, afterLogin.some((c) => /^wordpress_logged_in_/.test(c.name) && c.path === "/" && c.secure && c.httpOnly) && afterLogin.filter((c) => /^wordpress_sec_/.test(c.name)).length === 2 && afterLogin.filter((c) => /^wordpress_sec_/.test(c.name)).every((c) => c.secure && c.httpOnly), afterLogin.map((c) => c.name + c.path).join(","));
    setPassword(user, user.password); // known password (the generated one was only ever in the email); wp-cli's password change also invalidates the registration session, so sign in normally
    await login(page, user, p);
    R.check(`${L} after the registration session is invalidated, signing in with the password at ${p}/my-account/ works`, await isLoggedInPage(page), redact(page.url()));

    // session persistence static -> CP -> static ...
    const fp0 = await fingerprint(ctx, /^wordpress_logged_in_/);
    const hops = [`${p}/`, `${p}/my-account/`, `${p}/product/`, `${p}/pricing/`, `${p}/data-and-trust/`, `${p}/my-account/`, `${p}/questions/`, `${p}/my-account/aicc-licenses/`];
    const hopRes = [];
    const logStart = log.responses.length;
    for (const u of hops) {
      const r = await goto(page, BASE + u);
      const logged = await isLoggedInPage(page);
      const js = await jsCookieNames(page);
      hopRes.push({ u, status: r.status(), loggedNav: logged, js });
    }
    const cpHops = hopRes.filter((h) => /my-account/.test(h.u));
    R.check(`${L} session persists static -> CP -> static -> CP: every /my-account/ hop is authenticated (${cpHops.length} hops)`, cpHops.every((h) => h.status === 200 && h.loggedNav), JSON.stringify(cpHops.map((h) => [h.u, h.status, h.loggedNav])));
    const staticHops = log.responses.slice(logStart).filter((r) => /^https:\/\/www\.copilt\.org(\/(he|es|ru))?\/(product|data-and-trust|questions)?\/?$/.test(r.url));
    R.check(`${L} static pages (served by Caddy) answered 200 with no Set-Cookie while logged in`, staticHops.length >= 3 && staticHops.every((r) => r.status === 200 && r.setCookieCount === 0), JSON.stringify(staticHops.map((r) => [r.url.replace(BASE, ""), r.status, r.setCookieCount])));
    const fp1 = await fingerprint(ctx, /^wordpress_logged_in_/);
    R.check(`${L} the login cookie is not rotated or rewritten by static/CP hops (fingerprint equal)`, fp0 === fp1);
    const jsAll = [...new Set(hopRes.flatMap((h) => h.js))];
    R.check(`${L} document.cookie on static + CP pages exposes only the deliberate JS-readable names (never wordpress_*, wp_woocommerce_session_*, aicc_plan)`, jsAll.every((n) => JS_READABLE_OK.has(n)), `seen: ${JSON.stringify(jsAll)}`);
    const staticReq = log.requests.filter((r) => /^https:\/\/www\.copilt\.org(\/(he|es|ru))?\/(product|data-and-trust|questions)?\/?$/.test(r.url));
    R.info(`${L} cookie NAMES the browser sends to static pages`, JSON.stringify([...new Set(staticReq.flatMap((r) => r.cookieNames))]) + " (host-only cookies go to the same host; Caddy ignores them for static files)");

    // account navigation: Plans & Stores
    await goto(page, `${BASE}${p}/my-account/`);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator('.woocommerce-MyAccount-navigation a[href*="aicc-licenses"]').first().click()]);
    const fl = await facts(page);
    R.check(`${L} account navigation: Plans & Stores opens ${p}/my-account/aicc-licenses/ in the right language and direction`, page.url() === `${BASE}${p}/my-account/aicc-licenses/` && (loc === "he" ? fl.dir === "rtl" : fl.dir === "ltr"), `${redact(page.url())} ${fl.lang}/${fl.dir} h1="${fl.h1}"`);
    await shot(page, `01-${loc}-plans-and-stores`);

    // add a plan to the cart from the CP pricing page
    await goto(page, `${BASE}${p}/pricing/`);
    const planLink = page.locator('a[href*="add-to-cart=10"]').first();
    const planHref = await planLink.getAttribute("href");
    R.check(`${L} pricing plan button is the localized add-to-cart link (${p}/checkout/?add-to-cart=10)`, planHref === `${BASE}${p}/checkout/?add-to-cart=10`, planHref);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), planLink.click()]);
    R.check(`${L} add-to-cart redirects to ${p}/checkout/ (one WordPress redirect, prefix kept)`, page.url() === `${BASE}${p}/checkout/`, redact(page.url()));
    await page.waitForSelector(".wc-block-checkout, .woocommerce-checkout", { timeout: 20000 }).catch(() => {});
    await shot(page, `01-${loc}-checkout-with-plan`);
    const cartCk = await jar(ctx);
    R.check(`${L} cart cookies appear after add-to-cart: wp_woocommerce_session_* (Secure, HttpOnly), woocommerce_items_in_cart, woocommerce_cart_hash`, ["wp_woocommerce_session_<hash>", "woocommerce_items_in_cart", "woocommerce_cart_hash"].every((n) => cartCk.some((c) => c.name === n)) && cartCk.filter((c) => /wp_woocommerce_session_/.test(c.name)).every((c) => c.secure && c.httpOnly), cartCk.map((c) => c.name).join(","));
    // persistence: reload, new tab, across hops
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".wc-block-checkout, .woocommerce-checkout", { timeout: 20000 }).catch(() => {});
    const reloaded = await text(page, "main");
    R.check(`${L} cart survives a reload (checkout still shows the plan and $99)`, /99/.test(reloaded), reloaded.replace(/\s+/g, " ").slice(0, 100));
    const tab2 = await ctx.newPage();
    await goto(tab2, `${BASE}${p}/cart/`);
    const rows2 = await cartRows(tab2);
    R.check(`${L} cart is visible in a NEW TAB of the same browser (${p}/cart/ has ${rows2} line)`, rows2 === 1, `rows=${rows2}`);
    await shot(tab2, `01-${loc}-cart-new-tab`);
    await goto(tab2, `${BASE}${p}/product/`);
    await goto(tab2, `${BASE}${p}/`);
    await goto(tab2, `${BASE}${p}/cart/`);
    const rows3 = await cartRows(tab2);
    R.check(`${L} cart survives CP -> static -> static -> CP hops (still ${rows3} line, still logged in)`, rows3 === 1, `rows=${rows3}`);
    await tab2.close();

    // language cookie must NOT have been set by any of this
    const langNow = (await ctx.cookies()).filter((c) => c.name === "aicc_lang");
    R.check(`${L} no aicc_lang cookie after all of the above (it is only set by an explicit click on the language menu)`, langNow.length === 0 && !log.setCookies.some((c) => c.name === "aicc_lang"));

    // logout
    await goto(page, `${BASE}${p}/my-account/`);
    const logoutHref = redact((await page.locator('a[href*="customer-logout"]').first().getAttribute("href")) || "");
    R.check(`${L} logout link is the localized WooCommerce logout (${p}/my-account/customer-logout/?_wpnonce=...)`, logoutHref.startsWith(`${BASE}${p}/my-account/customer-logout/?`), logoutHref);
    const preLogoutJar = await jar(ctx);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator('a[href*="customer-logout"]').first().click()]);
    const postLogout = await jar(ctx);
    R.check(`${L} after logout the login, secure and session cookies are cleared (jar: ${postLogout.map((c) => c.name).join(",") || "empty"})`, !postLogout.some((c) => /^wordpress_(logged_in|sec)_|^wp_woocommerce_session_/.test(c.name)), JSON.stringify(postLogout.map((c) => c.name)));
    const clears = log.setCookies.filter((c) => c.cleared && /wordpress_logged_in_|wordpress_sec_|wp_woocommerce_session_/.test(c.name));
    R.check(`${L} the clearing Set-Cookie headers reuse the original Path (no orphan cookie left at another path)`, clears.length >= 3 && clears.every((c) => c.domain === null), JSON.stringify(clears.map((c) => `${c.name}${c.path}`)));
    R.check(`${L} post-logout state: ${p}/my-account/ shows the sign-in form, not account navigation`, !(await isLoggedInPage(page)) && (await page.locator("form.login").count()) === 1, redact(page.url()));
    await goto(page, `${BASE}${p}/cart/`);
    const rowsOut = await cartRows(page);
    R.check(`${L} post-logout the cart page is empty (no cart bleed to the logged-out browser)`, rowsOut === 0, `rows=${rowsOut}`);
    await shot(page, `01-${loc}-after-logout-cart`);

    // login again
    await login(page, user, p);
    R.check(`${L} login again with the password works`, (await isLoggedInPage(page)) && page.url() === `${BASE}${p}/my-account/`, redact(page.url()));
    const fp2 = await fingerprint(ctx, /^wordpress_logged_in_/);
    R.check(`${L} the new session has a fresh login cookie (differs from the first session)`, fp2 !== fp1);
    await goto(page, `${BASE}${p}/cart/`);
    const rowsBack = await cartRows(page);
    R.info(`${L} cart after logging in again (WooCommerce persistent cart)`, `rows=${rowsBack}`);

    const finalJar = await jar(ctx);
    store[loc] = { afterLogin: preLogoutJar, final: finalJar, setCookieHeaders: dedupeSetCookies(log.setCookies) };
    assertCookieHygiene(R, `${L} cookie hygiene`, [...preLogoutJar], log);
    // the apex/api scoping from the jar itself
    R.check(`${L} the jar holds no cookie for copilt.org (apex) or api.copilt.org`, (await jar(ctx, [APEX + "/", "https://api.copilt.org/"])).length === 0);
    return { ctx, log, page, user };
  } catch (e) {
    R.check(`${L} flow completed without an exception`, false, String(e.stack || e).slice(0, 500));
    await ctx.close().catch(() => {});
    return null;
  }
}
function dedupeSetCookies(list) {
  const seen = new Map();
  for (const c of list) { const k = [c.name, c.path, c.secure, c.httpOnly, c.sameSite, c.expiry, c.cleared, c.host].join("|"); if (!seen.has(k)) seen.set(k, { ...c, count: 0 }); seen.get(k).count++; }
  return [...seen.values()];
}

async function s1() {
  const R = new Result("01-cookies-session", "Phase 2 / 1: cookies and session in a real browser (EN and HE)");
  const store = {};
  const live = [];
  for (const loc of ["en", "he"]) { const r = await cookieFlow(R, loc, store); if (r) live.push(r); }
  for (const [l, v] of Object.entries(store)) {
    R.note(`Cookie jar ${l.toUpperCase()} (right before logout: registered, signed in, plan in cart) -- name | domain | path | secure | httpOnly | sameSite | expiry. Values are never recorded.`);
    for (const c of v.afterLogin) R.note(`  ${jarRow(c)}`);
    R.note(`Set-Cookie headers seen during the ${l.toUpperCase()} flow (deduplicated; name, path, Secure, HttpOnly, SameSite attribute as SENT (null = none sent), expiry, cleared): ` + v.setCookieHeaders.filter((c) => !c.cleared).map((c) => `${c.name} ${c.path} S=${c.secure} H=${c.httpOnly} SS=${c.sameSite} ${c.expiry}`).join("; "));
  }
  R.data.cookieTables = Object.fromEntries(Object.entries(store).map(([l, v]) => [l, { jarBeforeLogout: v.afterLogin.map(jarRow), jarFinal: v.final.map(jarRow), setCookieHeaders: v.setCookieHeaders }]));

  // language cookie scoping, on a clean browser
  const ctx = await newCtx("desktop");
  const log = instrument(ctx);
  const page = await ctx.newPage();
  try {
    await goto(page, `${BASE}/he/`);
    await goto(page, `${BASE}/he/product/`);
    R.check("direct entry to static /he/ and /he/product/ sets no cookie (language is never auto-persisted)", (await ctx.cookies()).length === 0);
    // static language menu: ES
    await page.locator(".aicc-lang__btn:visible").first().click();
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator('.aicc-lang__menu:visible a[data-lang="es"]').first().click()]);
    let lc = (await ctx.cookies()).filter((c) => c.name === "aicc_lang");
    R.check("clicking Espanol in the STATIC language menu sets exactly one aicc_lang cookie: host-only www, Path=/, Secure, not HttpOnly (JS-set), SameSite=Lax, about 1 year", lc.length === 1 && lc[0].domain === "www.copilt.org" && lc[0].path === "/" && lc[0].secure && !lc[0].httpOnly && lc[0].sameSite === "Lax" && /y|~36\dd|~1y/.test(jarExpiry(lc[0])) && lc[0].value === "es", JSON.stringify(lc.map((c) => [c.name, c.domain, c.path, c.secure, c.httpOnly, c.sameSite, jarExpiry(c), c.value])));
    R.check("... and it navigated to /es/product/ (the current page persisted in the new language)", page.url() === `${BASE}/es/product/`, page.url());
    // CP language menu: HE on a CP page
    await goto(page, `${BASE}/es/pricing/`);
    await page.locator(".aicc-lang__btn:visible").first().click();
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator('.aicc-lang__menu:visible a[data-lang="he"]').first().click()]);
    lc = (await ctx.cookies()).filter((c) => c.name === "aicc_lang");
    R.check("clicking Hebrew in the CP language menu rewrites the SAME cookie (still exactly one aicc_lang, same path, value he; no duplicate at a different path)", lc.length === 1 && lc[0].path === "/" && lc[0].value === "he" && lc[0].secure && lc[0].sameSite === "Lax", JSON.stringify(lc.map((c) => [c.path, c.value, c.secure, c.sameSite])));
    R.check("... and it navigated to /he/pricing/", page.url() === `${BASE}/he/pricing/`, page.url());
    // behaviour with the cookie present
    await goto(page, `${BASE}/pricing/`);
    const fCookie = await facts(page);
    R.info("CP honours the cookie on an unprefixed URL (documented order: URL prefix -> cookie -> default)", `/pricing/ with aicc_lang=he renders lang=${fCookie.lang} dir=${fCookie.dir} title="${fCookie.title}"`);
    await goto(page, `${BASE}/`);
    const fHome = await facts(page);
    R.check("static / with aicc_lang=he does NOT redirect or switch language (it only suggests): stays on / with html lang=en", page.url() === `${BASE}/` && fHome.lang === "en", `${page.url()} lang=${fHome.lang}`);
    const jarLang = await jar(ctx);
    R.check("the language jar after both menu clicks: one aicc_lang and nothing else", jarLang.length === 1 && jarLang[0].name === "aicc_lang", jarLang.map(jarRow).join("; "));
    R.data.languageCookie = jarLang.map(jarRow);
    assertCookieHygiene(R, "[language flow] cookie hygiene", jarLang, log);

    // apex: one hop, no Set-Cookie on the redirect, no Cookie header sent to the apex
    const apexLog = [];
    const onResp = async (res) => { const u = new URL(res.url()); if (u.host === "copilt.org" || u.host === "www.copilt.org") apexLog.push({ host: u.host, status: res.status(), loc: redact((await res.headerValue("location")) || ""), sc: (await res.headersArray()).filter((h) => h.name.toLowerCase() === "set-cookie").length, url: redact(res.url()) }); };
    const onReq = async (rq) => { const u = new URL(rq.url()); if (u.host === "copilt.org") { const h = await rq.allHeaders(); apexLog.push({ host: "REQ copilt.org", cookieHeader: !!h.cookie }); } };
    page.on("response", onResp); page.on("request", onReq);
    for (const [from, to] of [[`${APEX}/he/pricing/?x=1`, `${BASE}/he/pricing/?x=1`], [`${APEX}/`, `${BASE}/`], [`${APEX}/ru/my-account/`, `${BASE}/ru/my-account/`], [`${APEX}/es/product/`, `${BASE}/es/product/`]]) {
      apexLog.length = 0;
      await goto(page, from);
      const hopsToWww = apexLog.filter((x) => x.host === "copilt.org");
      const reqs = apexLog.filter((x) => x.host === "REQ copilt.org");
      R.check(`apex ${from.replace(APEX, "https://copilt.org")} -> single 301/308 hop to ${to.replace(BASE, "www")}, no Set-Cookie on the redirect, no Cookie header sent to the apex, final URL correct`, hopsToWww.length === 1 && [301, 308].includes(hopsToWww[0].status) && hopsToWww[0].loc === to && hopsToWww[0].sc === 0 && reqs.length === 1 && !reqs[0].cookieHeader && page.url() === to, JSON.stringify({ hops: hopsToWww.map((h) => [h.status, h.loc, h.sc]), cookieSentToApex: reqs.map((r) => r.cookieHeader), final: redact(page.url()) }));
    }
    // plain http on the apex/www (browser has no HSTS pin for the apex)
    for (const from of ["http://copilt.org/he/pricing/", "http://www.copilt.org/es/product/"]) {
      apexLog.length = 0;
      await goto(page, from);
      const sc = apexLog.reduce((n, x) => n + (x.sc || 0), 0);
      R.check(`${from} -> ends on https://www.copilt.org with the same path, no Set-Cookie on the way`, page.url() === `${BASE}${new URL(from).pathname}` && sc === 0, `${redact(page.url())} hops=${apexLog.filter((x) => x.status).map((x) => x.status).join(">")} set-cookie=${sc}`);
    }
    page.off("response", onResp); page.off("request", onReq);
    R.check("after every apex/http visit the jar is still only aicc_lang on www.copilt.org (nothing leaked or duplicated)", (await jar(ctx)).length === 1 && (await ctx.cookies()).every((c) => c.domain === "www.copilt.org"));
  } catch (e) { R.check("language/apex cookie flow completed", false, String(e.stack || e).slice(0, 500)); }
  await ctx.close().catch(() => {});
  for (const r of live) await r.ctx.close().catch(() => {});
  R.save();
  return R;
}

/* ================================================================== 2. CSRF / NONCES / no-store / back button */
const fetchIn = (page, url, init = {}) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, { credentials: "same-origin", ...i });
  const t = await r.text();
  return { status: r.status, cc: r.headers.get("cache-control") || "", nonceHeader: r.headers.get("nonce") ? "present" : "", type: r.headers.get("content-type") || "", body: t.slice(0, 220), bodyLen: t.length };
}, [url, init]);

async function s2() {
  const R = new Result("02-csrf-nonces", "Phase 2 / 2: CSRF and nonces, no-store, back button after logout");
  const user = createUser("csrf");
  const ctx = await newCtx("desktop");
  const page = await ctx.newPage();
  try {
    // --- a) tampered login nonce on the real sign-in form
    await goto(page, `${BASE}/my-account/`);
    await page.fill("#username", user.login); await page.fill("#password", user.password);
    await page.evaluate(() => { const n = document.querySelector("#woocommerce-login-nonce"); n.value = n.value.slice(0, -2) + (n.value.endsWith("aa") ? "bb" : "aa"); });
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("form.login button[type=submit]")]);
    const loggedAfterTamper = await isLoggedInPage(page);
    const cookiesAfterTamper = (await ctx.cookies()).filter((c) => /^wordpress_logged_in_/.test(c.name));
    R.check("TAMPERED login nonce (hidden field altered in the real form, valid credentials): the login is rejected, no session cookie is issued", !loggedAfterTamper && cookiesAfterTamper.length === 0, `logged-in nav=${loggedAfterTamper} login cookies=${cookiesAfterTamper.length} url=${redact(page.url())}`);
    await shot(page, "02-tampered-login-nonce-rejected");
    R.info("what the visitor sees after the rejected login", (await text(page, "main")).replace(/\s+/g, " ").slice(0, 160));
    await login(page, user);
    R.check("control: the same credentials with the untampered nonce log in", await isLoggedInPage(page));

    // --- b) stale logout nonce (bound to the OLD session token)
    const oldLogout = await page.locator('a[href*="customer-logout"]').first().getAttribute("href");
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator('a[href*="customer-logout"]').first().click()]);
    await login(page, user);
    const resp = await page.goto(oldLogout, { waitUntil: "load" });
    await goto(page, `${BASE}/my-account/`);
    R.check("STALE logout nonce (link from the previous session replayed in the new session): not logged out", await isLoggedInPage(page), `GET stale logout link -> HTTP ${resp.status()}; still signed in=${await isLoggedInPage(page)}`);
    const cur = await page.locator('a[href*="customer-logout"]').first().getAttribute("href");
    await goto(page, cur.replace(/_wpnonce=[^&]+/, "_wpnonce=0000000000"));
    await goto(page, `${BASE}/my-account/`);
    R.check("TAMPERED logout nonce: not logged out", await isLoggedInPage(page));

    // --- c) add to cart, then the checkout AJAX nonce and the Store API nonce, valid and tampered
    await goto(page, `${BASE}/checkout/?add-to-cart=11`);
    await page.waitForSelector(".wc-block-checkout, .woocommerce-checkout", { timeout: 20000 }).catch(() => {});
    R.check("add-to-cart (plan Studio) through the edge works in the browser: /checkout/ with the plan", page.url() === `${BASE}/checkout/` && /199/.test(await text(page, "main")), redact(page.url()));
    const ajaxNonce = await page.evaluate(() => (typeof wc_checkout_params !== "undefined" ? wc_checkout_params.update_order_review_nonce : ""));
    R.check("the checkout page exposes a WooCommerce update_order_review nonce to its script", /^[0-9a-f]{8,12}$/.test(ajaxNonce), `nonce length ${ajaxNonce.length}`);
    const ur = (sec) => fetchIn(page, "/?wc-ajax=update_order_review", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: new URLSearchParams({ security: sec, payment_method: "", country: "US", state: "", postcode: "", city: "", address: "", address_2: "", s_country: "US", has_full_address: "false", post_data: "" }).toString() });
    const urBad = await ur("0000000000");
    const urOk = await ur(ajaxNonce);
    R.check("TAMPERED update_order_review nonce through the edge: rejected (403 / -1), not a 200 with fragments", urBad.status === 403 || /^-1/.test(urBad.body), JSON.stringify({ status: urBad.status, body: urBad.body.slice(0, 40), cc: urBad.cc }));
    R.check("valid update_order_review nonce through the edge: 200", urOk.status === 200, JSON.stringify({ status: urOk.status, type: urOk.type, body: urOk.body.slice(0, 60), cc: urOk.cc }));
    R.check("both AJAX answers are Cache-Control: private, no-store (edge-forced)", /no-store/.test(urBad.cc) && /no-store/.test(urOk.cc), `${urBad.cc} | ${urOk.cc}`);
    const cart = await page.evaluate(async () => { const r = await fetch("/wp-json/wc/store/v1/cart", { credentials: "same-origin" }); const j = await r.json().catch(() => ({})); return { status: r.status, nonce: r.headers.get("nonce") || "", items: (j.items || []).map((i) => i.id), cc: r.headers.get("cache-control") || "" }; });
    R.check("Store API: GET /wp-json/wc/store/v1/cart works through the edge, returns a Nonce header and the plan, no-store", cart.status === 200 && cart.nonce.length >= 8 && cart.items.includes(11) && /no-store/.test(cart.cc), JSON.stringify({ status: cart.status, nonceLen: cart.nonce.length, items: cart.items, cc: cart.cc }));
    const add = (n, id) => page.evaluate(async ([nonce, pid]) => { const r = await fetch("/wp-json/wc/store/v1/cart/add-item", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Nonce: nonce }, body: JSON.stringify({ id: pid, quantity: 1 }) }); const j = await r.json().catch(() => ({})); return { status: r.status, code: j.code || "", cc: r.headers.get("cache-control") || "" }; }, [n, id]);
    const addBad = await add("tampered00", 10);
    const addNone = await add("", 10);
    R.check("Store API POST /cart/add-item with a TAMPERED Nonce header: 401/403 woocommerce_rest_invalid_nonce, cart unchanged", [401, 403].includes(addBad.status) && /nonce/i.test(addBad.code), JSON.stringify(addBad));
    R.check("Store API POST /cart/add-item with NO Nonce header (logged in): rejected", [401, 403].includes(addNone.status), JSON.stringify(addNone));
    const cartAfterBad = await page.evaluate(async () => (await (await fetch("/wp-json/wc/store/v1/cart", { credentials: "same-origin" })).json()).items.map((i) => i.id));
    R.check("... and the cart still holds only the Studio plan after the rejected writes (the disposable cart was not changed)", cartAfterBad.length === 1 && cartAfterBad[0] === 11, JSON.stringify(cartAfterBad));
    R.info("checkout order submission nonce (woocommerce-process-checkout-nonce / POST /wp-json/wc/store/v1/checkout)", "NOT exercised by design: submitting the checkout, even with a bad nonce, is a payment-path POST and is forbidden in this rehearsal. The block checkout's own load-time totals call (POST ...checkout?__experimental_calc_totals=true, no order is placed) is observed in section 6.", "UNVERIFIED");

    // --- d) no-store on the personalized pages, in the browser, EN and HE
    const personalized = [`/cart/`, `/checkout/`, `/my-account/`, `/my-account/aicc-licenses/`, `/he/cart/`, `/he/checkout/`, `/he/my-account/`, `/my-account/lost-password/`];
    const ccRows = [];
    for (const u of personalized) {
      const r = await page.goto(BASE + u, { waitUntil: "load" });
      const h = await r.allHeaders();
      ccRows.push({ u, status: r.status(), cc: h["cache-control"] || "", pragma: h["pragma"] || "", expires: h["expires"] || "" });
    }
    R.check("cart / checkout / account pages (EN, HE, logged in) come back Cache-Control: private, no-store, max-age=0 from the edge", ccRows.every((r) => r.status === 200 && /no-store/.test(r.cc) && /private/.test(r.cc)), JSON.stringify(ccRows.map((r) => [r.u, r.status, r.cc])));
    R.data.noStore = ccRows;
    const stat = [];
    for (const u of ["/", "/product/", "/he/"]) { const r = await page.goto(BASE + u, { waitUntil: "load" }); stat.push([u, (await r.allHeaders())["cache-control"] || ""]); }
    R.check("static pages are NOT no-store (public, must-revalidate): the personalization boundary is exact", stat.every(([, c]) => /must-revalidate/.test(c) && !/no-store/.test(c)), JSON.stringify(stat));
  } catch (e) { R.check("csrf flow completed", false, String(e.stack || e).slice(0, 600)); }
  await ctx.close().catch(() => {});

  // --- e) back / forward after logout, with bfcache REALLY enabled (Playwright disables it by default)
  const b2 = await chromium.launch({ executablePath: CHROME, ignoreDefaultArgs: ["--disable-back-forward-cache"], args: ["--host-resolver-rules=MAP www.copilt.org 127.0.0.1, MAP copilt.org 127.0.0.1", `--ignore-certificate-errors-spki-list=${spkiPins()}`, "--enable-features=BackForwardCache"] });
  const ctx2 = await b2.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx2.newPage();
  await pg.addInitScript(() => { if (!window.__marker) window.__marker = Math.random().toString(36).slice(2); window.addEventListener("pageshow", (e) => { (window.__shows = window.__shows || []).push(e.persisted); }); });
  const nav = [];
  pg.on("request", (rq) => { if (rq.isNavigationRequest()) nav.push(rq.url().replace(BASE, "")); });
  try {
    await goto(pg, `${BASE}/product/`);
    const m1 = await pg.evaluate(() => window.__marker);
    await goto(pg, `${BASE}/questions/`);
    await pg.goBack({ waitUntil: "load" });
    await pg.waitForTimeout(800);
    const m2 = await pg.evaluate(() => ({ marker: window.__marker, shows: window.__shows }));
    R.info("control: bfcache availability in this Chrome (static /product/ -> /questions/ -> Back)", `restored from bfcache=${m2.marker === m1} pageshow.persisted=${JSON.stringify(m2.shows)}`);

    await login(pg, user);
    await goto(pg, `${BASE}/my-account/aicc-licenses/`);
    const markerAuth = await pg.evaluate(() => window.__marker);
    await Promise.all([pg.waitForNavigation({ waitUntil: "load" }), pg.locator('a[href*="customer-logout"]').first().click()]);
    R.check("logout from the licenses page lands on the sign-in form", !(await isLoggedInPage(pg)) && (await pg.locator("form.login").count()) === 1, redact(pg.url()));
    nav.length = 0;
    await pg.goBack({ waitUntil: "load" });
    await pg.waitForTimeout(800);
    const back = await pg.evaluate(() => ({ marker: window.__marker, shows: window.__shows, url: location.href }));
    const authed = await isLoggedInPage(pg);
    const body = await text(pg, "main");
    const restored = back.marker === markerAuth;
    R.check("BACK after logout to the authenticated /my-account/aicc-licenses/: authenticated content is NOT shown (no nav, sign-in form instead), and it was not restored from bfcache", !authed && !restored && (await pg.locator("form.login").count()) === 1, `url=${redact(back.url)} restoredFromBfcache=${restored} persisted=${JSON.stringify(back.shows)} navigationRequests=${JSON.stringify(nav.map(redact))} signedInNav=${authed}`);
    R.info("what Back shows after logout", `${redact(back.url)}: ${body.replace(/\s+/g, " ").slice(0, 120)}`);
    R.data.backAfterLogout = { restoredFromBfcache: restored, persisted: back.shows, signedInNav: authed, navigationRequests: nav.map(redact) };
    await shot(pg, "02-back-after-logout");
    await pg.goForward({ waitUntil: "load" });
    R.check("FORWARD from there also shows the sign-in state", !(await isLoggedInPage(pg)));
    await login(pg, user);
    await goto(pg, `${BASE}/checkout/?add-to-cart=10`);
    await goto(pg, `${BASE}/my-account/`);
    await Promise.all([pg.waitForNavigation({ waitUntil: "load" }), pg.locator('a[href*="customer-logout"]').first().click()]);
    await pg.goBack({ waitUntil: "load" });
    await pg.goBack({ waitUntil: "load" });
    await pg.waitForTimeout(1200);
    const co = await text(pg, "body");
    R.check("BACK twice after logout to /checkout/: no email, no plan or address shown from cache (the checkout re-requests and demands sign-in)", !/@example\.test/.test(co) && !(await isLoggedInPage(pg)), `url=${redact(pg.url())} ${co.replace(/\s+/g, " ").slice(0, 120)}`);
    await shot(pg, "02-back-to-checkout-after-logout");
  } catch (e) { R.check("back-button flow completed", false, String(e.stack || e).slice(0, 600)); }
  await b2.close().catch(() => {});
  R.save();
  return R;
}

/* ================================================================== 3. PASSWORD RESET */
const fileHas = (file, needle) => { try { return fs.readFileSync(file, "utf8").includes(needle); } catch { return null; } };
function logCount(file, re) { try { return fs.readFileSync(file, "utf8").split("\n").filter((l) => re.test(l)).length; } catch { return -1; } }

async function resetFlow(R, loc, keys) {
  const p = pre(loc), L = `[${loc}]`;
  const user = createUser(`rst-${loc}`);
  const oldPassword = user.password;
  const newPassword = `Bf-${rand(10)}-9z!`;
  const ctx = await newCtx("desktop", { locale: { en: "en-US", he: "he-IL", es: "es-ES", ru: "ru-RU" }[loc] });
  const log = instrument(ctx);
  const page = await ctx.newPage();
  try {
    await goto(page, `${BASE}${p}/my-account/lost-password/`);
    const f0 = await facts(page);
    const want = { en: ["en", "ltr"], he: ["he", "rtl"], es: ["es", "ltr"], ru: ["ru", "ltr"] }[loc];
    R.check(`${L} the language-prefixed lost-password page loads (${p}/my-account/lost-password/) with html lang ${want[0]} dir ${want[1]}`, page.url() === `${BASE}${p}/my-account/lost-password/` && f0.lang.toLowerCase().startsWith(want[0]) && f0.dir === want[1], `${redact(page.url())} lang=${f0.lang} dir=${f0.dir} title="${f0.title}"`);
    R.check(`${L} the request form is present and has the reset nonce`, (await page.locator("form.lost_reset_password #user_login").count()) === 1 && (await page.locator('input[name="woocommerce-lost-password-nonce"]').count()) === 1);
    await shot(page, `03-${loc}-lost-password-form`);
    const t0 = Date.now();
    await page.fill("#user_login", user.email);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click('form.lost_reset_password button[type="submit"]')]);
    const sentText = (await text(page, "main")).replace(/\s+/g, " ");
    R.check(`${L} after the request the prefixed confirmation page is shown (reset-link-sent)`, page.url().startsWith(`${BASE}${p}/my-account/lost-password/`) && /reset-link-sent=true/.test(page.url()), `${redact(page.url())} :: ${sentText.slice(0, 110)}`);
    await shot(page, `03-${loc}-reset-link-sent`);
    const mail = await waitMail(user.email, t0, /password|סיסמ|contraseñ|парол/i, 20000);
    R.check(`${L} the reset email was captured`, !!mail, mail ? mail.head.split("\n").find((l) => /^Subject:/.test(l)) : "no mail");
    const links = mail ? mailLinks(mail.raw).filter((h) => /lost-password/.test(h) && /key=/.test(h)) : [];
    const link = links[0] || "";
    const u = link ? new URL(link) : null;
    const key = u ? u.searchParams.get("key") || "" : "";
    if (key) keys.push(key);
    R.check(`${L} reset link is https://www.copilt.org${p}/my-account/lost-password/?... (host, scheme, prefix and path exact; has key and login/id params)`, !!u && u.origin === BASE && u.pathname === `${p}/my-account/lost-password/` && key.length >= 16 && (u.searchParams.has("login") || u.searchParams.has("id")), u ? `${u.origin}${u.pathname}?${[...u.searchParams.keys()].join("&")} (key ${key.length} chars)` : "no link");
    R.check(`${L} no other link in the email points to another origin (mail host/prefix consistent)`, !!mail && mailLinks(mail.raw).filter((h) => /^https?:/.test(h)).every((h) => new URL(h).origin === BASE), mail ? [...new Set(mailLinks(mail.raw).filter((h) => /^https?:/.test(h)).map((h) => new URL(h).origin))].join(",") : "");
    if (!link) throw new Error("no reset link");

    // open the link in the browser (fresh page in the same context)
    const resp = await page.goto(link, { waitUntil: "load" });
    const f1 = await facts(page);
    const rc = (await ctx.cookies()).filter((c) => /^wp-resetpass-/.test(c.name));
    R.check(`${L} opening the emailed link lands on the prefixed reset form with the key REMOVED from the address bar (WooCommerce redirect)`, page.url().startsWith(`${BASE}${p}/my-account/lost-password/`) && !/key=/.test(page.url()) && (await page.locator("#password_1").count()) === 1, `status ${resp.status()} -> ${redact(page.url())}`);
    R.check(`${L} the reset form is in the right language/direction (lang ${want[0]}, dir ${want[1]})`, f1.lang.toLowerCase().startsWith(want[0]) && f1.dir === want[1], `lang=${f1.lang} dir=${f1.dir} h1="${f1.h1}"`);
    R.check(`${L} the wp-resetpass-* cookie: host-only, Secure, HttpOnly, Path covers the prefixed form (${p}/my-account/lost-password)`, rc.length === 1 && rc[0].domain === "www.copilt.org" && rc[0].secure && rc[0].httpOnly && `${p}/my-account/lost-password/`.startsWith(rc[0].path.endsWith("/") ? rc[0].path : rc[0].path + "/") && rc[0].path !== "/" , JSON.stringify(rc.map((c) => ({ name: normName(c.name), domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expiry: jarExpiry(c) }))));
    R.data[`resetCookie_${loc}`] = rc.map(jarRow0);
    await shot(page, `03-${loc}-reset-form`);
    await page.fill("#password_1", newPassword);
    await page.fill("#password_2", newPassword);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click('form.lost_reset_password button[type="submit"]')]);
    const okTxt = (await text(page, "main")).replace(/\s+/g, " ");
    R.check(`${L} setting the new password succeeds: back on the prefixed page with password-reset=true and the localized success message`, page.url().startsWith(`${BASE}${p}/my-account/`) && /password-reset=true/.test(page.url()) && okTxt.length > 20, `${redact(page.url())} :: ${okTxt.slice(0, 140)}`);
    await shot(page, `03-${loc}-reset-success`);
    R.check(`${L} the reset cookie is cleared after success`, !(await ctx.cookies()).some((c) => /^wp-resetpass-/.test(c.name)));
    // does WooCommerce sign the customer in after a reset? (record it), then sign out and log in with the new password; the old one is dead
    await goto(page, `${BASE}${p}/my-account/`);
    const autoLogin = await isLoggedInPage(page);
    R.info(`${L} signed in automatically after the reset?`, String(autoLogin));
    if (autoLogin) await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator('a[href*="customer-logout"]').first().click()]);
    await login(page, { ...user, password: newPassword }, p);
    R.check(`${L} login with the NEW password works at ${p}/my-account/`, await isLoggedInPage(page), redact(page.url()));
    const ctx2 = await newCtx("desktop");
    const pg2 = await ctx2.newPage();
    await login(pg2, { ...user, password: oldPassword }, p);
    R.check(`${L} the OLD password no longer works`, !(await isLoggedInPage(pg2)));
    // the used key is dead
    await goto(pg2, link);
    R.check(`${L} replaying the used reset link shows no reset form (key invalid/expired)`, (await pg2.locator("#password_1").count()) === 0, redact(pg2.url()));
    await ctx2.close();
    R.check(`${L} no Set-Cookie of the reset flow has a Domain= attribute and none is sent from the apex`, !log.setCookies.some((c) => c.domain !== null || c.host !== "www.copilt.org"), JSON.stringify(log.setCookies.filter((c) => /resetpass/.test(c.name)).map((c) => [normName(c.name), c.path, c.secure, c.httpOnly, c.sameSite, c.expiry])));
  } catch (e) { R.check(`${L} reset flow completed`, false, String(e.stack || e).slice(0, 600)); }
  await ctx.close().catch(() => {});
}
const jarRow0 = (c) => `${normName(c.name)} | ${c.domain} | ${c.path} | ${c.secure} | ${c.httpOnly} | ${c.sameSite} | ${jarExpiry(c)}`;

async function s3() {
  const R = new Result("03-password-reset", "Phase 2 / 3: password reset through the edge in a real browser (EN, HE, ES, RU)");
  const keys = [];
  for (const loc of LOCALES) await resetFlow(R, loc, keys);
  // the reset keys must not appear in the edge access/error logs, nor in the CP upstream log (both redact); php -S's own access log is a fixture artifact
  const edgeLog = path.join(P.logs, "aicc-edge.log"), errLog = path.join(P.logs, "error.log"), upLog = path.join(P.logs, "cp-upstream.log"), phpLog = path.join(P.logs, "cp-php-access.log");
  await sleep(1500);
  const leaksEdge = keys.filter((k) => fileHas(edgeLog, k) || fileHas(errLog, k));
  R.check(`edge access log and error log contain none of the ${keys.length} reset keys (checked by searching for each key value)`, keys.length === 4 && leaksEdge.length === 0, `keys=${keys.length} leaks=${leaksEdge.length}`);
  const redactedLines = logCount(edgeLog, /lost-password[^"]*key=REDACTED/);
  R.check("the edge log does contain the reset requests, with key=REDACTED in the logged URI (so the redaction, not absence, is what protects it)", redactedLines >= 4, `${redactedLines} log lines with lost-password ... key=REDACTED`);
  R.check("the CP upstream request log (fixture) also holds no reset key", keys.filter((k) => fileHas(upLog, k)).length === 0);
  const phpLeak = keys.filter((k) => fileHas(phpLog, k)).length;
  R.info("php -S's own access log (cp-php-access.log, a fixture artifact of the PHP built-in server, NOT the edge)", `${phpLeak} of ${keys.length} reset keys appear in it. The production origin web server (nginx/Apache/PHP-FPM) has its own access log: it must not record the query string of /my-account/lost-password/ (or must redact key=) the way the edge does. Ops item for the origin log format.`, "INFERRED");
  R.save();
  return R;
}

/* ================================================================== 4. LOCALE ROUTING + LINK CRAWL */
const LANG_EXPECT = { en: { lang: /^en/i, dir: "ltr" }, he: { lang: /^he/i, dir: "rtl" }, es: { lang: /^es/i, dir: "ltr" }, ru: { lang: /^ru/i, dir: "ltr" } };
const STATIC_PAGES = ["/", "/product/", "/data-and-trust/"];
const CP_PAGES = ["/pricing/", "/my-account/", "/cart/"];
function badHref(href) {
  let u; try { u = new URL(href); } catch { return null; }
  if (u.protocol === "javascript:") return "javascript: URL";
  if (!/^https?:$/.test(u.protocol)) return null;
  if (u.protocol === "http:") return "http:// link";
  if (u.host !== "www.copilt.org") return `non-www origin ${u.host}`;
  if (/^\/ai[_-]?copilot/i.test(u.pathname)) return "old GitHub Pages path";
  return null;
}
const ownerOf = (headers) => ((headers["x-rehearsal-upstream"] || "") === "wordpress" ? "CP" : "static");
/** Follow redirects with curl through the edge (no browser), returning the chain and the final HTML head facts. */
const httpCache = new Map();
async function chase(url) {
  if (httpCache.has(url)) return httpCache.get(url);
  const chain = [];
  let cur = url, last = null;
  for (let i = 0; i < 5; i++) {
    const r = await req(EDGE, cur, { timeout: 40 });
    last = r;
    chain.push({ url: redact(cur).replace(BASE, ""), status: r.status });
    if (r.status >= 300 && r.status < 400 && r.headers.location) cur = new URL(r.headers.location, cur).toString(); else break;
  }
  const html = last && /text\/html/.test(last.headers["content-type"] || "") ? last.body : "";
  const lang = (/<html[^>]*\blang="([^"]*)"/i.exec(html) || [])[1] || "";
  const dir = (/<html[^>]*\bdir="([^"]*)"/i.exec(html) || [])[1] || "";
  const out = { chain, status: last?.status, final: new URL(cur).pathname + new URL(cur).search, finalHost: new URL(cur).host, lang, dir, owner: ownerOf(last?.headers || {}), isHtml: !!html };
  httpCache.set(url, out);
  return out;
}

async function s4() {
  const R = new Result("04-locale-routing", "Phase 2 / 4: locale routing, language menu, direct entry, apex, RTL and link crawl (EN, HE, ES, RU; static and CP)");
  const extHosts = new Map(); const violations = []; const pageFacts = [];
  const crawl = { pages: 0, uniqueTargets: 0, byLocale: {}, dead: [], prefixViolations: [], langViolations: [] };

  for (const loc of LOCALES) {
    const p = pre(loc), L = `[${loc}]`;
    const ctx = await newCtx("desktop", { locale: { en: "en-US", he: "he-IL", es: "es-ES", ru: "ru-RU" }[loc] });
    ctx.on("request", (rq) => { try { const h = new URL(rq.url()).host; if (h !== "www.copilt.org" && !/^(data|blob|about):/.test(rq.url())) extHosts.set(`${h}`, (extHosts.get(h) || 0) + 1); } catch { /* noop */ } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 100)));
    try {
      /* ---- A. crawl: header + footer links on 3 static and 3 CP pages */
      const targets = new Map();
      for (const [kind, list] of [["static", STATIC_PAGES], ["cp", CP_PAGES]]) for (const pth of list) {
        const resp = await goto(page, `${BASE}${p}${pth}`);
        const f = await facts(page);
        const hdrs = await resp.allHeaders();
        const links = await allLinks(page);
        const hf = links.filter((l) => l.where === "header" || l.where === "footer" || l.where === "nav");
        pageFacts.push({ loc, kind, url: pth, status: resp.status(), owner: ownerOf(hdrs), lang: f.lang, dir: f.dir, links: links.length, headerFooterLinks: hf.length });
        R.check(`${L} ${kind} ${p}${pth}: 200, html lang=${LANG_EXPECT[loc].lang.source}, dir=${LANG_EXPECT[loc].dir}, served by ${kind === "cp" ? "WordPress" : "the static site"}`, resp.status() === 200 && LANG_EXPECT[loc].lang.test(f.lang) && f.dir === LANG_EXPECT[loc].dir && ownerOf(hdrs) === (kind === "cp" ? "CP" : "static"), `${resp.status()} lang=${f.lang} dir=${f.dir} owner=${ownerOf(hdrs)}`);
        for (const l of links) { const b = badHref(l.href); if (b) violations.push({ loc, page: p + pth, href: redact(l.href), why: b, text: l.text }); }
        for (const l of hf) {
          const u = new URL(l.href, BASE); u.hash = "";
          if (!/^https?:$/.test(u.protocol)) continue;
          const key = u.toString();
          if (!targets.has(key)) targets.set(key, { from: [], where: l.where, text: l.text });
          targets.get(key).from.push(p + pth);
        }
        if (pageErrors.length) R.check(`${L} ${p}${pth}: no uncaught page error`, false, pageErrors.join("; "));
        pageErrors.length = 0;
      }
      crawl.pages += 6;
      let n = 0;
      for (const [url, meta] of targets) {
        const u = new URL(url);
        if (u.host !== "www.copilt.org" || u.protocol !== "https:") continue; // reported by the origin audit
        n++;
        const c = await chase(url);
        const ok = c.status === 200 && c.chain.length <= 3 && c.finalHost === "www.copilt.org";
        if (!ok) crawl.dead.push({ loc, url: redact(url).replace(BASE, ""), chain: c.chain, from: meta.from[0] });
        if (c.isHtml && c.status === 200) {
          // landing language must be the page's language unless the link is a language-menu entry
          const target = (/^\/(he|es|ru)(\/|$)/.exec(c.final) || [])[1] || "en";
          if (target === loc) { if (!(LANG_EXPECT[loc].lang.test(c.lang) && (c.dir || "ltr") === LANG_EXPECT[loc].dir)) crawl.langViolations.push({ loc, url: c.final, lang: c.lang, dir: c.dir }); }
        }
      }
      crawl.byLocale[loc] = { uniqueTargets: n, targets: [...targets.keys()].map((k) => redact(k).replace(BASE, "") || "/") };
      crawl.uniqueTargets += n;
      // prefix rule: on a prefixed page every in-site header/footer link (except language-menu items) must stay in the language
      if (loc !== "en") for (const [url, meta] of targets) {
        const u = new URL(url);
        if (u.host !== "www.copilt.org") continue;
        const stays = new RegExp(`^/${loc}(/|$)`).test(u.pathname);
        const isLangItem = ["he", "es", "ru"].some((x) => x !== loc && new RegExp(`^/${x}(/|$)`).test(u.pathname));
        const unprefixedLangItem = !/^\/(he|es|ru)(\/|$)/.test(u.pathname) && /\b(English)\b/.test(meta.text);
        if (!stays && !isLangItem && !unprefixedLangItem && !/\.(xml|txt)$|^\/(robots|sitemap)/.test(u.pathname)) crawl.prefixViolations.push({ loc, url: u.pathname + u.search, text: meta.text, from: meta.from[0] });
      }
      R.check(`${L} crawl: ${n} unique in-site header/footer link targets from 6 pages, every one answers 200 within <=2 redirects on www`, !crawl.dead.some((d) => d.loc === loc), JSON.stringify(crawl.dead.filter((d) => d.loc === loc).slice(0, 5)) || `${n} ok`);

      /* ---- B. real clicks */
      const click = async (sel, expectUrl, label, o = {}) => {
        const navs = [];
        const h = (rq) => { if (rq.isNavigationRequest()) navs.push(new URL(rq.url()).pathname); };
        page.on("request", h);
        try {
          const el = page.locator(sel).first();
          await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 25000 }), el.click()]);
          const f = await facts(page);
          const okUrl = typeof expectUrl === "string" ? page.url() === expectUrl : expectUrl.test(page.url());
          const langOk = !o.lang || (LANG_EXPECT[o.lang].lang.test(f.lang) && f.dir === LANG_EXPECT[o.lang].dir);
          R.check(`${L} click: ${label}`, okUrl && langOk && navs.length <= 2, `-> ${redact(page.url())} lang=${f.lang}/${f.dir} navigation requests=${navs.length}`);
        } catch (e) { R.check(`${L} click: ${label}`, false, String(e.message).slice(0, 200)); }
        page.off("request", h);
      };
      // static home -> CP and back
      await goto(page, `${BASE}${p}/`);
      await click(`header a[href="${BASE}${p}/pricing/"], header a[href="${p}/pricing/"]`, `${BASE}${p}/pricing/`, `static home header Pricing -> ${p}/pricing/ (CP)`, { lang: loc });
      await click(`header a[href="${BASE}${p}/"], header a[href="${p || ""}/"]`, `${BASE}${p}/`, `CP header logo -> ${p}/ (static home)`, { lang: loc });
      await click(`header a[href="${BASE}${p}/my-account/"], header a[href="${p}/my-account/"]`, `${BASE}${p}/my-account/`, `static header Sign in / Account -> ${p}/my-account/`, { lang: loc });
      await goto(page, `${BASE}${p}/`);
      await click(`a[href$="/my-account/?plan=solo"]`, `${BASE}${p}/my-account/?plan=solo`, `static plan button (?plan=solo) -> ${p}/my-account/?plan=solo`, { lang: loc });
      await goto(page, `${BASE}${p}/pricing/`);
      await click(`header a[href="${BASE}${p}/product/"], header a[href="${p}/product/"]`, `${BASE}${p}/product/`, `CP header Product -> ${p}/product/ (static)`, { lang: loc });
      await goto(page, `${BASE}${p}/pricing/`);
      await click(`header a[href="${BASE}${p}/questions/"], header a[href="${p}/questions/"]`, `${BASE}${p}/questions/`, `CP header Questions -> ${p}/questions/ (static)`, { lang: loc });
      await goto(page, `${BASE}${p}/pricing/`);
      await click(`footer a[href="${BASE}${p}/data-and-trust/"]`, `${BASE}${p}/data-and-trust/`, `CP footer Data and trust -> ${p}/data-and-trust/`, { lang: loc });
      for (const slug of ["privacy", "terms", "refund-policy", "accessibility"]) {
        await goto(page, `${BASE}${p}/my-account/`);
        await click(`footer a[href="${BASE}${p}/${slug}/"]`, `${BASE}${p}/${slug}/`, `account page footer -> legal page ${p}/${slug}/`, { lang: loc });
      }
      await goto(page, `${BASE}${p}/pricing/`);
      await click(`a[href$="/#demo"]`, `${BASE}${p}/#demo`, `CP pricing "Watch demo" -> ${p}/#demo on the static home`, { lang: loc });
      R.check(`${L} ... and the #demo section exists there`, (await page.locator("#demo").count()) === 1);

      /* ---- C. language menu round trips, static and CP */
      for (const [kind, pth] of [["static", "/product/"], ["cp", "/pricing/"], ["cp", "/my-account/"]]) {
        const results = [];
        for (const t of LOCALES.filter((x) => x !== loc)) {
          await ctx.clearCookies();
          await goto(page, `${BASE}${p}${pth}`);
          const navs = []; const h = (rq) => { if (rq.isNavigationRequest()) navs.push(new URL(rq.url()).pathname); }; page.on("request", h);
          let ok = false, detail = "";
          try {
            await page.locator(".aicc-lang__btn:visible").first().click();
            await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 25000 }), page.locator(`.aicc-lang__menu:visible a[data-lang="${t}"]`).first().click()]);
            const f = await facts(page);
            ok = page.url() === `${BASE}${pre(t)}${pth}` && LANG_EXPECT[t].lang.test(f.lang) && f.dir === LANG_EXPECT[t].dir && navs.length <= 2;
            detail = `${loc}->${t}: ${redact(page.url()).replace(BASE, "")} lang=${f.lang}/${f.dir} nav=${navs.length}`;
            // and back to where we came from (round trip)
            await page.locator(".aicc-lang__btn:visible").first().click();
            await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 25000 }), page.locator(`.aicc-lang__menu:visible a[data-lang="${loc}"]`).first().click()]);
            const f2 = await facts(page);
            ok = ok && page.url() === `${BASE}${p}${pth}` && LANG_EXPECT[loc].lang.test(f2.lang);
            detail += ` | back: ${redact(page.url()).replace(BASE, "")} lang=${f2.lang}`;
          } catch (e) { detail += " EXC " + String(e.message).slice(0, 120); }
          page.off("request", h);
          results.push({ ok, detail });
        }
        R.check(`${L} language menu on ${kind} ${p}${pth}: to each other language and back lands on the same page, right lang/dir, no redirect loop`, results.every((r) => r.ok), results.map((r) => r.detail).join(" || "));
      }
      // cookie vs prefix: the prefix wins; the cookie only decides the unprefixed CP URL
      await ctx.clearCookies();
      await ctx.addCookies([{ name: "aicc_lang", value: loc === "en" ? "he" : "en", domain: "www.copilt.org", path: "/", secure: true, sameSite: "Lax" }]);
      await goto(page, `${BASE}${p}/pricing/`);
      const fp = await facts(page);
      if (loc === "en") R.info(`${L} with aicc_lang=he and the UNPREFIXED English CP URL /pricing/ the CP renders Hebrew (documented order URL prefix -> cookie -> default; English has no prefix, so the cookie decides; crawlers have no cookie)`, `page lang=${fp.lang} dir=${fp.dir}`);
      else R.check(`${L} with a conflicting aicc_lang cookie (en) the URL prefix still wins on ${p}/pricing/ (no silent switch)`, LANG_EXPECT[loc].lang.test(fp.lang), `cookie=en page lang=${fp.lang}`);
      await goto(page, `${BASE}${p}/product/`);
      const fs2 = await facts(page);
      R.check(`${L} with a conflicting aicc_lang cookie the static ${p}/product/ never redirects or switches`, page.url() === `${BASE}${p}/product/` && LANG_EXPECT[loc].lang.test(fs2.lang), `lang=${fs2.lang}`);
      await ctx.clearCookies();

      /* ---- D. RTL / LTR spot checks (desktop) */
      for (const pth of ["/", "/pricing/"]) {
        await goto(page, `${BASE}${p}${pth}`);
        const g = await page.evaluate(() => {
          const logo = document.querySelector("header a[href$='/']:not([data-lang])") || document.querySelector("header a");
          const navLinks = [...document.querySelectorAll("header nav a, header a")].filter((a) => a.offsetParent && a.getBoundingClientRect().width > 0).map((a) => a.getBoundingClientRect());
          const lr = logo ? logo.getBoundingClientRect() : null;
          return { logoX: lr ? Math.round(lr.left + lr.width / 2) : null, vw: innerWidth, bodyDir: getComputedStyle(document.body).direction, align: getComputedStyle(document.querySelector("h1") || document.body).textAlign, firstNavX: navLinks.length > 1 ? Math.round(navLinks[1].left) : null, lastNavX: navLinks.length > 1 ? Math.round(navLinks[navLinks.length - 1].left) : null, scrollW: document.documentElement.scrollWidth };
        });
        const rtl = loc === "he";
        R.check(`${L} ${p}${pth}: ${rtl ? "RTL mirrored (logo on the right half, body direction rtl)" : "LTR (logo on the left half, body direction ltr)"}; no horizontal overflow at 1280`, (rtl ? g.logoX > g.vw / 2 && g.bodyDir === "rtl" : g.logoX < g.vw / 2 && g.bodyDir === "ltr") && g.scrollW <= g.vw, JSON.stringify(g));
      }
      if (loc === "he") await shot(page, "04-he-cp-pricing-rtl");
      if (loc === "he") { await goto(page, `${BASE}/he/`); await shot(page, "04-he-static-home-rtl"); }
    } catch (e) { R.check(`${L} locale flow completed`, false, String(e.stack || e).slice(0, 500)); }
    await ctx.close().catch(() => {});
  }

  /* ---- E. direct entry, www and apex, every locale */
  const ctxE = await newCtx("desktop");
  const pageE = await ctxE.newPage();
  const direct = [];
  for (const loc of LOCALES) for (const pth of ["/", "/product/", "/pricing/", "/my-account/", "/cart/", "/data-and-trust/", "/questions/"]) {
    const p = pre(loc);
    const chainW = [], chainA = [];
    const h = (res) => { const u = new URL(res.url()); if (u.host.endsWith("copilt.org") && res.request().isNavigationRequest()) (chainA).push({ host: u.host, status: res.status() }); };
    pageE.on("response", h);
    chainA.length = 0;
    const rW = await goto(pageE, `${BASE}${p}${pth}`); const fW = await facts(pageE);
    chainW.push(...chainA); chainA.length = 0;
    await goto(pageE, `${APEX}${p}${pth}`); const fA = await facts(pageE);
    pageE.off("response", h);
    const wwwOk = rW.status() === 200 && pageE && fW.url === `${BASE}${p}${pth}` && LANG_EXPECT[loc].lang.test(fW.lang) && fW.dir === LANG_EXPECT[loc].dir;
    const apexOk = chainA.length === 2 && chainA[0].host === "copilt.org" && [301, 308].includes(chainA[0].status) && chainA[1].host === "www.copilt.org" && chainA[1].status === 200 && fA.url === `${BASE}${p}${pth}` && LANG_EXPECT[loc].lang.test(fA.lang);
    direct.push({ loc, path: pth, wwwOk, apexOk, www: `${rW.status()} ${fW.lang}/${fW.dir}`, apex: chainA.map((c) => `${c.host}:${c.status}`).join(">") });
  }
  await ctxE.close().catch(() => {});
  R.check(`direct entry to ${direct.length} language-prefixed URLs on www: all 200, right html lang/dir, URL unchanged (no prefix loop or silent fallback)`, direct.every((d) => d.wwwOk), JSON.stringify(direct.filter((d) => !d.wwwOk)));
  R.check(`the same ${direct.length} URLs under the apex copilt.org: exactly one 301/308 hop to the same prefixed path on www, then 200 in the right language`, direct.every((d) => d.apexOk), JSON.stringify(direct.filter((d) => !d.apexOk)));
  R.data.directEntry = direct;

  /* ---- F. link audit over everything visited */
  R.check(`link audit over ${pageFacts.reduce((a, x) => a + x.links, 0)} anchors on ${pageFacts.length} crawled pages (4 locales, static+CP): no link to a non-www origin, the QA/local host, http://, javascript:, or the old GitHub Pages path`, violations.length === 0, JSON.stringify(violations.slice(0, 8)));
  R.check("browser network audit: no request left www.copilt.org (no third-party host contacted by any visited page)", extHosts.size === 0, JSON.stringify([...extHosts]));
  R.check(`crawl: ${crawl.uniqueTargets} unique header/footer targets in total, none dead`, crawl.dead.length === 0, JSON.stringify(crawl.dead.slice(0, 6)));
  R.check("crawl: landing pages of in-language links are in that language (html lang/dir)", crawl.langViolations.length === 0, JSON.stringify(crawl.langViolations.slice(0, 6)));
  R.check("crawl: on every prefixed page, header/footer links stay inside the language (no link silently drops to English), except the language menu itself", crawl.prefixViolations.length === 0, JSON.stringify(crawl.prefixViolations.slice(0, 10)));
  R.data.crawl = crawl; R.data.pages = pageFacts; R.data.linkViolations = violations;
  R.save();
  return R;
}

/* ================================================================== network meter (CDP), used by sections 5 and 8 */
const lc = (h, k) => { for (const [n, v] of Object.entries(h || {})) if (n.toLowerCase() === k) return v; return ""; };
async function netMeter(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  const m = new Map();
  const T0 = Date.now();
  cdp.on("Network.requestWillBeSent", (e) => { if (!m.has(e.requestId) || e.redirectResponse) m.set(e.requestId + (e.redirectResponse ? "#r" + m.size : ""), m.get(e.requestId)); m.set(e.requestId, { url: e.request.url, method: e.request.method, range: lc(e.request.headers, "range"), t: Date.now() - T0, type: e.type, status: 0, data: 0, enc: 0, mime: "", contentEncoding: "", contentRange: "", contentLength: "", done: false, failed: "", cache: "" }); });
  cdp.on("Network.responseReceived", (e) => { const r = m.get(e.requestId); if (!r) return; r.status = e.response.status; r.mime = e.response.mimeType; r.contentEncoding = lc(e.response.headers, "content-encoding"); r.contentRange = lc(e.response.headers, "content-range"); r.contentLength = lc(e.response.headers, "content-length"); r.cache = e.response.fromDiskCache ? "disk" : e.response.fromPrefetchCache ? "prefetch" : ""; });
  cdp.on("Network.dataReceived", (e) => { const r = m.get(e.requestId); if (r) { r.data += e.dataLength; r.enc += e.encodedDataLength; } });
  cdp.on("Network.loadingFinished", (e) => { const r = m.get(e.requestId); if (r) { r.enc = e.encodedDataLength || r.enc; r.done = true; } });
  cdp.on("Network.loadingFailed", (e) => { const r = m.get(e.requestId); if (r) r.failed = e.canceled ? "canceled" : e.errorText; });
  return {
    cdp, now: () => Date.now() - T0,
    all: () => [...m.values()].filter(Boolean),
    where: (re, sinceMs = 0) => [...m.values()].filter((r) => r && re.test(r.url) && r.t >= sinceMs),
    bytes: (re, sinceMs = 0) => [...m.values()].filter((r) => r && re.test(r.url) && r.t >= sinceMs).reduce((a, r) => a + r.enc, 0),
    reset: () => m.clear(),
  };
}

/* ================================================================== 5. WATCH DEMO */
const DEMO_RE = /\/demo\//, MP4_RE = /\/demo\/aicc-demo\.mp4/;
async function demoTap(page, locator, touch) { if (touch) await locator.tap(); else await locator.click(); }

async function runDemo(R, ctx, { url, label, touch = false, full = false, locale = "en", shotName = "" }) {
  const page = await ctx.newPage();
  const meter = await netMeter(page);
  const errs = []; page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  const out = { label };
  try {
    await goto(page, url);
    await page.waitForTimeout(1800);
    const before = meter.where(DEMO_RE);
    R.check(`${label}: no /demo/ request at all before the dialog is opened (no video, poster or captions fetched with the page)`, before.length === 0, JSON.stringify(before.map((r) => [r.url.replace(BASE, ""), r.status])));
    const ov0 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const trig = page.locator("[data-aicc-demo-trigger]:visible").first();
    R.check(`${label}: a visible Watch demo trigger exists`, (await trig.count()) === 1, "");
    const tOpen = meter.now();
    await demoTap(page, trig, touch);
    await page.waitForSelector("dialog[open] video", { timeout: 10000 });
    await page.waitForFunction(() => { const v = document.querySelector("dialog[open] video"); return v && v.readyState >= 1; }, null, { timeout: 25000 });
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => {
      const d = document.querySelector("dialog[open]"), v = d.querySelector("video"), tr = v.querySelector("track");
      const cue = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).flatMap((r) => (r instanceof CSSGroupingRule && !(r instanceof CSSStyleRule) ? [...r.cssRules] : [r])).filter((r) => /::cue/.test(r.selectorText || "")).map((r) => r.cssText.slice(0, 120));
      const rect = d.getBoundingClientRect();
      return { title: d.querySelector("h2")?.textContent || "", closeLabel: d.querySelector(".aicc-modal__close")?.getAttribute("aria-label") || "", dialogLang: d.closest("[lang]")?.getAttribute("lang") || "", dialogDir: getComputedStyle(d).direction, paused: v.paused, autoplay: v.autoplay || v.hasAttribute("autoplay"), controls: v.controls, preload: v.preload, playsinline: v.hasAttribute("playsinline"), poster: v.getAttribute("poster"), muted: v.muted, volume: v.volume, played: v.played.length, currentTime: v.currentTime, duration: v.duration, audioBytes: v.webkitAudioDecodedByteCount, tracks: [...v.textTracks].map((t) => ({ kind: t.kind, lang: t.language, label: t.label, mode: t.mode, cues: t.cues ? t.cues.length : -1 })), trackDefault: tr?.hasAttribute("default"), trackSrc: tr?.getAttribute("src"), cueRules: cue, rect: { l: Math.round(rect.left), r: Math.round(rect.right), t: Math.round(rect.top), b: Math.round(rect.bottom) }, vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth - innerWidth, dialogCount: document.querySelectorAll("dialog").length, openCount: document.querySelectorAll("dialog[open]").length, videos: document.querySelectorAll("dialog video").length };
    });
    out.state = st;
    const mp4 = meter.where(MP4_RE, tOpen - 5);
    const first = mp4[0];
    const openBytes = meter.bytes(DEMO_RE, tOpen - 5);
    R.check(`${label}: dialog opened, native <video controls playsinline preload=metadata>, paused at 0, NOT autoplay, duration ${Math.round(st.duration)} s`, st.paused && !st.autoplay && st.controls && st.preload === "metadata" && st.playsinline && st.currentTime === 0 && st.duration > 60, JSON.stringify({ paused: st.paused, autoplay: st.autoplay, controls: st.controls, preload: st.preload, ct: st.currentTime }));
    R.check(`${label}: no sound before a user action (never played: played.length=0, decoded audio bytes=${st.audioBytes})`, st.played === 0 && (st.audioBytes || 0) === 0, `played=${st.played} audioDecoded=${st.audioBytes} muted=${st.muted} volume=${st.volume}`);
    const posterReq = meter.where(/aicc-demo-poster\.jpg/, tOpen - 5)[0];
    R.check(`${label}: the poster is requested after opening and answered 200 image/jpeg (poster shown before play)`, !!posterReq && posterReq.status === 200 && /jpeg/.test(posterReq.mime) && /aicc-demo-poster\.jpg/.test(st.poster || ""), JSON.stringify(posterReq && [posterReq.status, posterReq.mime, posterReq.enc]));
    R.check(`${label}: the FIRST /demo/aicc-demo.mp4 request happens only after opening, is a GET with a Range header, and is answered 206 with Content-Range`, !!first && first.t >= tOpen - 5 && first.method === "GET" && /^bytes=\d+-/.test(first.range) && first.status === 206 && /^bytes /.test(first.contentRange), JSON.stringify(first && { afterOpenMs: first.t - tOpen, method: first.method, range: first.range, status: first.status, contentRange: first.contentRange, encodedBytes: first.enc }));
    R.check(`${label}: every video request before play is ranged (206) and the bytes pulled before play are small (${(openBytes / 1024).toFixed(0)} KiB of 42.3 MiB; limit 12 MiB)`, mp4.length >= 1 && mp4.every((r) => /^bytes=\d+-/.test(r.range) && r.status === 206) && openBytes < 12 * 1024 * 1024, JSON.stringify({ requests: mp4.map((r) => [r.range, r.status, r.enc]), totalBytes: openBytes }));
    out.network = { firstMp4: first && { afterOpenMs: first.t - tOpen, range: first.range, status: first.status, contentRange: first.contentRange }, bytesBeforePlay: openBytes, mp4Requests: mp4.map((r) => ({ range: r.range, status: r.status, bytes: r.enc, failed: r.failed })) };
    const tracks = st.tracks;
    R.check(`${label}: captions present: one captions track (language en = the audio language), VTT loaded (${tracks.map((t) => `${t.kind}/${t.lang}/${t.mode}/${t.cues} cues`).join(", ")}), default`, tracks.length === 1 && tracks[0].kind === "captions" && tracks[0].lang === "en" && tracks[0].cues > 3 && st.trackDefault, JSON.stringify(tracks));
    R.check(`${label}: the ::cue style from the brand CSS is loaded (${st.cueRules.length} rule(s))`, st.cueRules.length >= 1 && /rgb|#fff/.test(st.cueRules.join(" ")), st.cueRules.join(" | "));
    R.check(`${label}: dialog localized: title "${st.title}", close button aria-label "${st.closeLabel}"; dialog direction ${st.dialogDir}`, st.title.length > 1 && st.closeLabel.length > 0 && st.dialogDir === LANG_EXPECT[locale].dir && (locale === "en" ? st.closeLabel === "Close" : st.closeLabel !== "Close"), JSON.stringify({ title: st.title, close: st.closeLabel, dir: st.dialogDir }));
    R.check(`${label}: no horizontal overflow (page ${st.over <= 0 ? "ok" : st.over + "px over"}), dialog inside the viewport (${st.rect.l}..${st.rect.r} of ${st.vw}), one dialog/video in the DOM`, ov0 <= 0 && st.over <= 0 && st.rect.l >= 0 && st.rect.r <= st.vw && st.openCount === 1 && st.videos === 1, JSON.stringify({ ov0, over: st.over, rect: st.rect, vw: st.vw, dialogs: st.dialogCount, videos: st.videos }));
    if (shotName) await shot(page, shotName);

    if (full) {
      // focus trap
      const outside = [];
      const probeFocus = async () => { const r = await page.evaluate(() => { const d = document.querySelector("dialog[open]"); const a = document.activeElement; return { inside: !!d && d.contains(a), tag: a ? a.tagName.toLowerCase() + (a.id ? "#" + a.id : "") : "none", inert: !!a && !!a.closest("[inert]") }; }); if (!r.inside) outside.push(r.tag); };
      for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); await probeFocus(); }
      for (let i = 0; i < 8; i++) { await page.keyboard.press("Shift+Tab"); await probeFocus(); }
      // a modal <dialog> makes the rest of the page inert: focus may pass to the browser UI (document.body / none) but must never land on page content
      R.check(`${label}: focus trap: 14 x Tab and 8 x Shift+Tab never put focus on page content outside the dialog (browser-UI hand-off to body is allowed: ${outside.length})`, outside.every((t) => t === "body" || t === "none" || t === "html"), `outside focus targets: ${JSON.stringify(outside)}`);
      // play / pause (the user gesture), seek
      const box = await page.locator("dialog[open] video").boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      // desktop: click on the picture toggles; touch: Chrome's mobile controls toggle with the play button at the bottom-left of the control bar
      const toggle = async () => { if (touch) await page.touchscreen.tap(box.x + 25, box.y + box.height - 49); else await page.mouse.click(cx, cy); };
      await toggle();
      await page.waitForFunction(() => { const v = document.querySelector("dialog[open] video"); return v && !v.paused && v.currentTime > 0.8; }, null, { timeout: 20000 }).catch(() => {});
      const playing = await page.evaluate(() => { const v = document.querySelector("dialog[open] video"); return { paused: v.paused, t: v.currentTime, audio: v.webkitAudioDecodedByteCount, muted: v.muted }; });
      R.check(`${label}: play works after a user gesture (currentTime ${playing.t.toFixed(1)} s), audio decoded only now (${playing.audio} bytes)`, !playing.paused && playing.t > 0.8, JSON.stringify(playing));
      // captions visible
      await page.waitForTimeout(600);
      if (shotName) await shot(page, shotName + "-playing");
      await toggle();
      await page.waitForTimeout(700);
      let paused2 = await page.evaluate(() => document.querySelector("dialog[open] video").paused);
      if (!paused2 && touch) { await page.touchscreen.tap(cx, cy); await page.waitForTimeout(400); await toggle(); await page.waitForTimeout(700); paused2 = await page.evaluate(() => document.querySelector("dialog[open] video").paused); }
      R.check(`${label}: ${touch ? "tapping the play/pause button" : "a second click"} pauses`, paused2, "");
      await page.evaluate(() => { document.querySelector("dialog[open] video").currentTime = 70; });
      await page.waitForFunction(() => { const v = document.querySelector("dialog[open] video"); return Math.abs(v.currentTime - 70) < 2 && !v.seeking; }, null, { timeout: 25000 }).catch(() => {});
      await page.evaluate(() => { document.querySelector("dialog[open] video").currentTime = 20; });
      await page.waitForFunction(() => { const v = document.querySelector("dialog[open] video"); return Math.abs(v.currentTime - 20) < 2 && !v.seeking; }, null, { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(500);
      const all = meter.where(MP4_RE, tOpen - 5);
      R.check(`${label}: seeking forward (70 s) and back (20 s) works; ${all.length} video requests in total, all ranged and 206 through the edge`, all.length >= 2 && all.every((r) => /^bytes=\d+-/.test(r.range) && r.status === 206), JSON.stringify(all.map((r) => [r.range, r.status, r.enc, r.failed])));
      out.network.afterSeek = { requests: all.length, totalBytes: meter.bytes(DEMO_RE, tOpen - 5), ranges: all.map((r) => r.range) };
    }
    // Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const afterEsc = await page.evaluate(() => { const v = document.querySelector("dialog video"); const a = document.activeElement; return { open: document.querySelectorAll("dialog[open]").length, focusOnTrigger: !!a && a.hasAttribute("data-aicc-demo-trigger"), paused: v ? v.paused : null, ct: v ? v.currentTime : null }; });
    R.check(`${label}: Escape closes the dialog, focus returns to the Watch demo trigger, video paused and reset to 0`, afterEsc.open === 0 && afterEsc.focusOnTrigger && afterEsc.paused && afterEsc.ct === 0, JSON.stringify(afterEsc));
    // reopen cleanly
    await demoTap(page, page.locator("[data-aicc-demo-trigger]:visible").first(), touch);
    await page.waitForSelector("dialog[open] video");
    await page.waitForTimeout(500);
    const re = await page.evaluate(() => { const v = document.querySelector("dialog[open] video"); return { dialogs: document.querySelectorAll("dialog").length, open: document.querySelectorAll("dialog[open]").length, videos: document.querySelectorAll("dialog video").length, paused: v.paused, ct: v.currentTime, over: document.documentElement.scrollWidth - innerWidth }; });
    R.check(`${label}: reopen is clean (one dialog, one video, paused at 0, no overflow)`, re.open === 1 && re.videos === 1 && re.paused && re.ct === 0 && re.over <= 0 && re.dialogs === st.dialogCount, JSON.stringify(re));
    // close button
    await demoTap(page, page.locator("dialog[open] .aicc-modal__close"), touch);
    await page.waitForTimeout(400);
    const afterBtn = await page.evaluate(() => ({ open: document.querySelectorAll("dialog[open]").length, focusOnTrigger: document.activeElement?.hasAttribute("data-aicc-demo-trigger") }));
    R.check(`${label}: the close button closes it and returns focus to the trigger`, afterBtn.open === 0 && afterBtn.focusOnTrigger, JSON.stringify(afterBtn));
    if (full) {
      await demoTap(page, page.locator("[data-aicc-demo-trigger]:visible").first(), touch);
      await page.waitForSelector("dialog[open] video");
      if (touch) await page.touchscreen.tap(3, 3); else await page.mouse.click(3, 3);
      await page.waitForTimeout(400);
      R.check(`${label}: a tap/click on the backdrop closes it`, (await page.locator("dialog[open]").count()) === 0, "");
    }
    R.check(`${label}: no uncaught page error`, errs.length === 0, errs.join("; "));
  } catch (e) { R.check(`${label}: demo flow completed`, false, String(e.stack || e).slice(0, 500)); }
  await page.close().catch(() => {});
  return out;
}

async function s5() {
  const R = new Result("05-watch-demo", "Phase 2 / 5: Watch demo through the real edge in Chrome (desktop, mobile touch, reduced motion, product page, he/es/ru)");
  const summary = {};
  // approved master: never touched; the served bytes are compared elsewhere (08-demo). Here only the browser behaviour.
  let ctx = await newCtx("desktop"); summary.desktop = await runDemo(R, ctx, { url: `${BASE}/`, label: "[desktop 1280x800 /]", full: true, shotName: "05-demo-desktop-open" }); await ctx.close();
  ctx = await newCtx("mobile"); summary.mobile = await runDemo(R, ctx, { url: `${BASE}/`, label: "[mobile 390x844 touch /]", touch: true, full: true, shotName: "05-demo-mobile-open" }); await ctx.close();
  ctx = await newCtx("reduced"); summary.reduced = await runDemo(R, ctx, { url: `${BASE}/`, label: "[desktop reduced-motion /]", full: true }); 
  const rm = await (async () => { const pg = await ctx.newPage(); await goto(pg, `${BASE}/`); const v = await pg.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches); await pg.close(); return v; })();
  R.check("reduced-motion profile really reports prefers-reduced-motion: reduce", rm);
  await ctx.close();
  ctx = await newCtx("desktop"); summary.product = await runDemo(R, ctx, { url: `${BASE}/product/`, label: "[desktop /product/]", full: false, shotName: "05-demo-product-open" }); await ctx.close();
  ctx = await newCtx("mobile"); summary.productMobile = await runDemo(R, ctx, { url: `${BASE}/product/`, label: "[mobile /product/]", touch: true, full: false }); await ctx.close();
  for (const loc of ["he", "es", "ru"]) {
    ctx = await newCtx("desktop", { locale: { he: "he-IL", es: "es-ES", ru: "ru-RU" }[loc] });
    summary[loc] = await runDemo(R, ctx, { url: `${BASE}/${loc}/`, label: `[${loc} /${loc}/ desktop]`, full: false, locale: loc, shotName: `05-demo-${loc}-open` });
    await ctx.close();
    ctx = await newCtx("mobile", { locale: { he: "he-IL", es: "es-ES", ru: "ru-RU" }[loc] });
    summary[loc + "Mobile"] = await runDemo(R, ctx, { url: `${BASE}/${loc}/product/`, label: `[${loc} /${loc}/product/ mobile]`, touch: true, full: false, locale: loc });
    await ctx.close();
  }
  R.info("audio/captions language in he/es/ru", "The demo is English-only (English audio and English captions) on every locale, as designed: the dialog chrome (title, close) is localized, the captions track is lang=en. Asserted above per locale.");

  // what a visitor can actually reach from the CP
  const probe = async (u) => { const r = await req(EDGE, u, { timeout: 40 }); return { status: r.status, trigger: (r.body.match(/data-aicc-demo-trigger/g) || []).length, demoLink: (r.body.match(/href="[^"]*#demo"/g) || []).length }; };
  const cpPages = {};
  for (const u of ["/pricing/", "/my-account/", "/cart/", "/he/pricing/"]) cpPages[u] = await probe(`${BASE}${u}`);
  const direct = sh("bash", ["-c", `curl -s -H 'Host: www.copilt.org' -H 'X-Forwarded-Proto: https' http://127.0.0.1:18982/ | grep -o 'data-aicc-demo-trigger' | wc -l`]).stdout.trim();
  R.data.cpReach = { cpPagesThroughEdge: cpPages, cpFrontPageDirectToUpstream_triggers: Number(direct) };
  R.check("CP pages served by the edge (/pricing/, /my-account/, /cart/, /he/pricing/) contain NO Watch-demo dialog trigger; they link to the static home's #demo instead", Object.values(cpPages).every((c) => c.status === 200 && c.trigger === 0), JSON.stringify(cpPages));
  R.info("what a visitor can actually reach", `The CP front page (which has its own Watch-demo button and /demo/* probe) is NOT served by the edge: / belongs to the static site. Through the edge the only working dialog is on the static pages (/, /product/ and their he/es/ru versions); CP pages reach it through a link to <prefix>/#demo, verified by click in section 4. Direct-to-upstream (bypassing the edge, comparison only) the CP front page has ${direct} trigger(s); its behaviour with and without /demo/* was proven in phase 1 (08-demo, variants cp-home and block-demo).`);
  R.data.summary = summary;
  R.save();
  return R;
}

/* ================================================================== 6. CHECKOUT INFRASTRUCTURE (no payment) */
const CP_WT = "/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/cp2a-14-readiness-independence";
const ordersCount = () => wpOut("eval", 'echo count(wc_get_orders(["limit"=>-1,"status"=>["pending","processing","on-hold","completed","failed","cancelled","refunded"]]));');
const draftOrders = () => wpOut("eval", 'echo count(wc_get_orders(["limit"=>-1,"status"=>["checkout-draft"]]));');
const MAP_PRELOAD = path.join(P.run, "map-www.mjs"); // maps www.copilt.org to 127.0.0.1 for a Node child process (the node equivalent of the browser's host-resolver rule)
const writeMapPreload = () => fs.writeFileSync(MAP_PRELOAD, `import dns from "node:dns";\nconst real = dns.lookup;\ndns.lookup = function (h, o, cb) { if (typeof o === "function") { cb = o; o = {}; } if (/^(www\\.)?copilt\\.org$/.test(h)) return o && o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4); return real.call(dns, h, o, cb); };\n`);

async function checkoutFlow(R, loc, user, meterSink, mode = "prod-host") {
  const p = pre(loc), L = `[${loc}]`;
  const ctx = await newCtx("desktop", { locale: loc === "he" ? "he-IL" : "en-US" });
  const page = await ctx.newPage();
  const meter = await netMeter(page);
  const urls = [];
  page.on("request", (rq) => { const u = rq.url(); if (/wc-ajax|wp-json\/wc|checkout/.test(u) && !/\.(js|css)/.test(u)) urls.push(`${rq.method()} ${redact(u).replace(BASE, "")}`); });
  try {
    await login(page, user, p);
    await goto(page, `${BASE}${p}/pricing/`);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator('a[href*="add-to-cart=10"]').first().click()]);
    await page.waitForSelector(".wc-block-checkout", { timeout: 25000 });
    await page.waitForSelector(".wc-block-components-radio-control, .wc-block-checkout__no-payment-methods-notice", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const f = await facts(page);
    R.check(`${L} checkout page renders at ${p}/checkout/ through the edge (block checkout, plan Solo $99, signed in)`, page.url() === `${BASE}${p}/checkout/` && (await page.locator(".wc-block-checkout").count()) >= 1 && /99/.test(await text(page, "main")), `${redact(page.url())} lang=${f.lang} dir=${f.dir} robots="${f.robots}"`);
    const cc = await (await page.goto(`${BASE}${p}/checkout/`, { waitUntil: "load" })).allHeaders();
    R.check(`${L} checkout answered Cache-Control private, no-store`, /no-store/.test(cc["cache-control"] || ""), cc["cache-control"] || "");
    await page.waitForSelector(".wc-block-components-radio-control, .wc-block-checkout__no-payment-methods-notice", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const body = await text(page, "body");
    const hasMarker = /QA only: not a real payment/i.test(body);
    if (mode === "qa") {
      R.check(`${L} [QA host simulation] the block checkout shows "QA only: not a real payment" on the placeholder method (title and description)`, hasMarker && /Direct bank transfer|העברה בנקאית/i.test(body), body.match(/QA only:[^\n]{0,80}/i)?.[0] || "marker not found");
      await shot(page, `06-${loc}-checkout-qa-marker`, { full: true });
      await ctx.close().catch(() => {});
      return;
    }
    R.check(`${L} on the rehearsal host (home = https://www.copilt.org = the production host) the placeholder is offered WITHOUT the QA marker (the marker is keyed to non-production hosts), so the launch gate is the only guard`, !hasMarker && /Direct bank transfer|העברה בנקאית/i.test(body), `marker present=${hasMarker}; "Direct bank transfer" shown=${/Direct bank transfer|העברה בנקאית/i.test(body)}`);
    const gw = await page.evaluate(() => [...document.querySelectorAll('input[name="radio-control-wc-payment-method-options"]')].map((i) => i.value));
    R.info(`${L} payment method inputs on the checkout`, JSON.stringify(gw));
    // consent checkboxes: 24px targets
    const boxes = await page.evaluate(() => [...document.querySelectorAll(".wc-block-checkout input[type=checkbox]")].filter((i) => i.offsetParent || true).map((i) => { const r = i.getBoundingClientRect(); const lab = i.closest("label"); const lr = lab ? lab.getBoundingClientRect() : null; return { id: i.id || i.name || "", w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, labelH: lr ? Math.round(lr.height) : null, visible: r.width > 0 && r.height > 0, text: (lab?.textContent || "").trim().slice(0, 50) }; }));
    const vis = boxes.filter((b) => b.visible);
    R.check(`${L} every visible consent/terms checkbox is a >=24x24 px target (${vis.length} checkbox(es): ${vis.map((b) => `${b.w}x${b.h}`).join(", ")})`, vis.length >= 1 && vis.every((b) => b.w >= 24 && b.h >= 24), JSON.stringify(vis));
    R.data[`consent_${loc}`] = vis;
    await shot(page, `06-${loc}-checkout`, { full: true });
    // AJAX through the edge, prefixed and unprefixed
    const ajaxNonce = await page.evaluate(() => (typeof wc_checkout_params !== "undefined" ? wc_checkout_params.update_order_review_nonce : ""));
    const ajaxUrl = await page.evaluate(() => (typeof wc_checkout_params !== "undefined" ? wc_checkout_params.wc_ajax_url : ""));
    R.info(`${L} wc_checkout_params.wc_ajax_url handed to the page's script`, ajaxUrl);
    const frag = await fetchIn(page, `${p}/?wc-ajax=get_refreshed_fragments`, { method: "POST" });
    R.check(`${L} POST ${p}/?wc-ajax=get_refreshed_fragments: 200 JSON, no redirect, no-store`, frag.status === 200 && /json/.test(frag.type) && /no-store/.test(frag.cc), JSON.stringify({ s: frag.status, t: frag.type, cc: frag.cc, b: frag.body.slice(0, 40) }));
    const fragBare = await fetchIn(page, `/?wc-ajax=get_refreshed_fragments`, { method: "POST" });
    R.check(`${L} POST /?wc-ajax=get_refreshed_fragments (unprefixed) also 200 in this language session`, fragBare.status === 200 && /json/.test(fragBare.type), JSON.stringify({ s: fragBare.status, t: fragBare.type }));
    const ur = (url, sec) => fetchIn(page, url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: new URLSearchParams({ security: sec, payment_method: "", country: "US", state: "", postcode: "", city: "", address: "", address_2: "", s_country: "US", has_full_address: "false", post_data: "" }).toString() });
    const uBad = await ur(`${p}/?wc-ajax=update_order_review`, "0000000000"), uOk = await ur(`${p}/?wc-ajax=update_order_review`, ajaxNonce);
    R.check(`${L} POST ${p}/?wc-ajax=update_order_review: valid nonce 200, tampered nonce rejected, both no-store`, uOk.status === 200 && (uBad.status === 403 || /^-1/.test(uBad.body)) && /no-store/.test(uOk.cc) && /no-store/.test(uBad.cc), JSON.stringify({ ok: [uOk.status, uOk.cc], bad: [uBad.status, uBad.body.slice(0, 10), uBad.cc] }));
    const sapi = await page.evaluate(async () => { const r = await fetch("/wp-json/wc/store/v1/cart", { credentials: "same-origin" }); return { status: r.status, cc: r.headers.get("cache-control") || "" }; });
    R.check(`${L} Store API GET /wp-json/wc/store/v1/cart: 200, no-store`, sapi.status === 200 && /no-store/.test(sapi.cc), JSON.stringify(sapi));
    meterSink[loc] = { requests: urls, wcRequests: meter.all().filter((r) => /wc-ajax|wp-json\/wc/.test(r.url)).map((r) => ({ m: r.method, u: redact(r.url).replace(BASE, ""), s: r.status })) };
    const submits = meter.all().filter((r) => r.method !== "GET" && (/wc-ajax=checkout\b/.test(r.url) || (/wc\/store\/v1\/checkout/.test(r.url) && !/__experimental_calc_totals/.test(r.url))));
    R.check(`${L} NOTHING was submitted: no ?wc-ajax=checkout request and no order-placing POST to /wc/store/v1/checkout (only the page's own totals call, if any)`, submits.length === 0, JSON.stringify(submits.map((r) => r.url)));
    R.info(`${L} checkout-related requests the page itself made (method path)`, JSON.stringify(urls.filter((u) => /store\/v1\/checkout|wc-ajax=checkout|checkout\/\?/.test(u)).slice(0, 8)));
  } catch (e) { R.check(`${L} checkout flow completed`, false, String(e.stack || e).slice(0, 600)); }
  await ctx.close().catch(() => {});
}

async function s6() {
  const R = new Result("06-checkout-infra", "Phase 2 / 6: checkout infrastructure through the edge, no payment (EN, HE) and the public launch gate");
  const ordersBefore = ordersCount(), draftsBefore = draftOrders();
  const prior = sh("bash", [P.cpFixture, "wp", "option", "get", "woocommerce_bacs_settings", "--format=json"]);
  const hadBacs = prior.code === 0 && prior.stdout.trim().startsWith("{");
  const priorJson = hadBacs ? prior.stdout.trim() : "";
  wp("option", "update", "woocommerce_bacs_settings", JSON.stringify({ enabled: "yes", title: "Direct bank transfer", description: "Placeholder for QA.", instructions: "", account_details: "" }), "--format=json");
  const user = createUser("co");
  const sink = {};
  try {
    for (const loc of ["en", "he"]) await checkoutFlow(R, loc, user, sink);
    R.data.checkoutNetwork = sink;
    // QA-host simulation: a fixture-only mu-plugin makes ONLY AICC_LM_Commerce_UX::is_production_host() see a non-production home host (no other URL changes), then it is removed
    const mu = path.join(P.cpBase, "wp/wp-content/mu-plugins/rehearsal-qa-marker-demo.php");
    fs.mkdirSync(path.dirname(mu), { recursive: true });
    fs.writeFileSync(mu, `<?php\n// rehearsal-only (outside every repo): pretend ONLY is_production_host() runs on a QA host\nadd_filter( 'option_home', function ( $v ) { foreach ( debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 8 ) as $f ) { if ( ( $f['function'] ?? '' ) === 'is_production_host' ) { return 'https://qa.invalid'; } } return $v; } );\n`);
    try { for (const loc of ["en", "he"]) await checkoutFlow(R, loc, user, {}, "qa"); } finally { fs.rmSync(mu, { force: true }); }
    R.check("QA-host simulation removed again (mu-plugin deleted; the rehearsal host is the production host once more)", !fs.existsSync(mu));
    const ordersAfter = ordersCount(), draftsAfter = draftOrders();
    R.check("no real order exists after the run (pending/processing/on-hold/completed/failed/cancelled/refunded count unchanged)", ordersBefore === ordersAfter && ordersAfter === "0", `before=${ordersBefore} after=${ordersAfter}; WooCommerce checkout-draft orders (the block checkout's own draft, not an order) ${draftsBefore} -> ${draftsAfter}`);

    // the public launch gates must FAIL while the placeholder is offered
    writeMapPreload();
    const env = { ...process.env, AICC_PRODUCTION: "1", NODE_EXTRA_CA_CERTS: P.rootCrt };
    for (const url of [`${BASE}/checkout/`, `${BASE}/he/checkout/`]) {
      const r = sh("node", ["--import", `file://${MAP_PRELOAD}`, path.join(REPO, "scripts/launch-check.mjs"), "--strict", `--checkout-url=${url}`], { env, cwd: REPO });
      const line = (r.out.match(/checkout markup[^\n]*/) || [""])[0];
      const reach = /checkout page \S+ is publicly reachable \(HTTP 200\) while the real-gateway allowlist is empty/.test(r.out);
      const placeholderFound = /offers a payment placeholder/.test(r.out);
      const noGw = /no payment gateway configured/.test(r.out);
      R.info(`launch:check --strict --checkout-url=${url.replace(BASE, "")} (fetched through the edge, anonymous)`, `exit ${r.code}; ${line}`);
      R.check(`SITE launch:check --strict --checkout-url=${url.replace(BASE, "")} FAILS, and the failure is the payment gate itself (no real gateway + checkout publicly reachable or placeholder markup found), not only the other pending items`, r.code === 1 && (reach || placeholderFound) && noGw, `exit ${r.code}; ${line}; publicly-reachable problem=${reach}; placeholder-markup problem=${placeholderFound}; no-gateway problem=${noGw}`);
    }
    R.info("limit of the SITE gate's live markup probe", "An anonymous fetch of /checkout/ is redirected (empty cart / sign-in) and the block checkout renders its payment methods client-side, so the server HTML has no bacs markup: the gate's PASS/FAIL here rests on the empty real-gateway allowlist plus 'checkout is publicly reachable (HTTP 200)'. The markup detector itself is proven on the real signed-in DOM below, and the CP check-launch-blockers.php inspects the gateway list directly.", "VERIFIED");
    // a signed-in checkout page body (placeholder visible) run through the same markup detector the gate uses
    const ctx = await newCtx("desktop"); const pg = await ctx.newPage();
    await login(pg, user); await goto(pg, `${BASE}/checkout/?add-to-cart=10`);
    await pg.waitForSelector(".wc-block-components-radio-control", { timeout: 25000 }).catch(() => {});
    await pg.waitForTimeout(2000);
    const html = await pg.content(); await ctx.close();
    const { placeholderMarkup } = await import("../lib/payment-gate.mjs");
    const found = placeholderMarkup(html);
    R.check("the SITE gate's markup detector (placeholderMarkup) finds the placeholder in the REAL rendered, signed-in checkout DOM (so a gateway-less launch cannot pass)", found.length >= 1, JSON.stringify(found));
    const cpScript = path.join(CP_WT, "scripts/check-launch-blockers.php");
    const cp = sh("bash", ["-c", `AICC_PRODUCTION=1 bash '${P.cpFixture}' wp eval-file '${cpScript}'`]);
    const cpOut = cp.out.split("\n").filter((l) => !/^(PHP |Deprecated|Warning)/.test(l));
    R.check("CP scripts/check-launch-blockers.php against the fixture with AICC_PRODUCTION=1 FAILS (exit non-zero) and names the payment placeholder / missing real gateway", cp.code !== 0 && /gateway|placeholder|payment/i.test(cp.out), `exit ${cp.code}; ${cpOut.filter((l) => /gateway|placeholder|payment|FAIL/i.test(l)).slice(0, 3).join(" | ").slice(0, 400)}`);
    R.data.cpLaunchGateTail = cpOut.slice(-12);
  } finally {
    // restore the fixture's payment state
    if (hadBacs) wp("option", "update", "woocommerce_bacs_settings", priorJson, "--format=json"); else wp("option", "delete", "woocommerce_bacs_settings");
  }
  const restored = sh("bash", [P.cpFixture, "wp", "option", "get", "woocommerce_bacs_settings", "--format=json"]);
  R.check("fixture payment state restored (bacs setting back to its original absence/value)", hadBacs ? restored.stdout.trim() === priorJson : restored.code !== 0, `hadBacs=${hadBacs}`);
  R.save();
  return R;
}

/* ================================================================== 7. STRUCTURED DATA / SEO in the browser */
const NOINDEX_RE = /^(\/(he|es|ru))?\/(cart|checkout|my-account)(\/|$)/;
const OFFER_RE = /"@type"\s*:\s*"(Offer|AggregateOffer|Product|ProductGroup)"|"offers"\s*:|"price"\s*:|"priceCurrency"\s*:|"lowPrice"|"highPrice"/;
async function s7() {
  const R = new Result("07-structured-data-seo", "Phase 2 / 7: structured data and SEO signals in the browser through the edge (static and CP, four locales)");
  const ctx = await newCtx("desktop");
  const page = await ctx.newPage();
  const staticPaths = ["/", "/product/", "/data-and-trust/", "/privacy/", "/terms/", "/refund-policy/", "/questions/", "/accessibility/"];
  const cpPaths = ["/pricing/", "/my-account/", "/my-account/lost-password/", "/cart/", "/data-processing-addendum/"];
  const rows = [];
  for (const loc of LOCALES) for (const [kind, list] of [["static", staticPaths], ["cp", cpPaths]]) for (const pth of list) {
    const p = pre(loc);
    const resp = await goto(page, `${BASE}${p}${pth}`);
    const h = await resp.allHeaders();
    const f = await facts(page);
    const dom = await page.evaluate(() => ({ itemprops: [...document.querySelectorAll("[itemprop='price'],[itemprop='priceCurrency'],[itemtype*='schema.org/Offer'],[itemtype*='schema.org/Product']")].length, metaPrice: [...document.querySelectorAll("meta")].filter((m) => /price|product:/i.test(m.getAttribute("property") || m.name || "")).length, ogUrl: document.querySelector('meta[property="og:url"]')?.content || "", ogImage: document.querySelector('meta[property="og:image"]')?.content || "" }));
    const types = []; let offers = false;
    for (const j of f.jsonld) { if (OFFER_RE.test(j)) offers = true; try { const o = JSON.parse(j); (Array.isArray(o["@graph"]) ? o["@graph"] : [o]).forEach((x) => types.push(x["@type"])); } catch { types.push("UNPARSEABLE"); } }
    const url = new URL(f.url);
    const noindexExpected = NOINDEX_RE.test(pth === "/" ? p + "/" : p + pth) || /lost-password/.test(pth);
    const noindex = /noindex/i.test(f.robots) || /noindex/i.test(h["x-robots-tag"] || "");
    const expectCanon = `${BASE}${url.pathname}`;
    const hreflangMap = Object.fromEntries(f.hreflang);
    const wantAlt = Object.fromEntries(["en", "he", "es", "ru"].map((l) => [l, `${BASE}${pre(l)}${pth}`]));
    const hreflangOk = noindexExpected ? true : ["en", "he", "es", "ru"].every((l) => hreflangMap[l] === wantAlt[l]) && hreflangMap["x-default"] === wantAlt.en;
    rows.push({ loc, kind, path: p + pth, status: resp.status(), jsonldTypes: types, offers: offers || dom.itemprops > 0 || dom.metaPrice > 0, noindex, noindexExpected, canonical: f.canonical, canonOk: noindexExpected ? (f.canonical === "" || f.canonical.startsWith(BASE + "/")) : f.canonical === expectCanon, hreflangCount: f.hreflang.length, hreflangOk, ogOk: !dom.ogUrl || dom.ogUrl.startsWith(BASE + "/"), imgOk: !dom.ogImage || dom.ogImage.startsWith(BASE + "/") });
  }
  await ctx.close();
  R.data.pages = rows;
  const bad = (fn) => rows.filter((r) => !fn(r)).map((r) => r.path);
  R.check(`${rows.length} pages visited (4 locales x 8 static + 5 CP): every one answered 200`, bad((r) => r.status === 200).length === 0, JSON.stringify(bad((r) => r.status === 200)));
  R.check("NO Offer / AggregateOffer / Product / price / priceCurrency JSON-LD, microdata or product:price meta on any public page, static or CP, in any locale (owner decision: off until checkout is live)", rows.every((r) => !r.offers), JSON.stringify(rows.filter((r) => r.offers).map((r) => r.path)));
  const allTypes = [...new Set(rows.flatMap((r) => r.jsonldTypes).map(String))];
  R.info("JSON-LD @type values present anywhere", JSON.stringify(allTypes));
  R.check("canonical is the exact www https URL of the page on every indexable page (and, where present, on noindex pages)", rows.every((r) => r.canonOk), JSON.stringify(rows.filter((r) => !r.canonOk).map((r) => [r.path, r.canonical])));
  R.check("hreflang en/he/es/ru + x-default are present and point at the same page in each language on every indexable page (static and CP)", rows.every((r) => r.hreflangOk), JSON.stringify(rows.filter((r) => !r.hreflangOk).map((r) => r.path)));
  R.check("noindex is set on cart / checkout / my-account (all locales, meta robots or X-Robots-Tag) and on lost-password, and is NOT set on any indexable page", rows.every((r) => r.noindex === r.noindexExpected), JSON.stringify(rows.filter((r) => r.noindex !== r.noindexExpected).map((r) => [r.path, r.noindex])));
  R.check("og:url and og:image, where present, are on www", rows.every((r) => r.ogOk && r.imgOk), JSON.stringify(rows.filter((r) => !(r.ogOk && r.imgOk)).map((r) => r.path)));
  // robots.txt and sitemap.xml: served by the static site through the edge
  const rb = await req(EDGE, `${BASE}/robots.txt`), sm = await req(EDGE, `${BASE}/sitemap.xml`);
  const apexRb = await req(EDGE, `${APEX}/robots.txt`);
  R.check("robots.txt is served by the static site (no WordPress marker), text/plain, allows crawling, names the www sitemap", rb.status === 200 && !rb.headers["x-rehearsal-upstream"] && /^text\/plain/.test(rb.headers["content-type"] || "") && /Sitemap:\s*https:\/\/www\.copilt\.org\/sitemap\.xml/i.test(rb.body) && !/Disallow:\s*\/\s*$/m.test(rb.body), `${rb.status} ${rb.headers["content-type"]} :: ${rb.body.replace(/\n/g, " | ").slice(0, 300)}`);
  R.check("apex /robots.txt redirects to www (one hop)", [301, 308].includes(apexRb.status) && String(apexRb.headers.location).trim() === `${BASE}/robots.txt`, `${apexRb.status} ${apexRb.headers.location}`);
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  R.check(`sitemap.xml is served by the static site (application/xml), ${locs.length} URLs, every <loc> is https://www.copilt.org/..., none is cart/checkout/my-account/lost-password`, sm.status === 200 && !sm.headers["x-rehearsal-upstream"] && locs.length > 20 && locs.every((l) => l.startsWith(`${BASE}/`)) && !locs.some((l) => NOINDEX_RE.test(new URL(l).pathname) || /lost-password/.test(l)), `${sm.status} ${sm.headers["content-type"]} locs=${locs.length} bad=${JSON.stringify(locs.filter((l) => !l.startsWith(BASE + "/")).slice(0, 3))}`);
  // every sitemap URL resolves (200) through the edge
  const dead = []; let checked = 0;
  for (const l of locs) { const c = await chase(l); checked++; if (c.status !== 200 || c.chain.length > 1) dead.push([l.replace(BASE, ""), c.chain.map((x) => x.status).join(">")]); }
  R.check(`all ${checked} sitemap URLs answer 200 directly (no redirect) through the edge`, dead.length === 0, JSON.stringify(dead.slice(0, 6)));
  const smHreflang = (sm.body.match(/hreflang="/g) || []).length;
  R.info("sitemap hreflang alternates", `${smHreflang} xhtml:link hreflang entries`);
  R.save();
  return R;
}

/* ================================================================== 8. PERFORMANCE (lightweight) */
const kb = (n) => Math.round(n / 102.4) / 10;
async function perfLoad(label, profile, o = {}) {
  const ctx = await newCtx(profile, { locale: o.locale });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__perf = { fcp: null, lcp: null, lcpEl: "", cls: 0 };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__perf.fcp = e.startTime; }).observe({ type: "paint", buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { const es = l.getEntries(); const e = es[es.length - 1]; window.__perf.lcp = e.startTime; window.__perf.lcpEl = (e.element ? e.element.tagName.toLowerCase() + (e.element.className ? "." + String(e.element.className).split(" ")[0] : "") : e.url || "").slice(0, 60); }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
  });
  const meter = await netMeter(page);
  if (o.throttle) {
    await meter.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await meter.cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await goto(page, o.url || `${BASE}/`);
  await page.waitForTimeout(o.settle || 3500);
  const perf = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { ...window.__perf, dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), hero: (() => { const v = document.querySelector(".aicc-reco-hero__video"); return v ? { src: v.getAttribute("src"), preload: v.preload, autoplay: v.autoplay, paused: v.paused, readyState: v.readyState, currentTime: Math.round(v.currentTime * 10) / 10, buffered: v.buffered.length ? Math.round(v.buffered.end(v.buffered.length - 1)) : 0 } : null; })() }; });
  const all = meter.all().filter((r) => /^https:\/\/www\.copilt\.org/.test(r.url));
  const by = {};
  for (const r of all) { const t = r.type || "Other"; (by[t] ||= { n: 0, kb: 0 }); by[t].n++; by[t].kb += r.enc / 1024; }
  for (const t of Object.values(by)) t.kb = Math.round(t.kb * 10) / 10;
  const hero = all.filter((r) => /reco-hero\.mp4/.test(r.url));
  const out = { label, requests: all.length, transferredKB: kb(all.reduce((a, r) => a + r.enc, 0)), decodedKB: kb(all.reduce((a, r) => a + r.data, 0)), byType: by, fcp: perf.fcp && Math.round(perf.fcp), lcp: perf.lcp && Math.round(perf.lcp), lcpEl: perf.lcpEl, cls: Math.round(perf.cls * 1000) / 1000, dcl: perf.dcl, load: perf.load, demoRequests: all.filter((r) => /\/demo\//.test(r.url)).map((r) => r.url.replace(BASE, "")), demoMp4: all.some((r) => /aicc-demo\.mp4/.test(r.url)), heroVideo: perf.hero, heroRequests: hero.map((r) => ({ range: r.range || "(none)", status: r.status, kb: kb(r.enc), failed: r.failed })), heroKB: kb(hero.reduce((a, r) => a + r.enc, 0)), top: [...all].sort((a, b) => b.enc - a.enc).slice(0, 5).map((r) => [r.url.replace(BASE, "").slice(0, 60), kb(r.enc)]), resources: all.map((r) => ({ url: r.url, enc: r.enc, data: r.data, type: r.type, mime: r.mime, ce: r.contentEncoding })) };
  await ctx.close();
  return out;
}

async function s8() {
  const R = new Result("08-performance", "Phase 2 / 8: lightweight performance through the edge (Home EN: desktop, mobile, reduced motion; demo untouched until opened; compression)");
  R.note("Loopback, no network throttling except where labelled: LCP/FCP show render cost, not WAN latency. php -S and a Mac are not production capacity.");
  const runs = {};
  runs.desktop = await perfLoad("desktop 1280x800, cold cache", "desktop");
  runs.mobile = await perfLoad("mobile 390x844 touch, cold cache", "mobile");
  runs.reduced = await perfLoad("desktop, prefers-reduced-motion", "reduced");
  runs.mobileReduced = await perfLoad("mobile, prefers-reduced-motion", "mobileReduced");
  runs.mobileSlow = await perfLoad("mobile + Slow-4G (1.6 Mbps, 150 ms) + 4x CPU", "mobile", { throttle: true, settle: 6000 });
  for (const v of Object.values(runs)) {
    R.check(`[${v.label}] Home loads with /demo/aicc-demo.mp4 NOT requested (and no /demo/ request of any kind: no poster, no captions)`, !v.demoMp4 && v.demoRequests.length === 0, JSON.stringify(v.demoRequests));
    R.info(`[${v.label}] weight and timings`, `${v.requests} requests, ${v.transferredKB} KiB on the wire (${v.decodedKB} KiB decoded); FCP ${v.fcp} ms, LCP ${v.lcp} ms (${v.lcpEl}), CLS ${v.cls}, DCL ${v.dcl} ms, load ${v.load} ms; by type ${JSON.stringify(v.byType)}`);
    R.info(`[${v.label}] Reco hero loop video`, `${JSON.stringify(v.heroVideo)}; requests ${JSON.stringify(v.heroRequests)}; ${v.heroKB} KiB`);
    R.info(`[${v.label}] five heaviest responses`, JSON.stringify(v.top));
  }
  R.data.runs = Object.fromEntries(Object.entries(runs).map(([k, v]) => { const rest = { ...v }; delete rest.resources; return [k, rest]; }));
  R.check("Home (desktop, cold) stays under a 1.5 MiB budget excluding the Reco hero loop video", (runs.desktop.transferredKB - runs.desktop.heroKB) < 1536, `${(runs.desktop.transferredKB - runs.desktop.heroKB).toFixed(0)} KiB without the loop video; with it ${runs.desktop.transferredKB} KiB`);
  // hero loop video on mobile / reduced motion
  const heroMobile = runs.mobile.heroKB, heroReduced = runs.reduced.heroKB, heroMR = runs.mobileReduced.heroKB;
  R.info("Reco hero loop video bytes by profile (KiB)", `desktop ${runs.desktop.heroKB}; mobile ${heroMobile}; reduced-motion desktop ${heroReduced}; mobile+reduced ${heroMR}; mobile Slow-4G ${runs.mobileSlow.heroKB}`);
  R.data.heroVideoKB = { desktop: runs.desktop.heroKB, mobile: heroMobile, reduced: heroReduced, mobileReduced: heroMR, mobileSlow: runs.mobileSlow.heroKB };
  R.check("reduced motion: the hero loop video is not PLAYED (paused) and downloads at most its metadata (<= 512 KiB)", runs.reduced.heroVideo?.paused === true && runs.reduced.heroKB <= 512 && runs.mobileReduced.heroVideo?.paused === true && runs.mobileReduced.heroKB <= 512, `reduced ${runs.reduced.heroKB} KiB paused=${runs.reduced.heroVideo?.paused}; mobile+reduced ${heroMR} KiB paused=${runs.mobileReduced.heroVideo?.paused}`);

  // dialog open before play: only ranged requests and small bytes
  const ctx = await newCtx("desktop"); const page = await ctx.newPage(); const meter = await netMeter(page);
  await goto(page, `${BASE}/`); await page.waitForTimeout(1500);
  const t0 = meter.now();
  await page.locator("[data-aicc-demo-trigger]:visible").first().click();
  await page.waitForFunction(() => { const v = document.querySelector("dialog[open] video"); return v && v.readyState >= 1; }, null, { timeout: 25000 });
  await page.waitForTimeout(1500);
  const d = meter.where(/\/demo\//, t0 - 5);
  const dmp4 = d.filter((r) => /\.mp4/.test(r.url));
  R.check(`dialog open, before play: only ranged video requests (${dmp4.map((r) => r.range + "->" + r.status).join(", ")}), ${kb(d.reduce((a, r) => a + r.enc, 0))} KiB total for poster + captions + video head (of 42.3 MiB)`, dmp4.length >= 1 && dmp4.every((r) => /^bytes=\d+-/.test(r.range) && r.status === 206) && d.reduce((a, r) => a + r.enc, 0) < 2 * 1024 * 1024, JSON.stringify(d.map((r) => [r.url.replace(BASE, ""), r.range, r.status, kb(r.enc)])));
  await ctx.close();

  // compression: compressed vs identity for HTML / JS / CSS (curl through the edge)
  const res = runs.desktop.resources.filter((r) => /^https:\/\/www\.copilt\.org\/_next\/static\//.test(r.url) || r.url === `${BASE}/`);
  const bigJs = res.filter((r) => /\.js(\?|$)/.test(r.url)).sort((a, b) => b.data - a.data)[0];
  const bigCss = res.filter((r) => /\.css(\?|$)/.test(r.url)).sort((a, b) => b.data - a.data)[0];
  const comp = [];
  for (const [name, u] of [["Home HTML", `${BASE}/`], ["largest JS", bigJs?.url], ["largest CSS", bigCss?.url], ["CP pricing HTML", `${BASE}/pricing/`], ["CP sitemap-like JSON (wp-json)", `${BASE}/wp-json/`]]) {
    if (!u) continue;
    const idn = await req(EDGE, u, { headers: { "Accept-Encoding": "identity" }, bodyFile: "/dev/null" });
    const gz = await req(EDGE, u, { headers: { "Accept-Encoding": "gzip" }, bodyFile: "/dev/null" });
    const zs = await req(EDGE, u, { headers: { "Accept-Encoding": "zstd, gzip" }, bodyFile: "/dev/null" });
    const br = await req(EDGE, u, { headers: { "Accept-Encoding": "br" }, bodyFile: "/dev/null" });
    const hv = (h) => [].concat(h || []).join(",");
    comp.push({ name, url: u.replace(BASE, "").slice(0, 70), identityKB: kb(idn.bytes), identityEnc: hv(idn.headers["content-encoding"]) || "none", gzipKB: kb(gz.bytes), gzipEnc: hv(gz.headers["content-encoding"]) || "none", zstdKB: kb(zs.bytes), zstdEnc: hv(zs.headers["content-encoding"]) || "none", brEnc: hv(br.headers["content-encoding"]) || "none", vary: hv(gz.headers.vary) });
  }
  R.data.compression = comp;
  R.check("HTML, JS and CSS are compressed through the edge (gzip and zstd much smaller than identity; identity has no Content-Encoding; Vary: Accept-Encoding)", comp.filter((c) => /HTML|JS|CSS/.test(c.name)).every((c) => c.identityEnc === "none" && c.gzipEnc === "gzip" && c.gzipKB < c.identityKB * 0.6 && /Accept-Encoding/i.test(c.vary)), JSON.stringify(comp.map((c) => `${c.name}: identity ${c.identityKB} KiB, gzip ${c.gzipKB}, zstd ${c.zstdKB} (${c.zstdEnc})`)));
  R.save();
  return R;
}

/* ================================================================== 9. CLIENT IP IN THE BROWSER PATH */
async function s9() {
  const R = new Result("09-client-ip", "Phase 2 / 9: what the Control Plane receives for a real browser request through the edge (client IP, proto, host, spoofing)");
  const token = cpEchoToken();
  const ctx = await newCtx("desktop");
  const page = await ctx.newPage();
  try {
    await goto(page, `${BASE}/`);
    const echo = (extra) => page.evaluate(async ([t, h]) => { const r = await fetch(`/wp-json/?__rehearsal_echo=${t}`, { credentials: "same-origin", headers: h }); const j = await r.json(); return { status: r.status, cc: r.headers.get("cache-control") || "", body: j }; }, [token, extra || {}]);
    const clean = await echo();
    const san = (b) => ({ ...b, request_uri: String(b.request_uri || "").replace(token, "REDACTED") });
    const b = clean.body, h = b.headers || {};
    R.check("echo through the edge from a real browser: 200 JSON, no-store", clean.status === 200 && /no-store/.test(clean.cc), `${clean.status} ${clean.cc}`);
    R.check("CP sees remote_addr = the edge (127.0.0.1) and its own client IP = 127.0.0.1 (the browser's real peer address on this Mac), via X-Forwarded-For with exactly ONE entry", b.remote_addr === "127.0.0.1" && b.cp_client_ip === "127.0.0.1" && h["x-forwarded-for"] === "127.0.0.1", JSON.stringify({ remote_addr: b.remote_addr, cp_client_ip: b.cp_client_ip, xff: h["x-forwarded-for"] }));
    R.check("CP sees HTTPS (X-Forwarded-Proto https, is_ssl true, HTTPS server var on), host www.copilt.org (Host and X-Forwarded-Host), home_url https://www.copilt.org/", h["x-forwarded-proto"] === "https" && b.is_ssl === true && b.https_server_var === "on" && b.host === "www.copilt.org" && h["x-forwarded-host"] === "www.copilt.org" && b.home_url === "https://www.copilt.org/", JSON.stringify({ proto: h["x-forwarded-proto"], is_ssl: b.is_ssl, host: b.host, xfh: h["x-forwarded-host"], home: b.home_url }));
    const ALLOWED = /^(host|user-agent|accept|accept-encoding|accept-language|via|x-forwarded-for|x-forwarded-host|x-forwarded-proto|x-request-id|referer|origin|sec-[a-z-]+|connection|content-length|content-type|cookie|priority|cache-control|pragma|dnt|upgrade-insecure-requests)$/;
    const extra = Object.keys(h).filter((k) => !ALLOWED.test(k));
    R.check(`the header set the CP receives contains nothing unexpected (${Object.keys(h).length} headers; unexpected: ${JSON.stringify(extra)})`, extra.length === 0, Object.keys(h).join(","));
    R.check("Via: 2.0 Caddy is the only proxy marker the CP sees (a clean browser request carries none of the identity headers either)", h.via === "2.0 Caddy" && !["forwarded", "x-real-ip", "x-original-url", "x-rewrite-url", "true-client-ip", "cf-connecting-ip", "client-ip", "x-client-ip", "x-forwarded-server", "x-forwarded-port"].some((k) => k in h), JSON.stringify(Object.keys(h).filter((k) => /forward|real|client|original|rewrite/.test(k))));
    R.data.cleanEcho = san(b);

    // forged headers from page JavaScript: none may reach or change the CP's view
    const forged = { "X-Forwarded-For": "203.0.113.9, 198.51.100.7", "X-Real-IP": "203.0.113.10", Forwarded: "for=203.0.113.11;proto=http;host=evil.example", "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http", "X-Original-URL": "/wp-admin/", "X-Rewrite-URL": "/wp-admin/", "X-Request-Id": "forged-request-id", "True-Client-IP": "203.0.113.12", "CF-Connecting-IP": "203.0.113.13", "X-Forwarded-Port": "8080", "Client-IP": "203.0.113.14", "X-Client-IP": "203.0.113.15", "X-Cluster-Client-IP": "203.0.113.16", "X-Originating-IP": "203.0.113.17", "Fastly-Client-IP": "203.0.113.18", "Forwarded-For": "203.0.113.19", "X-Forwarded": "203.0.113.20", "X-Forwarded-Scheme": "http", "X-Forwarded-Ssl": "off", "Front-End-Https": "off", "X-Url-Scheme": "http", "X-Forwarded-Server": "evil.example" };
    const STRIPPED = ["forwarded", "x-real-ip", "x-original-url", "x-rewrite-url", "true-client-ip", "cf-connecting-ip", "x-forwarded-port", "client-ip", "x-client-ip", "x-cluster-client-ip", "x-originating-ip", "fastly-client-ip", "forwarded-for", "x-forwarded", "x-forwarded-scheme", "x-forwarded-ssl", "front-end-https", "x-url-scheme", "x-forwarded-server"];
    const f = await echo(forged);
    const fb = f.body, fh = fb.headers || {};
    R.check("FORGED X-Forwarded-For (two fake addresses) from browser JavaScript: the CP still sees exactly 127.0.0.1 (the edge overwrites the header; nothing appended)", fh["x-forwarded-for"] === "127.0.0.1" && fb.cp_client_ip === "127.0.0.1" && !/203\.0\.113|198\.51\.100/.test(JSON.stringify(fb)), JSON.stringify({ xff: fh["x-forwarded-for"], cp_client_ip: fb.cp_client_ip }));
    R.check(`FORGED identity/scheme headers (${STRIPPED.length} names: Forwarded, X-Real-IP, Client-IP, CF-Connecting-IP, True-Client-IP, X-Cluster-Client-IP, X-Originating-IP, Fastly-Client-IP, Forwarded-For, X-Forwarded, -Port, -Scheme, -Ssl, -Server, Front-End-Https, X-Url-Scheme, X-Original-URL, X-Rewrite-URL, X-Client-IP): NONE reaches the CP; X-Forwarded-Host/-Proto are the edge's (www.copilt.org, https)`, STRIPPED.every((k) => !(k in fh)) && fh["x-forwarded-host"] === "www.copilt.org" && fh["x-forwarded-proto"] === "https" && fb.host === "www.copilt.org" && fb.is_ssl === true, JSON.stringify({ xfh: fh["x-forwarded-host"], xfp: fh["x-forwarded-proto"], leaked: STRIPPED.filter((k) => k in fh) }));
    R.check("FORGED X-Request-Id: the CP receives the edge's own id, not the browser's", fh["x-request-id"] !== "forged-request-id" && /^[0-9a-f-]{36}$/.test(fh["x-request-id"] || ""), `${(fh["x-request-id"] || "").slice(0, 8)}...`);
    R.check("the forged request's answer is otherwise identical in the fields that matter (remote_addr, home_url, request path)", fb.remote_addr === b.remote_addr && fb.home_url === b.home_url, "");
    R.data.forgedEcho = san(fb);
    // the edge's own access log records the real peer for the forged request, with the forged header only as client-sent data
    await sleep(800);
    const rid = fh["x-request-id"];
    const logLine = fs.readFileSync(path.join(P.logs, "aicc-edge.log"), "utf8").split("\n").reverse().find((l) => l.includes(rid));
    let entry = null; try { entry = JSON.parse(logLine); } catch { /* not found */ }
    R.check("edge access log for the forged browser request: remote_ip and client_ip are 127.0.0.1 (the TCP peer), the edge's own record of the TCP peer, not the forged header", !!entry && entry.request.remote_ip === "127.0.0.1" && entry.request.client_ip === "127.0.0.1", entry ? JSON.stringify({ remote_ip: entry.request.remote_ip, client_ip: entry.request.client_ip, uri: String(entry.request.uri).replace(token, "REDACTED"), status: entry.status }) : "log line not found");
    R.info("scope of this check", "From this Mac the browser's peer address is 127.0.0.1, so 'real peer' is the loopback address. A forged XFF of a public address never reached the CP. The rehearsal's public-source twin and the IPv6 peer (::1) were exercised at curl level in phase 1 (06-try-to-break, 07-logging); a real public client address cannot be produced here (UNVERIFIED for non-loopback peers).", "UNVERIFIED");
  } catch (e) { R.check("client-ip flow completed", false, String(e.stack || e).slice(0, 500)); }
  await ctx.close().catch(() => {});
  R.save();
  return R;
}

/* ================================================================== 10. ROUND 4a: public surface, footer, lang/dir, legal links, copy (through the edge) */
async function s10() {
  const R = new Result("10-round4a-public-surface", "Phase 2 / 10: CORS, user enumeration, feeds, footer year, html lang/dir, privacy link, registration wording, Reco intro and home FAQ (real HTTP + browser through the edge)");
  const plans = `${BASE}/wp-json/aicc-license/v1/plans`;
  const h1 = (r, k) => [].concat(r.headers[k] || []).join(",");
  // --- CORS (real HTTP through the edge)
  const evil = await req(EDGE, plans, { headers: { Origin: "https://evil.example" } });
  const own = await req(EDGE, plans, { headers: { Origin: BASE } });
  const none = await req(EDGE, plans);
  const nul = await req(EDGE, plans, { headers: { Origin: "null" } });
  const pfEvil = await req(EDGE, plans, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  const pfOwn = await req(EDGE, plans, { method: "OPTIONS", headers: { Origin: BASE, "Access-Control-Request-Method": "POST" } });
  R.check("CORS through the edge: a foreign Origin (https://evil.example) gets NO Access-Control-Allow-Origin and NO Allow-Credentials on a REST route", evil.status === 200 && !h1(evil, "access-control-allow-origin") && !h1(evil, "access-control-allow-credentials"), `${evil.status} acao="${h1(evil, "access-control-allow-origin")}" acac="${h1(evil, "access-control-allow-credentials")}"`);
  R.check("CORS: the own origin (https://www.copilt.org) is allowed with credentials", own.status === 200 && h1(own, "access-control-allow-origin") === BASE && h1(own, "access-control-allow-credentials") === "true", `acao="${h1(own, "access-control-allow-origin")}" acac="${h1(own, "access-control-allow-credentials")}"`);
  R.check("CORS: no Origin header (the plugin calling the CP server to server) is unchanged: 200, no CORS headers", none.status === 200 && !h1(none, "access-control-allow-origin"), `${none.status}`);
  R.check("CORS: Origin: null gets nothing; Vary: Origin present on cross-origin answers", !h1(nul, "access-control-allow-origin") && /origin/i.test(h1(evil, "vary")), `vary="${h1(evil, "vary")}"`);
  R.check("CORS preflight (OPTIONS): foreign origin answered but granted nothing; own origin granted with the method list", pfEvil.status === 200 && !h1(pfEvil, "access-control-allow-origin") && pfOwn.status === 200 && h1(pfOwn, "access-control-allow-origin") === BASE && /POST/.test(h1(pfOwn, "access-control-allow-methods")), `foreign ${pfEvil.status} acao="${h1(pfEvil, "access-control-allow-origin")}"; own ${pfOwn.status} acao="${h1(pfOwn, "access-control-allow-origin")}"`);
  // a real browser page on www reading REST with credentials works (same origin) and the browser cannot read it cross-origin from the apex-hosted evil page analogue
  const ctx = await newCtx("desktop");
  const page = await ctx.newPage();
  await goto(page, `${BASE}/`);
  const same = await page.evaluate(async () => { const r = await fetch("/wp-json/aicc-license/v1/plans", { credentials: "include" }); return { status: r.status, ok: r.ok }; });
  R.check("a page on www.copilt.org still reads the CP REST route (same origin)", same.status === 200, JSON.stringify(same));
  const cross = await page.evaluate(async () => { try { const r = await fetch("https://copilt.org/wp-json/aicc-license/v1/plans", { credentials: "include", mode: "cors" }); return { status: r.status }; } catch (e) { return { blocked: true, error: String(e).slice(0, 60) }; } });
  R.check("the browser BLOCKS a credentialed cross-origin read from www to the apex origin (apex answers a redirect without CORS grants)", cross.blocked === true, JSON.stringify(cross));

  // --- user enumeration
  for (const u of ["/wp-json/wp/v2/users", "/wp-json/wp/v2/users/1", "/he/wp-json/wp/v2/users"]) {
    const r = await req(EDGE, `${BASE}${u}`);
    R.check(`anonymous GET ${u}: no user listing (404 or no login names in the body)`, r.status === 404 || !/"slug"|"name"/.test(r.body), `${r.status} ${r.body.slice(0, 60)}`);
  }
  const au = await req(EDGE, `${BASE}/author/rehearsal-admin/`);
  R.check("/author/<login>/ through the edge answers 404 and no login is echoed", au.status === 404 && !/rehearsal-admin/.test(au.body), `${au.status}`);
  const direct = (p) => sh("bash", ["-c", `curl -s -o /dev/null -D - -H 'Host: www.copilt.org' -H 'X-Forwarded-Proto: https' 'http://127.0.0.1:18982${p}' | head -1; curl -s -D - -o /dev/null -H 'Host: www.copilt.org' -H 'X-Forwarded-Proto: https' 'http://127.0.0.1:18982${p}' | grep -i '^location' || true`]).stdout.replace(/\r/g, "").trim().split("\n").join(" | ");
  const a1 = direct("/?author=1"), f1 = direct("/?feed=rss2"), f2 = direct("/feed/");
  R.check("(CP upstream, bypassing the edge, which owns / for the static site) /?author=1 is 404 with no Location header leaking the login", /404/.test(a1) && !/location/i.test(a1), a1);
  R.check("(CP upstream) /?feed=rss2 and /feed/ are 404", /404/.test(f1) && /404/.test(f2), `${f1} || ${f2}`);

  // --- feeds and discovery links on CP pages (browser DOM + headers), four languages
  const feedBad = [];
  for (const loc of LOCALES) for (const pth of ["/pricing/", "/my-account/", "/cart/", "/terms/"]) {
    const resp = await goto(page, `${BASE}${pre(loc)}${pth}`);
    const hdr = await resp.allHeaders();
    const bad = await page.evaluate(() => [...document.querySelectorAll('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"], link[rel="shortlink"], link[rel="https://api.w.org/"], link[rel="EditURI"], link[rel="wlwmanifest"], link[type="application/json+oembed"], link[type="text/xml+oembed"], meta[name="generator"]')].map((l) => l.getAttribute("rel") || l.getAttribute("name")));
    if (bad.length || hdr.link) feedBad.push(`${pre(loc)}${pth}: ${bad.join(",")}${hdr.link ? " Link-header" : ""}`);
  }
  R.check("no feed / shortlink / REST-discovery / EditURI / WLW / oEmbed link or generator meta, and no Link HTTP header, on CP pages in 4 languages", feedBad.length === 0, JSON.stringify(feedBad));
  for (const u of ["/feed/", "/comments/feed/", "/he/feed/", "/es/comments/feed/"]) { const r = await req(EDGE, `${BASE}${u}`); R.check(`${u}: 404 through the edge`, r.status === 404, `${r.status}`); }
  const stat = await req(EDGE, `${BASE}/`);
  R.check("static home does not emit a feed link either", !/type="application\/(rss|atom)\+xml"/.test(stat.body));

  // --- html lang/dir on every CP page type in four languages (incl. checkout with a plan and the 404 page), and the footer year
  const user = createUser("r4a");
  const yr = String(new Date().getFullYear());
  const staticFooter = [];
  const langBad = [], footBad = [];
  for (const loc of LOCALES) {
    const p = pre(loc);
    await goto(page, `${BASE}${p}/`);
    const sf = (await text(page, "footer")).replace(/\s+/g, " ");
    const m = /©\s*(\d{4})\s*AICC/.exec(sf);
    staticFooter.push(m ? m[1] : "none");
    for (const pth of ["/pricing/", "/terms/", "/privacy/", "/cart/", "/my-account/", "/my-account/lost-password/", "/pricing/no-such-page/"]) {
      const resp = await goto(page, `${BASE}${p}${pth}`);
      const f = await facts(page);
      const attrs = await page.evaluate(() => ({ lang: document.documentElement.getAttribute("lang"), dir: document.documentElement.getAttribute("dir") }));
      if (attrs.lang !== loc || attrs.dir !== (loc === "he" ? "rtl" : "ltr")) langBad.push(`${p}${pth} (${resp.status()}): ${attrs.lang}/${attrs.dir}`);
      const ft = (await text(page, "footer")).replace(/\s+/g, " ");
      const fm = /©\s*(\d{4})\s*AICC/.exec(ft);
      if (!fm || fm[1] !== yr) footBad.push(`${p}${pth}: ${fm ? fm[0] : "no © line"}`);
      void f;
    }
  }
  await login(page, user);
  await goto(page, `${BASE}/pricing/`);
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator('a[href*="add-to-cart=10"]').first().click()]);
  await page.waitForSelector(".wc-block-checkout", { timeout: 25000 }).catch(() => {});
  const ck = await page.evaluate(() => ({ lang: document.documentElement.getAttribute("lang"), dir: document.documentElement.getAttribute("dir"), foot: (document.querySelector("footer")?.innerText || "").replace(/\s+/g, " ") }));
  if (ck.lang !== "en" || ck.dir !== "ltr") langBad.push(`/checkout/: ${ck.lang}/${ck.dir}`);
  if (!new RegExp(`©\\s*${yr}\\s*AICC`).test(ck.foot)) footBad.push(`/checkout/: ${/©[^A]*AICC/.exec(ck.foot)?.[0]}`);
  await goto(page, `${BASE}/he/checkout/`);
  await page.waitForSelector(".wc-block-checkout", { timeout: 25000 }).catch(() => {});
  const ckh = await page.evaluate(() => ({ lang: document.documentElement.getAttribute("lang"), dir: document.documentElement.getAttribute("dir") }));
  if (ckh.lang !== "he" || ckh.dir !== "rtl") langBad.push(`/he/checkout/: ${ckh.lang}/${ckh.dir}`);
  R.check("html lang and dir are exactly the language contract (en|he|es|ru, ltr|rtl) on pricing, legal x2, cart, my-account, lost-password, the 404 page and checkout, in all four languages (no en-US, no missing dir)", langBad.length === 0, JSON.stringify(langBad));
  R.check(`the CP footer reads "© ${yr} AICC" (year computed at render time) on every one of those pages, like the static site (${staticFooter.join("/")})`, footBad.length === 0 && staticFooter.every((y) => y === yr), JSON.stringify({ footBad, staticFooter }));

  // --- legal links and registration wording (EN + HE), through the real form
  for (const loc of ["en", "he"]) {
    const p = pre(loc);
    const c2 = await newCtx("desktop", { locale: loc === "he" ? "he-IL" : "en-US" });
    const pg = await c2.newPage();
    await goto(pg, `${BASE}${p}/my-account/`);
    const href = await pg.locator("form.register a.woocommerce-privacy-policy-link, .woocommerce-privacy-policy-text a").first().getAttribute("href");
    R.check(`[${loc}] the register form's privacy-policy link is ${BASE}${p}/privacy/ (not /?page_id=N)`, href === `${BASE}${p}/privacy/`, String(href));
    const landed = await goto(pg, href);
    const ff = await facts(pg);
    R.check(`[${loc}] ... and it opens the real policy (200, ${loc} lang, a privacy heading)`, landed.status() === 200 && ff.lang.startsWith(loc) && /\S/.test(ff.h1), `${landed.status()} ${ff.lang} "${ff.h1}"`);
    await goto(pg, `${BASE}${p}/my-account/`);
    await pg.fill("#reg_email", `bf-r4a-${loc}-${RUN_ID}@example.test`);
    await Promise.all([pg.waitForNavigation({ waitUntil: "load" }), pg.click("form.register button[type=submit]")]);
    const uid = wpOut("user", "get", `bf-r4a-${loc}-${RUN_ID}@example.test`, "--field=ID"); if (/^\d+$/.test(uid)) createdUsers.push(uid);
    const note = (await text(pg, "main")).replace(/\s+/g, " ");
    const old = { en: /temporary password/i, he: /סיסמה זמנית/ }[loc];
    const fresh = { en: /signed in with a password we generated\. We emailed you a link to set your own/, he: /סיסמה שנוצרה אוטומטית/ }[loc];
    R.check(`[${loc}] after registering, the notice no longer says "temporary password" and says what is true (a generated password and an emailed link to set your own); the register form says the same link is sent`, !old.test(note) && fresh.test(note), (note.match(/Your account with[^.]*\.[^.]*\.|החשבון שלכם[^.]*\.[^.]*\./) || [note.slice(0, 120)])[0]);
    await c2.close();
  }

  // --- copy: Reco intro in the home demo panel, home FAQ list
  await goto(page, `${BASE}/`);
  await page.waitForSelector(".aicc-fbt__recointro", { state: "attached", timeout: 15000 }).catch(() => {});
  const demoText = (await page.locator("#demo").innerText().catch(() => "")).replace(/\s+/g, " ");
  R.check("home demo panel introduces Reco before relying on it: 'Meet Reco, AICC's built-in guide in your WordPress dashboard.' (and no bare 'Reco is your guide')", /Meet Reco, AICC['’]s built-in guide in your WordPress dashboard\./.test(demoText) && !/Reco is your guide inside AICC/.test(demoText), (demoText.match(/Meet Reco[^.]*\./) || ["not found"])[0]);
  for (const loc of ["he", "es", "ru"]) {
    await goto(page, `${BASE}/${loc}/`);
    await page.waitForSelector(".aicc-fbt__recointro", { state: "attached", timeout: 15000 }).catch(() => {});
    const t = (await page.locator("#demo").innerText().catch(() => "")).replace(/\s+/g, " ");
    R.check(`[${loc}] the Reco intro was updated in the same panel (old "guide inside AICC" sentence gone)`, !/המדריך שלכם בתוך AICC|es su guía dentro de AICC|ваш гид внутри AICC/.test(t) && /Reco/.test(t), (t.match(/(הכירו את Reco|Conozca a Reco|Знакомьтесь)[^.]*\./) || ["not found"])[0]);
  }
  const faqOn = async (u) => { await goto(page, `${BASE}${u}`); const vis = await page.evaluate(() => [...document.querySelectorAll("#faq summary, [data-faq] summary, details summary")].map((s) => (s.textContent || "").trim())); const ld = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => { try { const j = JSON.parse(s.textContent || ""); return (Array.isArray(j) ? j : [j]).filter((x) => x["@type"] === "FAQPage").flatMap((x) => (x.mainEntity || []).map((q) => q.name)); } catch { return []; } })); return { vis, ld }; };
  const homeFaq = await faqOn("/");
  const qs = await faqOn("/questions/");
  const fbt = "Is AICC just Frequently Bought Together?";
  R.check("home FAQ list no longer features 'Is AICC just Frequently Bought Together?' (visible list and FAQPage JSON-LD), and the visible and structured lists are the same set", !homeFaq.vis.includes(fbt) && !homeFaq.ld.includes(fbt) && homeFaq.vis.length >= 5 && homeFaq.ld.every((q) => homeFaq.vis.includes(q)), `visible ${homeFaq.vis.length}, ld ${homeFaq.ld.length}`);
  R.check("/questions/ still lists it (visible; JSON-LD per the legal-review switch)", qs.vis.includes(fbt), `visible ${qs.vis.length}`);
  await ctx.close();
  R.save();
  return R;
}

/* ==== MAIN ==== */
async function preflight() {
  const problems = [];
  if (!fs.existsSync(CHROME)) problems.push(`Chrome not found at ${CHROME} (set AICC_CHROME)`);
  if (!(await portListening(443)) || !(await portListening(80))) problems.push("edge is not listening on :80/:443 (node scripts/rehearsal/rehearsal.mjs start)");
  if (!(await portListening(18982))) problems.push("CP fixture is not listening on 127.0.0.1:18982 (bash scripts/rehearsal/cp-fixture.sh start)");
  if (!fs.existsSync(P.rootCrt)) problems.push("rehearsal root CA missing");
  if (!problems.length) { const r = await req(EDGE, `${BASE}/`); if (r.status !== 200) problems.push(`edge answered ${r.status} for /`); }
  if (problems.length) { console.error("PRE-FLIGHT FAILED:\n - " + problems.join("\n - ")); process.exit(2); }
}
const SECTION_FNS = () => ({ 1: typeof s1 === "function" && s1, 2: typeof s2 === "function" && s2, 3: typeof s3 === "function" && s3, 4: typeof s4 === "function" && s4, 5: typeof s5 === "function" && s5, 6: typeof s6 === "function" && s6, 7: typeof s7 === "function" && s7, 8: typeof s8 === "function" && s8, 9: typeof s9 === "function" && s9, 10: typeof s10 === "function" && s10 });
async function main() {
  await preflight();
  fs.mkdirSync(SHOTS, { recursive: true });
  const fns = SECTION_FNS();
  const results = [];
  try {
    for (const n of Object.keys(fns)) {
      if (only && !only.includes(n)) continue;
      if (!fns[n]) continue;
      console.log(`== section ${n}`);
      try { results.push(await fns[n]()); } catch (e) { console.error(`section ${n} crashed: ${e.stack || e}`); const R = new Result(`0${n}-crashed`, `section ${n} crashed`); R.check("section ran", false, String(e.stack || e)); R.save(); results.push(R); }
    }
  } finally {
    await closeBrowser();
    cleanupUsers();
  }
  const summary = results.map((r) => ({ section: r.id, title: r.title, verdict: r.verdict(), passed: r.passed, failed: r.failed, findings: r.findings }));
  writeJson(path.join(OUT, only ? `00-summary-partial.json` : "00-summary.json"), { run: RUN_ID, finished: new Date().toISOString(), summary });
  if (!only) fs.writeFileSync(path.join(OUT, "00-summary.md"), ["# AICC edge rehearsal, phase 2: browser flows through the real edge", "", `Run ${RUN_ID}, ${new Date().toISOString()}. Chrome via playwright-core; names mapped to 127.0.0.1 only inside the browser; fake @example.test accounts, deleted afterwards. Nothing was paid or submitted.`, "", "| section | verdict | PASS | FAIL | detail |", "|---|---|---|---|---|", ...summary.map((x) => `| ${x.section} | ${x.verdict} | ${x.passed} | ${x.failed} | [${x.section}.md](${x.section}.md) |`), "", "Screenshots (sanitized: email and password fields masked, no URL bar): screenshots/", ""].join("\n"));
  console.log("\n" + summary.map((s) => `${s.verdict.padEnd(7)} ${s.section}  PASS ${s.passed} FAIL ${s.failed}`).join("\n"));
  process.exit(results.some((r) => r.failed) ? 1 : 0);
}
await main();
