import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Wischleiste als Baustein (#1969): jede waagrechte Wischfläche in Web und Verwaltung trägt `tls-swipe` - dünne
// Cyan-Leiste auf dunkler Spur, nie versteckt, Verlauf am Rand, `position: relative` gegen breitere Seiten durch
// Screenreader-Text. Dazu die Seiten-Scrollleiste im dunklen Stil.

const root = path.join(process.cwd(), "src");
const css = readFileSync(path.join(root, "index.css"), "utf8").replace(/\r\n/g, "\n");

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(jsx?|css)$/.test(entry.name) && !entry.name.includes(".test.")) out.push(full);
  }
  return out;
}

test("der Baustein: Lage, Scrollen und Abstand in :where(), dünne Cyan-Leiste, Verlauf nur mit Scroll-Animation", () => {
  expect(css).toContain(":where(.tls-swipe) { position: relative; overflow-x: auto; padding-bottom: 8px; }");
  expect(css).toContain("scrollbar-width: thin; scrollbar-color: var(--tls-cyan) rgb(255 255 255 / 0.08);");
  const supports = css.slice(css.indexOf("@supports (animation-timeline: scroll())"));
  expect(supports.slice(0, 600)).toContain("mask-image");
  expect(supports.slice(0, 600)).toContain("animation-timeline: scroll(self inline)");
});

test("die Seite ist dunkel: color-scheme und eine dunkle Seiten-Scrollleiste", () => {
  expect(css).toContain(":root { color-scheme: dark; }");
  expect(css).toContain("html { scrollbar-color: #2C2C33 var(--tls-surface-0); }");
  expect(css).toContain("::-webkit-scrollbar-track { background: var(--tls-surface-0); }");
});

test("keine Wischfläche mehr mit overflow-x-auto, keine versteckte Wischleiste", () => {
  const offenders = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, "utf8");
    const name = path.relative(root, file);
    if (/\.jsx?$/.test(file) && /className=[^>]*\boverflow-x-auto\b/.test(text)) offenders.push(`${name}: overflow-x-auto`);
    if (/\.jsx?$/.test(file) && /\btls-swipe\b[^"`]*\btls-hide-scrollbar\b|\btls-hide-scrollbar\b[^"`]*\btls-swipe\b/.test(text)) offenders.push(`${name}: versteckt`);
  }
  for (const name of ["components/tls/series/racingLeague.css", "components/tls/references/references.css"]) {
    const text = readFileSync(path.join(root, name), "utf8");
    if (/tls-(season-tabs|ref-scroll)[^{]*\{[^}]*scrollbar-width: none/.test(text)) offenders.push(`${name}: scrollbar-width none`);
  }
  expect(offenders).toEqual([]);
});
