import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Die Vereinsschriften (#1228): fonts.css nennt nur Dateien, die unter public/fonts liegen, jede mit ihrer Prüfsumme
// im Namen (nginx hält Schriften ein Jahr lang unverändert vor), alle mit font-display: swap und ohne fremden Server.

const root = path.resolve(__dirname, "..");
const fontsDir = path.join(root, "public/fonts");
const css = readFileSync(path.join(root, "src/fonts.css"), "utf8").replace(/\r\n/g, "\n");
const html = readFileSync(path.join(root, "index.html"), "utf8");

const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
  const prop = (name) => (body.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1]?.trim() || "";
  return {
    family: prop("font-family").replace(/["']/g, ""),
    weight: prop("font-weight"),
    display: prop("font-display"),
    urls: [...body.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => match[1]),
  };
});

function fileOf(url) {
  return path.join(fontsDir, url.replace(/^\/fonts\//, ""));
}

test("jede Schrift kommt vom eigenen Server, mit swap, als WOFF2", () => {
  expect(faces.length).toBeGreaterThan(0);
  expect(css).not.toMatch(/https?:|\/\/fonts\.|googleapis|gstatic/);
  for (const face of faces) {
    expect(face.display, face.family).toBe("swap");
    expect(face.urls.length, face.family).toBe(1);
    expect(face.urls[0], face.family).toMatch(/^\/fonts\/[a-z0-9-]+\.woff2$/);
  }
});

test("fonts.css nennt nur Dateien, die es unter public/fonts gibt - mit passender Prüfsumme im Namen", () => {
  for (const face of faces) {
    const file = fileOf(face.urls[0]);
    expect(existsSync(file), `${face.urls[0]} fehlt in public/fonts`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
    expect(path.basename(file), "Datei geändert, Name nicht - scripts/build_web_fonts.py neu laufen lassen").toMatch(new RegExp(`-${digest}\\.woff2$`));
  }
  // Keine Leichen: jede Datei im Ordner wird auch benutzt.
  const named = new Set(faces.map((face) => path.basename(face.urls[0])));
  for (const name of readdirSync(fontsDir).filter((entry) => entry.endsWith(".woff2"))) {
    expect(named.has(name), `${name} liegt in public/fonts, steht aber nicht in fonts.css`).toBe(true);
  }
});

test("nur die gewählten Schnitte: Unbounded 700/800, Outfit 400 bis 800, Rajdhani 600/700", () => {
  const cuts = {};
  for (const face of faces) (cuts[face.family] ||= []).push(face.weight);
  expect(cuts).toEqual({ Outfit: ["400 800"], Unbounded: ["700", "800"], Rajdhani: ["600", "700"] });
});

test("jede Schrift hat ihre Lizenz daneben", () => {
  for (const family of ["Outfit", "Unbounded", "Rajdhani"]) {
    const license = path.join(fontsDir, `OFL-${family}.txt`);
    expect(existsSync(license), family).toBe(true);
    expect(readFileSync(license, "utf8")).toContain("SIL Open Font License");
  }
});

test("index.html lädt die wichtigsten Dateien vorab, index.jsx bindet fonts.css ein", () => {
  const preloads = [...html.matchAll(/<link rel="preload"[^>]*>/g)].map(([tag]) => tag).filter((tag) => tag.includes('as="font"'));
  expect(preloads.length).toBeGreaterThanOrEqual(1);
  expect(preloads.length).toBeLessThanOrEqual(2);
  const declared = new Set(faces.map((face) => face.urls[0]));
  for (const tag of preloads) {
    const href = (tag.match(/href="([^"]+)"/) || [])[1];
    expect(declared.has(href), `${href} steht nicht in fonts.css`).toBe(true);
    expect(tag).toContain('type="font/woff2"');
    // Ohne crossorigin lädt der Browser die Schrift ein zweites Mal.
    expect(tag).toContain("crossorigin");
  }
  expect(readFileSync(path.join(root, "src/index.jsx"), "utf8")).toMatch(/import "@\/fonts\.css";/);
});
