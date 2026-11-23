#!/usr/bin/env node
// Das gebaute dist für das Prüftor (#1660) ausliefern - so, wie nginx es im Betrieb tut.
//
// Gzip für Text (nginx.conf: gzip on, Stufe 6), Seiten ohne Datei fallen auf index.html zurück (Single-Page-App),
// /api/... beantwortet der Server nicht: Die Browser-Tests stellen die API selbst nach (page.route). Kein Cache,
// damit jeder Lauf der Ladezeit-Messung kalt beginnt.
//
//   node scripts/serve-dist.mjs [port]        Vorgabe 4173, Ordner dist neben diesem Skript

import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".txt", ".xml"]);

/** Datei zu einer Adresse: nur innerhalb von dist, sonst (und ohne Datei) index.html. */
export function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return path.join(root, "index.html");
  }
  const candidate = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  const inside = candidate === root || candidate.startsWith(`${root}${path.sep}`);
  if (inside && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return path.join(root, "index.html");
}

export function createServer(root = ROOT) {
  return http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"detail":"Prüftor: API ist im Test nachgestellt"}');
      return;
    }
    // Kein Service Worker im Tor (die Tests sperren ihn ohnehin): Auf 127.0.0.1 holt die App service-worker.js nur per
    // fetch, liest den Körper nie - Chromium meldet die Anfrage dann nie als fertig und „networkidle“ käme nie.
    // Leer und 404: fertig ohne Körper, und serviceWorkerRegistration.js meldet sich nicht an.
    if (req.url.split("?")[0] === "/service-worker.js") {
      res.writeHead(404, { "Content-Length": 0, "Cache-Control": "no-store" });
      res.end();
      return;
    }
    const file = resolveFile(root, req.url);
    const ext = path.extname(file).toLowerCase();
    const headers = { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" };
    const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
    // Ganz gepackt und mit Länge, wie eine fertige Datei hinter nginx.
    const raw = readFileSync(file);
    const body = gzip ? gzipSync(raw, { level: 6 }) : raw;
    if (gzip) {
      headers["Content-Encoding"] = "gzip";
      headers.Vary = "Accept-Encoding";
    }
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(path.join(ROOT, "index.html"))) {
    console.error(`serve-dist: ${ROOT}${path.sep}index.html fehlt. Erst "yarn build" ausführen.`);
    process.exit(1);
  }
  const port = Number(process.argv[2] || process.env.PORT || 4173);
  createServer().listen(port, "127.0.0.1", () => console.log(`dist auf http://127.0.0.1:${port}`));
}
