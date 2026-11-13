// A small local MOCK of the request-access contract (P32): serves a static export AND the three same-origin routes of the Control Plane intake, so the Site's request pages can be tested
// end to end without any real Control Plane, mail provider or Turnstile account. It implements the checks of the contract that matter to the browser (content type, the X-AICC-Request
// header, Origin, the 2048-byte cap, the exact key set, the order status -> token -> bot check -> rate limit -> neutral 202) and records every request so tests can assert what the page sent.
// It never touches a network outside 127.0.0.1. The behaviour of each route is set by the test through `set({...})`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".vtt": "text/vtt; charset=utf-8" };
const KEYS = ["email", "store_url", "plan", "operator_confirmed", "terms_accepted", "lang", "turnstile_token", "form_token", "website"];
const DEFAULTS = {
  status: "open", // open | closed | 429 | http500 | badjson | drop | missingkey
  create: "auto", // auto (contract rules + neutral 202) | 429 | 503 | 400bot | 400invalid | drop | 202
  confirm: "auto", // auto (single-use tokens) | throttle | 503 | drop
  statusDelayMs: 0,
  // P37 self-service sign-up status (GET /wp-json/aicc/v1/signup/status): open | waitlist | closed_cutoff | paused | off | http404 | http500 | badjson | drop | inconsistent (open:true with mode paused) | unknown (mode "maybe")
  signup: "open",
  signupDelayMs: 0,
};

