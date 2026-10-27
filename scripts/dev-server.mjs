// Local preview without the Netlify CLI: serves public/ and the API, storing data in ./.data
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

process.env.LOCAL_DATA_DIR ||= path.resolve(".data");
const { default: api } = await import("../netlify/functions/api.mjs");
const PORT = Number(process.env.PORT) || 8888;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await api(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  let file = path.join("public", path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
  try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, "index.html"); } catch { file = "public/index.html"; }
  try {
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end("Not found"); }
}).listen(PORT, () => console.log(`Al-Iman school app running at http://localhost:${PORT}`));
