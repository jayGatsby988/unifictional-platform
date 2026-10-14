// Local dev server for the Website Studio, the same shape as Vercel serves it:
// public/ as static files with clean URLs (/studio → studio.html) and every
// api/<name>.js as a function at /api/<name> (plain Node req/res handlers).
// The API needs ANTHROPIC_API_KEY in the environment (or in .env.local, which
// this file reads if present); without it the API answers {mode:"local"}.
//
//   npm run dev            → http://localhost:3300
//   PORT=4000 npm run dev  → another port
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const port = Number(process.env.PORT || 3300);

// .env.local, without overriding anything already set
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

async function serveStatic(req, res, pathname) {
  const clean = decodeURIComponent(pathname).replace(/\/+$/, "") || "/index";
  const candidates = [path.join(pub, clean), path.join(pub, clean + ".html"), path.join(pub, clean, "index.html")];
  for (const file of candidates) {
    if (!file.startsWith(pub)) break; // no escaping public/
    try {
      if (!(await stat(file)).isFile()) continue;
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      return res.end(await readFile(file));
    } catch { /* next candidate */ }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const api = pathname.match(/^\/api\/([a-z0-9-]+)\/?$/i);
  if (api) {
    const file = path.join(root, "api", `${api[1]}.js`);
    if (!existsSync(file)) { res.writeHead(404); return res.end("no such function"); }
    try {
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    } catch (e) {
      console.error(`[api/${api[1]}]`, e);
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: String(e?.message || e) })); }
      return;
    }
  }
  return serveStatic(req, res, pathname);
}).listen(port, () => console.log(`Website Studio on http://localhost:${port} (studio at /studio)`));