export async function startMock({ dir, port = 0 }) {
  const root = path.resolve(dir);
  let cfg = { ...DEFAULTS };
  const log = [];
  const usedTokens = new Set();
  const usedTurnstile = new Set();
  let offset = 0; // a virtual clock: a test that fast-forwards the page clock advances the server's by the same amount
  const vnow = () => Date.now() + offset;
  let seq = 0;
  const json = (res, code, body, extra = {}) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra }); res.end(JSON.stringify(body)); };
  let origin = "";

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    if (p === "/wp-json/aicc/v1/signup/status") {
      log.push({ t: vnow(), method: req.method, path: p, headers: { cookie: req.headers.cookie || "", origin: req.headers.origin || "" }, raw: "", bytes: 0 });
      if (cfg.signupDelayMs) await new Promise((r) => setTimeout(r, cfg.signupDelayMs));
      const m = cfg.signup;
      if (m === "drop") return req.socket.destroy();
      if (m === "http404") return json(res, 404, { code: "rest_no_route" });
      if (m === "http500") return json(res, 500, { open: true, mode: "open" });
      if (m === "badjson") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{not json"); }
      if (m === "inconsistent") return json(res, 200, { open: true, mode: "paused" });
      if (m === "unknown") return json(res, 200, { open: true, mode: "maybe" });
      return json(res, 200, { open: m === "open", mode: m, plan_options: ["solo", "studio", "agency"] });
    }
    if (p.startsWith("/wp-json/aicc/v1/access-requests")) {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size < 1_000_000) chunks.push(c); }
      const raw = Buffer.concat(chunks).toString("utf8");
      const entry = { t: vnow(), method: req.method, path: p, headers: { "content-type": req.headers["content-type"] || "", "x-aicc-request": req.headers["x-aicc-request"] || "", origin: req.headers.origin || "", cookie: req.headers.cookie || "" }, raw, bytes: size };
      log.push(entry);
      if (p.endsWith("/status") && req.method === "GET") {
        if (cfg.statusDelayMs) await new Promise((r) => setTimeout(r, cfg.statusDelayMs));
        if (cfg.status === "drop") return req.socket.destroy();
        if (cfg.status === "429") return json(res, 429, { open: false }, { "Retry-After": "30" });
        if (cfg.status === "http500") return json(res, 500, { open: true, turnstile_site_key: "k", form_token: "t" });
        if (cfg.status === "badjson") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{not json"); }
        if (cfg.status === "closed") return json(res, 200, { open: false, turnstile_site_key: null, form_token: null });
        if (cfg.status === "missingkey") return json(res, 200, { open: true, turnstile_site_key: null, form_token: "ft.x" });
        return json(res, 200, { open: true, turnstile_site_key: "1x00000000000000000000AA", form_token: `ft.${vnow()}.${++seq}` });
      }
      if (p.endsWith("/status")) return json(res, 405, { status: "method" });
      const isConfirm = p.endsWith("/confirm");
      if (req.method !== "POST") return json(res, 405, { status: "method" });
      // common checks (contract: content type 415, header, origin 403, size 413, JSON shape 400)
      if (!/^application\/json/i.test(req.headers["content-type"] || "")) return json(res, 415, { status: "unsupported" });
      if (req.headers["x-aicc-request"] !== "1") return json(res, 403, { status: "forbidden" });
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { status: "forbidden" });
      if (size > 2048) return json(res, 413, { status: "too_large" });
      let body; try { body = JSON.parse(raw); } catch { return json(res, 400, { status: "invalid_request" }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { status: "invalid_request" });
      if (isConfirm) {
        if (cfg.confirm === "drop") return req.socket.destroy();
        if (cfg.confirm === "503") return json(res, 503, { status: "unavailable" });
        if (cfg.confirm === "throttle") return json(res, 429, { status: "rate_limited" }, { "Retry-After": "60" });
        const t = body.token;
        if (typeof t !== "string" || t.length > 64 || !/^[A-Za-z0-9_-]{16,64}$/.test(t) || usedTokens.has(t) || t.startsWith("expired")) return json(res, 400, { status: "invalid_or_expired" });
        usedTokens.add(t);
        return json(res, 200, { status: "verified" });
      }
      // create
      if (cfg.create === "drop") return req.socket.destroy();
      const keys = Object.keys(body);
      if (keys.length !== KEYS.length || keys.some((k) => !KEYS.includes(k))) return json(res, 400, { status: "invalid_request" });
      if (cfg.create === "503" || cfg.status === "closed") return json(res, 503, { status: "closed" });
      // the form token: signed in the real thing; here `ft.<issued ms>.<n>`. Valid from 3 s to 2 h after it was issued (contract), else 400 invalid_request
      const ftm = typeof body.form_token === "string" ? /^ft\.(\d+)\.\d+$/.exec(body.form_token) : null;
      if (!ftm) return json(res, 400, { status: "invalid_request" });
      const age = vnow() - Number(ftm[1]);
      if (age < 3000 || age > 2 * 3600 * 1000) return json(res, 400, { status: "invalid_request" });
      if (cfg.create === "400invalid") return json(res, 400, { status: "invalid_request" });
      if (cfg.create === "400bot" || body.turnstile_token === "FAIL") return json(res, 400, { status: "verification_failed" });
      // a Turnstile token is single use: a second request with the same token fails the bot check
      if (usedTurnstile.has(body.turnstile_token)) return json(res, 400, { status: "verification_failed" });
      usedTurnstile.add(body.turnstile_token);
      if (cfg.create === "429") return json(res, 429, { status: "rate_limited" }, { "Retry-After": "120" });
      // below the line everything answers the SAME neutral 202 (valid or not, duplicate or not)
      return json(res, 202, { status: "received" });
    }
    // static export
    let f = path.join(root, decodeURIComponent(p));
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    for (const c of [f, path.join(f, "index.html"), `${f}.html`]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        res.writeHead(200, { "Content-Type": TYPES[path.extname(c)] || "application/octet-stream", "Cache-Control": "no-store" });
        return fs.createReadStream(c).pipe(res);
      }
    }
    const nf = path.join(root, "404.html");
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : "Not found");
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address();
  origin = `http://127.0.0.1:${addr.port}`;
  return {
    url: origin,
    log,
    set: (patch) => { cfg = { ...cfg, ...patch }; },
    reset: () => { cfg = { ...DEFAULTS }; log.length = 0; usedTokens.clear(); usedTurnstile.clear(); offset = 0; seq = 0; },
    advance: (ms) => { offset += ms; },
    now: vnow,
    calls: (suffix, method) => log.filter((e) => e.path.endsWith(suffix) && (!method || e.method === method)),
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

/** The fake Turnstile api.js a test serves for https://challenges.cloudflare.com/turnstile/v0/api.js (the real one is never loaded). `fail` makes the widget report an error. */
export function fakeTurnstileScript({ fail = false } = {}) {
  return `window.turnstile={_n:0,render:function(el,o){var id="ts"+(++this._n);el.setAttribute("data-fake-turnstile",id);el.setAttribute("data-fake-action",o.action||"");el.setAttribute("data-fake-sitekey",o.sitekey||"");var b=document.createElement("button");b.type="button";b.textContent="Verify you are human";b.setAttribute("data-fake-ts-button","");b.style.minHeight="44px";b.onclick=function(){${fail ? "o['error-callback']()" : "window.__tsn=(window.__tsn||0)+1;o.callback('mock-turnstile-token-'+window.__tsn)"}};el.appendChild(b);var x=document.createElement("button");x.type="button";x.textContent="expire";x.setAttribute("data-fake-ts-expire","");x.onclick=function(){o["expired-callback"]()};el.appendChild(x);var e=document.createElement("button");e.type="button";e.textContent="error";e.setAttribute("data-fake-ts-error","");e.onclick=function(){o["error-callback"]()};el.appendChild(e);return id},reset:function(){},remove:function(){}};`;
}
