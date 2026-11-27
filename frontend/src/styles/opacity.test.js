import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Deckkraft nur aus der Skala (#2598): Tailwind baut `bg-white/12` oder `text-white/42` nicht, weil 12 und 42 nicht in
// seiner Deckkraft-Skala stehen (0, 5, 10 … 95, 100). Die Klasse wirkt dann einfach nicht - eine Fläche bleibt
// durchsichtig, ein Text voll hell. Gemeinte Werte stehen als `/[0.12]` da, sonst gilt ein Wert der Skala.
// Der Wächter liest alle Quelldateien (ohne Tests) und in CSS die @apply-Zeilen.

const require = createRequire(import.meta.url);
const resolveConfig = require("tailwindcss/resolveConfig");
const config = resolveConfig(require("../../tailwind.config.js"));
const SCALE = new Set(Object.keys(config.theme.opacity).map(Number));

const SRC = path.resolve(__dirname, "..");
const UTILITY = "(?:bg|text|border(?:-[trblxyse])?|from|via|to|ring|ring-offset|outline|divide|placeholder|fill|stroke|shadow|decoration|accent|caret)";
// Farbe mit Deckkraft: `hover:bg-[#FFD700]/12`, `border-t-white/8`, `text-honor/42`.
const COLOR_ALPHA = new RegExp(`(?<![\\w-])((?:[\\w-]+(?:\\[[^\\]\\s]*\\])?:)*!?${UTILITY}-(\\[[^\\]\\s]+\\]|[a-z]+(?:-[a-z0-9]+)*))\\/(\\d+)(?![\\w.\\]])`, "g");
// Eigene Deckkraft-Klassen: `opacity-32`, `bg-opacity-12`.
const OPACITY = /(?<![\w-])((?:[\w-]+(?:\[[^\]\s]*\])?:)*!?(?:bg-|text-|border-|ring-|divide-|placeholder-)?opacity)-(\d+)(?![\w.\]])/g;
// Schriftgröße mit Zeilenhöhe (`text-sm/6`) ist keine Deckkraft.
const TEXT_SIZE = /^(xs|sm|base|lg|xl|[2-9]xl)$/;

/** Alle Deckkraft-Werte außerhalb der Skala in einem Text, als „Klasse“. */
export function offScale(text) {
  const found = [];
  for (const match of text.matchAll(COLOR_ALPHA)) {
    if (match[1].includes("text-") && TEXT_SIZE.test(match[2])) continue;
    if (!SCALE.has(Number(match[3]))) found.push(match[0]);
  }
  for (const match of text.matchAll(OPACITY)) if (!SCALE.has(Number(match[2]))) found.push(match[0]);
  return found;
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(jsx?|tsx?|css)$/.test(name) && !/\.(test|spec)\.[jt]sx?$/.test(name) ? [full] : [];
  });
}

test("die Skala kommt aus der Tailwind-Einstellung (0 bis 100 in Fünferschritten)", () => {
  expect([...SCALE].sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, index) => index * 5));
});

test("Gegenprobe: Werte außerhalb der Skala schlagen an, Skala, [0.xx] und Zeilenhöhe nicht", () => {
  expect(offScale('className="border border-white/8 bg-[#29B6E8]/12 hover:text-white/42 opacity-32"'))
    .toEqual(["border-white/8", "bg-[#29B6E8]/12", "hover:text-white/42", "opacity-32"]);
  expect(offScale("from-[#FFD700]/12 via-[#0A0A0A]/78 border-t-white/44 md:bg-honor/96")).toEqual(["from-[#FFD700]/12", "via-[#0A0A0A]/78", "border-t-white/44", "md:bg-honor/96"]);
  expect(offScale('className="border-white/10 bg-[#0A0A0A]/[0.96] text-white/45 opacity-30 bg-live/15 text-sm/6 w-1/2 aspect-[16/8]"')).toEqual([]);
});

test("keine Deckkraft außerhalb der Tailwind-Skala in src/ - sonst wirkt die Klasse nicht", () => {
  const problems = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      // In CSS zählen nur @apply-Zeilen; Attribut-Wähler wie [class*="text-white/38"] sind keine Klassen.
      if (rel.endsWith(".css") && !/@apply\b/.test(line)) return;
      for (const hit of offScale(line)) problems.push(`${rel}:${index + 1} ${hit} - als /[0.xx] oder mit einem Wert der Skala schreiben`);
    });
  }
  expect(problems).toEqual([]);
}, 30_000);
