#!/usr/bin/env node
/*
 * Erfolge II (E13, #623): die Abzeichen-Kunst wird einmal gepflegt - im Web
 * (frontend/src/components/achievements: Motive, Verwandte, Material-Looks). Dieses Skript macht
 * daraus Daten für die App:
 *
 *   npm run sync:badge-art                  schreibt src/achievements/badgeArt.generated.ts
 *   node scripts/sync-badge-art.js --check  Exit 1, wenn die Datei nicht mehr zum Web passt
 *
 * Ein Jest-Test (src/achievements/badgeArt.test.ts) prüft dasselbe, damit ein neues Motiv im Web
 * nicht unbemerkt in der App fehlt.
 */
const fs = require("fs");
const path = require("path");

const WEB = path.resolve(__dirname, "../../frontend/src/components/achievements");
const OUT = path.resolve(__dirname, "../src/achievements/badgeArt.generated.ts");
const FILES = ["play", "racing", "people", "club"];
const TAGS = new Set(["path", "circle", "rect", "ellipse"]);

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

/** Wie read, aber "" wenn es die Datei noch nicht gibt - gleich gelesen statt vorher nachgesehen (#1408). */
function readIfPresent(file) {
  try {
    return read(file);
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

/** Die Elemente eines Fragments in Reihenfolge - Konstanten wie {LION_HEAD} werden eingesetzt. */
function parseFragment(fragment, constants, where) {
  const parts = [];
  const re = /\{([A-Z_]+)\}|<([a-zA-Z]+)\s([^>]*?)\/>/g;
  let match;
  while ((match = re.exec(fragment))) {
    if (match[1]) {
      if (!constants[match[1]]) throw new Error(`${where}: unbekannte Konstante ${match[1]}`);
      parts.push(...constants[match[1]]);
      continue;
    }
    const [, , tag, raw] = match;
    if (!TAGS.has(tag)) throw new Error(`${where}: Element <${tag}> kennt die App nicht`);
    if (/=\{/.test(raw)) throw new Error(`${where}: Ausdruck statt Text in <${tag}>`);
    const attrs = {};
    const attrRe = /([a-zA-Z]+)="([^"]*)"/g;
    let attr;
    while ((attr = attrRe.exec(raw))) attrs[attr[1]] = attr[2];
    parts.push([tag, attrs]);
  }
  const rest = fragment.replace(re, "").trim();
  if (rest) throw new Error(`${where}: unbekannter Inhalt „${rest.slice(0, 40)}“`);
  return parts;
}

function parseMotifs() {
  const motifs = {};
  for (const name of FILES) {
    const text = read(path.join(WEB, "motifs", `${name}.jsx`));
    const constants = {};
    for (const m of text.matchAll(/^const ([A-Z_]+) = \(\s*<>([\s\S]*?)<\/>\s*\);/gm)) {
      constants[m[1]] = parseFragment(m[2], constants, `${name}.jsx ${m[1]}`);
    }
    const entries = [...text.matchAll(/^ {2}(?:"([^"]+)"|([A-Za-z][\w-]*)): \(\s*<>([\s\S]*?)<\/>\s*\),?$/gm)];
    if (!entries.length) throw new Error(`${name}.jsx: keine Motive gefunden`);
    for (const m of entries) {
      const key = m[1] || m[2];
      if (motifs[key]) throw new Error(`${name}.jsx: Motiv „${key}“ doppelt`);
      motifs[key] = parseFragment(m[3], constants, `${name}.jsx ${key}`);
    }
  }
  return motifs;
}

function parseAliases() {
  const text = read(path.join(WEB, "badgeArt.jsx"));
  const block = text.split("export const ALIASES", 2)[1].split("});", 1)[0];
  const aliases = {};
  for (const m of block.matchAll(/(?:"([^"]*)"|([A-Za-z][\w-]*)):\s*"([^"]+)"/g)) {
    aliases[m[1] !== undefined ? m[1] : m[2]] = m[3];
  }
  return aliases;
}

function parseMaterials() {
  const text = read(path.join(WEB, "materials.js"));
  const start = text.indexOf("export const MATERIAL_LOOKS = {");
  const end = text.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error("materials.js: MATERIAL_LOOKS nicht gefunden");
  const literal = text.slice(start + "export const MATERIAL_LOOKS = ".length, end + 2);
  // Reine Daten (Text und Zahlen) aus dem eigenen Repo.
  return Function(`"use strict"; return (${literal});`)();
}

function build() {
  const motifs = parseMotifs();
  const aliases = parseAliases();
  const materials = parseMaterials();
  for (const [from, to] of Object.entries(aliases)) {
    if (!motifs[to]) throw new Error(`badgeArt.jsx: Verwandter „${from}“ zeigt auf das fehlende Motiv „${to}“`);
  }
  const lines = [
    "// Erzeugt von scripts/sync-badge-art.js aus frontend/src/components/achievements – nicht von Hand ändern.",
    "// Erfolge II (E13, #623): dieselben Motive, Verwandten und Material-Looks wie im Web.",
    "",
    'export type MotifTag = "path" | "circle" | "rect" | "ellipse";',
    "export type MotifPart = [MotifTag, Record<string, string>];",
    "export type MaterialLook = {",
    "  name: string; rank: number; base: string; light: string; dark: string; rim: string; ink: string; glow: string;",
    "  accent?: string; texture: string; motion: string;",
    "};",
    "",
    "export const MOTIFS: Record<string, MotifPart[]> = {",
    ...Object.entries(motifs).map(([key, parts]) => `  ${JSON.stringify(key)}: ${JSON.stringify(parts)},`),
    "};",
    "",
    "export const ALIASES: Record<string, string> = {",
    ...Object.entries(aliases).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
    "};",
    "",
    "export const MATERIAL_LOOKS: Record<string, MaterialLook> = {",
    ...Object.entries(materials).map(([key, look]) => `  ${JSON.stringify(key)}: ${JSON.stringify(look)},`),
    "};",
    "",
  ];
  return lines.join("\n");
}

module.exports = { build, OUT };

if (require.main === module) {
  const next = build();
  const current = readIfPresent(OUT);
  if (process.argv.includes("--check")) {
    if (current !== next) {
      console.error("badgeArt.generated.ts passt nicht mehr zum Web – bitte `npm run sync:badge-art` ausführen.");
      process.exit(1);
    }
    console.log("Abzeichen-Kunst der App ist aktuell.");
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, next, "utf8");
    console.log(`geschrieben: ${path.relative(process.cwd(), OUT)}`);
  }
}
