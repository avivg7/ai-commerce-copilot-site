// Minimal static server for the exported site (out/). Not part of the product; used for local verification.
//   node scripts/serve-out.mjs [--port 3011] [--prefix /ai-commerce-copilot-site] [--dir out] [--stats]
// --stats additionally records every response (url, Range header, status, bytes actually written to the socket) and serves them as JSON at /__stats
// (and clears them at /__stats/reset); used by `npm run test:demo` to measure how much of the 44 MB demo video is transferred before play. Off by default.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", arg("dir", "out"));
const port = Number(arg("port", "3011"));
const prefix = arg("prefix", "").replace(/\/$/, "");
const STATS = args.includes("--stats");
const LOG = [];
/** Records one response: bytes are counted as the socket takes them (a browser that stops reading applies backpressure, so an abandoned stream counts only what was accepted). */
function track(req, res, status, bodyStream, length) {
  if (!STATS) return;
  const e = { url: req.url.split("?")[0], method: req.method, range: req.headers.range || null, status, length, sent: 0, closed: false };
  LOG.push(e);
  if (bodyStream) bodyStream.on("data", (c) => { e.sent += c.length; });
  res.on("close", () => { e.closed = true; });
}
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".ico": "image/x-icon", ".map": "application/json", ".mp4": "video/mp4", ".vtt": "text/vtt; charset=utf-8",
};

function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (prefix) {
    if (!p.startsWith(prefix)) return null;
    p = p.slice(prefix.length) || "/";
  }
  const full = path.join(root, p);
  if (!full.startsWith(root)) return null;
  const tryFiles = [full, path.join(full, "index.html"), `${full}.html`];
  for (const f of tryFiles) if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  return null;
}

http
  .createServer((req, res) => {
    if (STATS && req.url.startsWith("/__stats")) {
      if (req.url.startsWith("/__stats/reset")) LOG.length = 0;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(LOG));
    }
    const file = resolve(req.url);
    if (file) {
      const type = TYPES[path.extname(file)] || "application/octet-stream";
      const size = fs.statSync(file).size;
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (m && (m[1] || m[2])) {
        // Byte ranges, as a real static host serves them (the demo video needs them for seeking).
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1, "Cache-Control": "no-store" });
        const rs = fs.createReadStream(file, { start, end });
        track(req, res, 206, rs, end - start + 1);
        res.on("close", () => rs.destroy());
        return rs.pipe(res);
      }
      res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size, "Cache-Control": "no-store" });
      const rs = fs.createReadStream(file);
      track(req, res, 200, rs, size);
      res.on("close", () => rs.destroy());
      rs.pipe(res);
    } else {
      const nf = path.join(root, "404.html");
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : "Not found");
    }
  })
  .listen(port, () => console.log(`serving ${root} on http://localhost:${port}${prefix || ""}/`));
