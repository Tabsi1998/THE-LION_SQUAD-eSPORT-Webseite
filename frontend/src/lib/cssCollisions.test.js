import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Wächter (#2448, Review F1): Nachgeladene Stylesheets (z. B. notifications.css) bleiben nach dem ersten Laden im Tab
// und stehen dann hinter index.css. Definieren sie eine allgemeine Klasse aus index.css ohne eigenen Rahmen neu, gilt
// das ab da auf jeder Seite - so machte „.tls-reveal“ aus den Benachrichtigungen die zugeklappten FAQ-Antworten sichtbar.
// Erlaubt sind nur Bausteine, deren Grundform bewusst in ihrer eigenen Datei steht.

const SRC = path.resolve(__dirname, "..");
const ERLAUBT = {
  "components/tls/league/public/season.css": ["tls-standing-row"], // Meister-Zeile der Tabelle, nur mit data-champion
  "components/tls/references/references.css": ["tls-run-pulse"], // nur „Bewegung reduzieren“: Puls aus
  "components/tls/rewards/rewards.css": ["tls-placement"], // Platzierung „Löwe“, nur mit data-metal
};

function cssDateien(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return cssDateien(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

/** Klassen, mit denen eine Regel ohne Eltern-Selektor beginnt (`.tls-x`, `.tls-x[…]`, `.tls-x:hover`). */
function freieKlassen(css) {
  const klassen = new Set();
  for (const match of ohneKommentare(css).matchAll(/([^{}]+)\{/g)) {
    for (const selektor of match[1].split(",").map((teil) => teil.trim())) {
      if (!selektor || selektor.startsWith("@") || /\s/.test(selektor)) continue;
      const klasse = selektor.match(/^\.(tls-[\w-]+)/)?.[1];
      if (klasse) klassen.add(klasse);
    }
  }
  return klassen;
}

test("nachgeladene Stylesheets überschreiben keine allgemeinen Klassen aus index.css", () => {
  const allgemein = freieKlassen(readFileSync(path.join(SRC, "index.css"), "utf8"));
  const funde = {};
  for (const datei of cssDateien(SRC)) {
    const rel = path.relative(SRC, datei).split(path.sep).join("/");
    if (rel === "index.css") continue;
    const doppelt = [...freieKlassen(readFileSync(datei, "utf8"))].filter((klasse) => allgemein.has(klasse)).sort();
    if (doppelt.length) funde[rel] = doppelt;
  }
  expect(funde).toEqual(Object.fromEntries(Object.entries(ERLAUBT).map(([datei, klassen]) => [datei, [...klassen].sort()])));
});
