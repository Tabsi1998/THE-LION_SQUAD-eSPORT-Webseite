#!/usr/bin/env node
// Bewegungsregeln als Prüfung (#1660, Entscheidung 15.10.2026): Bewegt wird über transform und opacity, „Bewegung
// reduzieren“ wird beachtet, Dauern und Kurven kommen aus den Tokens (index.css --tls-motion-*, --tls-ease*,
// lib/motion.js MOTION/EASE_MOVE/MICRO, Tailwind duration-fast|mid|slow und ease-tls).
//
// Statisch, ohne Browser: liest alle CSS-, JS- und JSX-Dateien unter src (ohne Tests) und zählt je Datei und Regel.
// Bestehende Verstöße stehen mit Begründung in motion-rules-allowlist.json - das Tor schlägt nur an, wenn eine Datei
// mehr Verstöße einer Regel hat, als dort erlaubt sind. Weniger ist immer gut (--tighten senkt die Zahlen).
//
// Regeln (Ids wie in der Ausnahmeliste):
//   layout-property  Übergang oder Keyframes auf Breite, Höhe, Lage, Abstand, Schriftgröße …; auch `all`
//                    (transition: all, transition-all, Kurzform ohne Eigenschaft), framer-motion animate={{ height }}.
//   reduced-motion   CSS-Animation mit fester Dauer ohne Gegenstück in einem prefers-reduced-motion-Block der Datei
//                    (oder global in index.css); Tailwind animate-* ohne motion-safe:/motion-reduce:; framer-motion
//                    repeat: Infinity und element.animate() in Dateien, die „Bewegung reduzieren“ nirgends abfragen.
//   token-duration   feste Dauer statt Token: 300ms in CSS, duration-300 in Tailwind, duration: 0.3 in framer-motion.
//   token-easing     feste Kurve statt Token: ease-in-out, cubic-bezier(…) in CSS, ease-out in Tailwind,
//                    ease: "easeOut" / [0.4, 0, 0.2, 1] in framer-motion. `linear` und steps() sind erlaubt (gleichmäßige
//                    Läufe wie Spinner haben keine Kurve).
// Farb-, Schatten- und Filter-Übergänge zählen nicht als Layout - die zeichnen nur neu.
//
//   node scripts/check-motion-rules.mjs                         prüfen (Exit 1 bei neuen Verstößen)
//   node scripts/check-motion-rules.mjs --report out.json       zusätzlich Ergebnis als JSON (Prüftor)
//   node scripts/check-motion-rules.mjs --base-allowlist a.json meldet, wenn die Ausnahmeliste gegenüber a.json wächst
//   node scripts/check-motion-rules.mjs --diff-base origin/main  Funde auf geänderten Zeilen markieren und zuerst nennen
//   node scripts/check-motion-rules.mjs --tighten               Ausnahmeliste auf den Ist-Stand senken (nie erhöhen)

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOWLIST_FILE = path.join(FRONTEND, "motion-rules-allowlist.json");

export const RULES = {
  "layout-property": "Layout-Eigenschaft animiert (nur transform und opacity)",
  "reduced-motion": "„Bewegung reduzieren“ nicht beachtet",
  "token-duration": "Dauer nicht aus den Tokens",
  "token-easing": "Kurve nicht aus den Tokens",
};

// Eigenschaften, deren Änderung das Layout neu berechnet. Kurz- und Langformen; JS in camelCase (unten umgerechnet).
const LAYOUT_PROPS = new Set([
  "all", "width", "height", "min-width", "min-height", "max-width", "max-height", "inline-size", "block-size",
  "top", "right", "bottom", "left", "inset", "inset-inline", "inset-block",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "margin-inline", "margin-block",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "padding-inline", "padding-block",
  "border-width", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "font-size", "line-height", "letter-spacing", "gap", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "flex", "flex-basis", "flex-grow", "flex-shrink",
]);
const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const LAYOUT_KEYS_JS = new Set([...LAYOUT_PROPS].filter((name) => name !== "all").map(camel));

