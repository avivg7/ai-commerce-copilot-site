// Minimal static server for the exported site (out/). Not part of the product; used for local verification.
//   node scripts/serve-out.mjs [--port 3011] [--prefix /ai-commerce-copilot-site] [--dir out]
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
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".ico": "image/x-icon", ".map": "application/json",
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
    const file = resolve(req.url);
    if (file) {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    } else {
      const nf = path.join(root, "404.html");
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : "Not found");
    }
  })
  .listen(port, () => console.log(`serving ${root} on http://localhost:${port}${prefix || ""}/`));