const TIME = /(?<![\w.#-])(\d*\.?\d+)(ms|s)(?![\w-])/g;
const EASING_KEYWORDS = new Set(["ease", "ease-in", "ease-out", "ease-in-out"]);
const TIMING_WORDS = new Set([...EASING_KEYWORDS, "linear", "step-start", "step-end", "infinite", "alternate",
  "alternate-reverse", "normal", "reverse", "forwards", "backwards", "both", "running", "paused", "allow-discrete"]);
// Wer eines davon nennt, fragt „Bewegung reduzieren“ ab (Hook, Helfer, MotionConfig, Media-Query, Tailwind-Variante).
const REDUCED_REFERENCE = /prefers-reduced-motion|useReducedMotion|motionAllowed|reducedMotion|MotionConfig|motion-reduce|motion-safe/;
// Tailwind-Animationen, die ohne Bewegung auskommen müssen dürfen: der Lade-Spinner ist Rückmeldung, keine Zier.
const TAILWIND_ANIMATE_OK = new Set(["animate-none", "animate-spin"]);

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

/** Kommentare entfernen, Zeilen behalten (für Zeilennummern). */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** var(...) samt Inhalt entfernen - auch verschachtelt (var(--a, var(--b))). */
function withoutVars(value) {
  let out = value;
  for (;;) {
    const start = out.indexOf("var(");
    if (start < 0) return out;
    let depth = 0;
    let end = start + 3;
    for (; end < out.length; end += 1) {
      if (out[end] === "(") depth += 1;
      else if (out[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out = `${out.slice(0, start)} ${out.slice(end + 1)}`;
  }
}

/** Auf oberster Ebene an Kommas trennen (nicht in Klammern). */
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const hasLiteralTime = (value) => [...withoutVars(value).matchAll(TIME)].some((match) => Number(match[1]) > 0);

function literalEasing(value) {
  const plain = withoutVars(value);
  if (/cubic-bezier\(/i.test(plain)) return true;
  return plain.split(/[\s,()]+/).some((word) => EASING_KEYWORDS.has(word.toLowerCase()));
}

/** Eigenschaften eines transition-Werts; ohne genannte Eigenschaft gilt `all`. */
export function transitionProperties(value) {
  const props = [];
  for (const item of splitTopLevel(value)) {
    if (/^var\(/.test(item)) continue;
    const words = withoutVars(item).replace(/cubic-bezier\([^)]*\)|steps\([^)]*\)/g, " ").split(/\s+/).filter(Boolean);
    const prop = words.find((word) => !TIMING_WORDS.has(word.toLowerCase()) && !/^-?\d*\.?\d+(ms|s)?$/.test(word));
    if (item.trim().toLowerCase() === "none") continue;
    props.push((prop || "all").toLowerCase());
  }
  return props;
}

/** Deklarationen einer CSS-Datei mit ihrem Umfeld (Selektor, @media, @keyframes). */
export function cssDeclarations(css) {
  const text = stripCssComments(css);
  const declarations = [];
  const stack = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") {
      stack.push(text.slice(start, index).trim().replace(/\s+/g, " "));
      start = index + 1;
    } else if (char === ";" || char === "}") {
      const chunk = text.slice(start, index);
      const colon = chunk.indexOf(":");
      if (colon > 0 && stack.length) {
        const prop = chunk.slice(0, colon).trim().toLowerCase();
        if (/^-?[a-z-]+$/.test(prop)) {
          const offset = start + chunk.length - chunk.trimStart().length;
          declarations.push({ prop, value: chunk.slice(colon + 1).trim(), line: lineAt(text, offset), context: [...stack] });
        }
      }
      if (char === "}") stack.pop();
      start = index + 1;
    }
  }
  return declarations;
}

const isReduceMedia = (prelude) => /^@media\b.*prefers-reduced-motion\s*:\s*reduce/i.test(prelude);
const isNoPreferenceMedia = (prelude) => /^@media\b.*prefers-reduced-motion\s*:\s*no-preference/i.test(prelude);
const isKeyframes = (prelude) => /^@(-webkit-)?keyframes\b/i.test(prelude);
const selectorOf = (context) => [...context].reverse().find((prelude) => !prelude.startsWith("@")) || "";
const splitSelectors = (selector) => splitTopLevel(selector).map((part) => part.replace(/\s+/g, " ").trim());

/** Selektoren, die ein prefers-reduced-motion: reduce-Block der Datei nennt. */
export function reducedSelectors(css) {
  const selectors = new Set();
  for (const declaration of cssDeclarations(css)) {
    if (declaration.context.some(isReduceMedia)) for (const selector of splitSelectors(selectorOf(declaration.context))) selectors.add(selector);
  }
  return selectors;
}

const MOTION_PROPS = new Set(["transition", "transition-duration", "animation", "animation-duration",
  "-webkit-transition", "-webkit-animation"]);
const EASING_PROPS = new Set([...MOTION_PROPS, "transition-timing-function", "animation-timing-function"]);

/** Verstöße einer CSS-Datei: [{ rule, line, detail }]. `globalReduced`: Selektoren aus index.css. */
export function scanCss(css, { globalReduced = new Set() } = {}) {
  const findings = [];
  const fileReduced = reducedSelectors(css);
  const keyframesHit = new Set();
  for (const declaration of cssDeclarations(css)) {
    const { prop, value, line, context } = declaration;
    if (prop.startsWith("--")) continue;
    if (context.some(isReduceMedia)) continue;
    const keyframes = context.find(isKeyframes);
    if (keyframes) {
      if (LAYOUT_PROPS.has(prop) && !keyframesHit.has(keyframes)) {
        keyframesHit.add(keyframes);
        findings.push({ rule: "layout-property", line, detail: `${keyframes} ändert ${prop}` });
      }
      continue;
    }
    if (prop === "transition" || prop === "transition-property" || prop === "-webkit-transition") {
      const layout = transitionProperties(value).filter((name) => LAYOUT_PROPS.has(name));
      if (layout.length) findings.push({ rule: "layout-property", line, detail: `${prop}: ${value}` });
    }
    if (MOTION_PROPS.has(prop) && hasLiteralTime(value)) findings.push({ rule: "token-duration", line, detail: `${prop}: ${value}` });
    if (EASING_PROPS.has(prop) && literalEasing(value)) findings.push({ rule: "token-easing", line, detail: `${prop}: ${value}` });
    const animates = (prop === "animation" || prop === "animation-name" || prop === "-webkit-animation")
      && !/^(none|initial|inherit|unset)$/i.test(value.replace(/!important/i, "").trim());
    if (animates && !context.some(isNoPreferenceMedia)) {
      // Mit Token-Dauer stellt der zentrale Block in index.css die Bewegung ab; feste Dauern brauchen ein Gegenstück.
      const duration = prop === "animation-name" ? "" : value;
      const tokenOnly = prop !== "animation-name" && !hasLiteralTime(duration) && /var\(--tls-/.test(duration);
      const selectors = splitSelectors(selectorOf(context));
      const neutralized = selectors.some((selector) => fileReduced.has(selector) || globalReduced.has(selector));
      if (!tokenOnly && !neutralized) findings.push({ rule: "reduced-motion", line, detail: `${selectorOf(context)} { ${prop}: ${value} }` });
    }
  }
  return findings;
}

/** Balancierter Inhalt ab der öffnenden Klammer bei `open`. */
function balanced(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return text.slice(open);
}

const tailwindUtility = (token) => {
  const parts = token.split(":");
  return { utility: parts[parts.length - 1].replace(/^!/, ""), variants: parts.slice(0, -1) };
};

/** Verstöße einer JS/JSX-Datei. `globalReduced`: Klassen, die index.css bei „Bewegung reduzieren“ abstellt. */
export function scanJs(source, { globalReduced = new Set() } = {}) {
  const findings = [];
  const handlesReduced = REDUCED_REFERENCE.test(source);
  const framer = /from\s+["']framer-motion["']/.test(source);
  const lines = source.split("\n");

  // Tailwind-Klassen: Wörter zwischen Leerraum und Anführungszeichen.
  lines.forEach((text, index) => {
    const line = index + 1;
    for (const token of text.split(/[\s"'`{}()<>,;]+/)) {
      if (!token) continue;
      const { utility, variants } = tailwindUtility(token);
      if (utility === "transition-all") findings.push({ rule: "layout-property", line, detail: token });
      else if (utility.startsWith("transition-[")) {
        const props = utility.slice("transition-[".length, -1).split(",").map((prop) => prop.trim().toLowerCase());
        if (props.some((prop) => LAYOUT_PROPS.has(prop))) findings.push({ rule: "layout-property", line, detail: token });
      } else if (/^duration-\d+$/.test(utility) && utility !== "duration-0") findings.push({ rule: "token-duration", line, detail: token });
      else if (utility.startsWith("duration-[") && !utility.includes("var(")) findings.push({ rule: "token-duration", line, detail: token });
      else if (/^ease-(in|out|in-out)$/.test(utility) || utility.startsWith("ease-[")) findings.push({ rule: "token-easing", line, detail: token });
      else if (/^animate-[a-z][\w-]*$/.test(utility) && !TAILWIND_ANIMATE_OK.has(utility)) {
        const guarded = variants.includes("motion-safe") || variants.includes("motion-reduce") || text.includes("motion-reduce:")
          || globalReduced.has(`.${utility}`);
        if (!guarded) findings.push({ rule: "reduced-motion", line, detail: token });
      }
    }
  });

  // Inline-Stile: transition: "width 300ms ease" bzw. style.transition = "…".
  for (const match of source.matchAll(/\b(transition|animation)\s*[:=]\s*(["'`])([^"'`\n]*)\2/g)) {
    const [, prop, , value] = match;
    const line = lineAt(source, match.index);
    if (prop === "transition" && transitionProperties(value).some((name) => LAYOUT_PROPS.has(name))) {
      findings.push({ rule: "layout-property", line, detail: `${prop}: "${value}"` });
    }
    if (hasLiteralTime(value)) findings.push({ rule: "token-duration", line, detail: `${prop}: "${value}"` });
    if (literalEasing(value)) findings.push({ rule: "token-easing", line, detail: `${prop}: "${value}"` });
    if (prop === "animation" && value.trim() !== "none" && !handlesReduced) findings.push({ rule: "reduced-motion", line, detail: `${prop}: "${value}"` });
  }

  if (framer) {
    for (const match of source.matchAll(/\b(animate|initial|exit|whileHover|whileTap|whileInView|whileFocus|whileDrag)=\{\{/g)) {
      const body = balanced(source, match.index + match[0].length - 2);
      const keys = [...body.matchAll(/(?:^|[{,\s])([a-zA-Z]+)\s*:/g)].map((hit) => hit[1]).filter((key) => LAYOUT_KEYS_JS.has(key));
      if (keys.length) findings.push({ rule: "layout-property", line: lineAt(source, match.index), detail: `${match[1]} animiert ${[...new Set(keys)].join(", ")}` });
    }
    for (const match of source.matchAll(/\bduration\s*:\s*(\d*\.?\d+)/g)) {
      if (Number(match[1]) > 0) findings.push({ rule: "token-duration", line: lineAt(source, match.index), detail: match[0] });
    }
    // Fest ist ein Text ("easeOut") oder eine Zahlenreihe ([0.4, 0, 0.2, 1]) - [...MOTION.ease] ist der Token.
    for (const match of source.matchAll(/\bease\s*:\s*(["']([a-zA-Z]*)|\[\s*\d)/g)) {
      if (match[2] !== "linear") findings.push({ rule: "token-easing", line: lineAt(source, match.index), detail: match[0] });
    }
    if (!handlesReduced) {
      for (const match of source.matchAll(/\brepeat\s*:\s*Infinity\b/g)) {
        findings.push({ rule: "reduced-motion", line: lineAt(source, match.index), detail: "repeat: Infinity" });
      }
    }
  }
  if (!handlesReduced) {
    for (const match of source.matchAll(/\.animate\(\s*\[/g)) {
      findings.push({ rule: "reduced-motion", line: lineAt(source, match.index), detail: "element.animate()" });
    }
  }
  return findings;
}

/** Alle Quelldateien unter src (ohne Tests), Pfade relativ zu frontend mit „/“. */
export function sourceFiles(root = FRONTEND) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(css|js|jsx)$/.test(entry.name) && !/\.(test|spec)\.[jt]sx?$/.test(entry.name) && !entry.name.startsWith("setupTests")) {
        files.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(root, "src"));
  return files.sort();
}

/** Alle Funde je Datei: { "src/x.css": [{ rule, line, detail }] }. */
export function scanTree(root = FRONTEND) {
  const read = (file) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
  const indexCss = existsSync(path.join(root, "src/index.css")) ? read("src/index.css") : "";
  const globalReduced = reducedSelectors(indexCss);
  const result = {};
  for (const file of sourceFiles(root)) {
    const text = read(file);
    const findings = file.endsWith(".css") ? scanCss(text, { globalReduced }) : scanJs(text, { globalReduced });
    if (findings.length) result[file] = findings;
  }
  return result;
}

/** Zählung je Datei und Regel. */
export function countFindings(findingsByFile) {
  const counts = {};
  for (const [file, findings] of Object.entries(findingsByFile)) {
    for (const { rule } of findings) {
      counts[file] ??= {};
      counts[file][rule] = (counts[file][rule] || 0) + 1;
    }
  }
  return counts;
}

/** Ausnahmeliste prüfen: jede Zeile braucht eine bekannte Regel, eine Zahl über 0 und eine Begründung. */
export function allowlistProblems(allowlist) {
  const problems = [];
  for (const [file, rules] of Object.entries(allowlist.ausnahmen || {})) {
    for (const [rule, entry] of Object.entries(rules)) {
      if (!RULES[rule]) problems.push(`${file}: unbekannte Regel "${rule}"`);
      if (!Number.isInteger(entry.anzahl) || entry.anzahl < 1) problems.push(`${file} ${rule}: "anzahl" muss eine ganze Zahl über 0 sein`);
      if (typeof entry.grund !== "string" || entry.grund.trim().length < 20) problems.push(`${file} ${rule}: Begründung fehlt oder ist zu kurz`);
    }
  }
  return problems;
}

/**
 * Ist-Stand gegen Ausnahmeliste: neue Verstöße (über der erlaubten Zahl), Luft (weniger als erlaubt) und
 * Einträge ohne Datei. Bei neuen Verstößen stehen alle Funde der Datei für diese Regel da - welche neu ist,
 * weiß nur der Diff.
 */
export function compare(findingsByFile, allowlist) {
  const counts = countFindings(findingsByFile);
  const allowed = allowlist.ausnahmen || {};
  const fresh = [];
  const slack = [];
  for (const [file, rules] of Object.entries(counts)) {
    for (const [rule, count] of Object.entries(rules)) {
      const limit = allowed[file]?.[rule]?.anzahl || 0;
      if (count > limit) {
        fresh.push({ file, rule, count, allowed: limit, findings: findingsByFile[file].filter((finding) => finding.rule === rule) });
      }
    }
  }
  for (const [file, rules] of Object.entries(allowed)) {
    for (const [rule, entry] of Object.entries(rules)) {
      const count = counts[file]?.[rule] || 0;
      if (count < entry.anzahl) slack.push({ file, rule, count, allowed: entry.anzahl });
    }
  }
  const total = Object.values(counts).reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);
  const allowedTotal = Object.values(allowed).reduce((sum, rules) => sum + Object.values(rules).reduce((a, entry) => a + entry.anzahl, 0), 0);
  return { fresh, slack, total, allowedTotal };
}

/** Wo erlaubt die Ausnahmeliste mehr als die von main? Neue Ausnahmen brauchen eine Begründung im PR. */
export function allowlistGrowth(current, base) {
  const grown = [];
  for (const [file, rules] of Object.entries(current.ausnahmen || {})) {
    for (const [rule, entry] of Object.entries(rules)) {
      const before = base.ausnahmen?.[file]?.[rule]?.anzahl || 0;
      if (entry.anzahl > before) grown.push({ file, rule, before, after: entry.anzahl, grund: entry.grund });
    }
  }
  return grown;
}

/** Ausnahmeliste auf den Ist-Stand senken: nie erhöhen, nichts Neues aufnehmen. */
export function tightened(allowlist, findingsByFile) {
  const counts = countFindings(findingsByFile);
  const ausnahmen = {};
  for (const [file, rules] of Object.entries(allowlist.ausnahmen || {})) {
    for (const [rule, entry] of Object.entries(rules)) {
      const count = Math.min(entry.anzahl, counts[file]?.[rule] || 0);
      if (count > 0) {
        ausnahmen[file] ??= {};
        ausnahmen[file][rule] = { ...entry, anzahl: count };
      }
    }
  }
  return { ...allowlist, ausnahmen };
}

/** Geänderte Zeilen je Datei aus `git diff -U0 --relative`: { "src/x.css": Set(Zeilen) }. */
export function parseDiffLines(diff) {
  const lines = {};
  let file = null;
  for (const line of String(diff).split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      file = target === "/dev/null" ? null : target.replace(/^b\//, "");
      continue;
    }
    if (!file || !line.startsWith("@@")) continue;
    const plus = line.split(" ").find((part) => part.startsWith("+"));
    if (!plus) continue;
    const [start, count = "1"] = plus.slice(1).split(",");
    lines[file] ??= new Set();
    for (let offset = 0; offset < Number(count); offset += 1) lines[file].add(Number(start) + offset);
  }
  return lines;
}

/** Funde auf geänderten Zeilen markieren und nach vorn stellen - die neuen stehen dann zuerst im Kommentar. */
export function markChanged(fresh, changedLines) {
  return fresh.map((item) => {
    const changed = changedLines[item.file] || new Set();
    const findings = item.findings.map((finding) => ({ ...finding, geaendert: changed.has(finding.line) }));
    return { ...item, findings: [...findings.filter((f) => f.geaendert), ...findings.filter((f) => !f.geaendert)] };
  });
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"));
  const findings = scanTree();
  const listProblems = allowlistProblems(allowlist);
  const result = compare(findings, allowlist);
  const diffBase = argValue("--diff-base");
  if (diffBase) {
    try {
      const diff = execFileSync("git", ["diff", "-U0", "--no-color", "--relative", diffBase, "--", "src"], { cwd: FRONTEND, encoding: "utf8" });
      result.fresh = markChanged(result.fresh, parseDiffLines(diff));
    } catch {
      console.log(`Diff gegen ${diffBase} nicht lesbar - Funde ohne Markierung der geänderten Zeilen.`);
    }
  }
  const baseFile = argValue("--base-allowlist");
  const grown = baseFile && existsSync(baseFile) ? allowlistGrowth(allowlist, JSON.parse(readFileSync(baseFile, "utf8"))) : [];

  if (process.argv.includes("--tighten")) {
    writeFileSync(ALLOWLIST_FILE, `${JSON.stringify(tightened(allowlist, findings), null, 2)}\n`);
    console.log("Ausnahmeliste auf den Ist-Stand gesenkt.");
    return;
  }

  console.log(`Bewegungsregeln (#1660): ${result.total} Funde, davon ${result.allowedTotal} als Bestand erlaubt.`);
  for (const item of result.fresh) {
    console.log(`NEU ${item.file} - ${RULES[item.rule]}: ${item.count} statt höchstens ${item.allowed}`);
    // Mit --diff-base nur die geänderten Zeilen, sonst alle Funde der Datei (welcher neu ist, weiß dann nur der Diff).
    const changed = item.findings.filter((finding) => finding.geaendert);
    for (const finding of changed.length ? changed : item.findings) {
      console.log(`    Zeile ${finding.line}${finding.geaendert ? " (geändert)" : ""}: ${finding.detail}`);
    }
    if (changed.length && changed.length < item.findings.length) console.log(`    … und ${item.findings.length - changed.length} bestehende`);
  }
  for (const problem of listProblems) console.log(`AUSNAHMELISTE ${problem}`);
  for (const item of grown) console.log(`ERWEITERT ${item.file} - ${item.rule}: ${item.before} -> ${item.after} (${item.grund})`);
  if (result.slack.length) {
    console.log(`${result.slack.length} Einträge der Ausnahmeliste haben Luft - "node scripts/check-motion-rules.mjs --tighten" senkt sie.`);
  }

  const reportFile = argValue("--report");
  if (reportFile) {
    writeFileSync(reportFile, `${JSON.stringify({
      total: result.total,
      allowedTotal: result.allowedTotal,
      fresh: result.fresh,
      slack: result.slack.length,
      allowlistProblems: listProblems,
      grown,
    }, null, 2)}\n`);
  }
  if (result.fresh.length || listProblems.length) {
    console.error("\nBewegungsregeln verletzt: nur transform/opacity animieren, Dauern und Kurven aus den Tokens, " +
      "„Bewegung reduzieren“ beachten (docs/entwicklung/prueftor.md).");
    process.exit(1);
  }
  console.log("Bewegungsregeln: keine neuen Verstöße – ok");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
