#!/usr/bin/env node
/*
 * FAQ in der App (#2449): Die öffentlichen Fragen, Bereiche und Anleitungen werden einmal gepflegt - im Web
 * (frontend/src/hilfe: bereiche.json, fragen.json, themen/*.json). Der Server liefert sie nicht aus (GET /api/faq
 * schickt nur die geschützten Fragen), deshalb bündelt die App eine Kopie. Dieses Skript schreibt sie:
 *
 *   node scripts/sync-faq.js           schreibt src/faq/webFaq.generated.json
 *   node scripts/sync-faq.js --check   Exit 1, wenn die Datei nicht mehr zum Web passt
 *
 * Ein Jest-Test (src/faq/faq.test.ts) prüft dasselbe, damit eine neue Frage im Web nicht unbemerkt in der App fehlt.
 * Von den Anleitungen kommt nur Text mit: Bilder und Schleifen zeigt die Website, die App verlinkt auf /faq/<thema>.
 */
const fs = require("fs");
const path = require("path");

const WEB = path.resolve(__dirname, "../../frontend/src/hilfe");
const OUT = path.resolve(__dirname, "../src/faq/webFaq.generated.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(WEB, file), "utf8"));
}

/** Die Themen in der Reihenfolge des Webs (export const THEMEN in index.js) - sie bestimmt die Reihenfolge der Treffer. */
function themenDateien() {
  const source = fs.readFileSync(path.join(WEB, "index.js"), "utf8").replace(/\r\n/g, "\n");
  const imports = {};
  const importRe = /^import (\w+) from "\.\/themen\/([\w-]+)\.json";$/gm;
  let match;
  while ((match = importRe.exec(source))) imports[match[1]] = `themen/${match[2]}.json`;
  const liste = source.match(/export const THEMEN = \[([^\]]*)\];/);
  if (!liste) throw new Error("frontend/src/hilfe/index.js: THEMEN nicht gefunden");
  return liste[1].split(",").map((name) => name.trim()).filter(Boolean).map((name) => {
    if (!imports[name]) throw new Error(`frontend/src/hilfe/index.js: Thema ${name} ohne Import`);
    return imports[name];
  });
}

function nurVorhanden(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function bereich(row) {
  return { id: row.id, titel: row.titel, kurz: row.kurz, icon: row.icon, rollen: row.rollen || [], sichtbar_fuer: row.sichtbar_fuer };
}

function frage(row) {
  return nurVorhanden({
    id: row.id, frage: row.frage, antwort: row.antwort, bereich: row.bereich, rollen: row.rollen || [], sichtbar_fuer: row.sichtbar_fuer,
    haeufig: row.haeufig ? true : undefined,
    link: row.link ? { to: row.link.to, label: row.link.label } : undefined,
  });
}

function thema(row) {
  return nurVorhanden({
    slug: row.slug, titel: row.titel, kurz: row.kurz, zielgruppe: row.zielgruppe, bereich: row.bereich, rollen: row.rollen || [],
    sichtbar_fuer: row.sichtbar_fuer, suchbegriffe: row.suchbegriffe,
    abschnitte: (row.abschnitte || []).map((abschnitt) => nurVorhanden({
      id: abschnitt.id, titel: abschnitt.titel, bereich: abschnitt.bereich,
      schritte: (abschnitt.schritte || []).map((schritt) => nurVorhanden({ id: schritt.id, titel: schritt.titel, text: schritt.text, hinweis: schritt.hinweis })),
    })),
  });
}

// JSON statt TypeScript: Kennungen und Anker der Website (etwa „ergebnis-bestaetigen“) sind Daten, kein Text der App.
function build() {
  const daten = {
    _quelle: "Erzeugt von mobile/scripts/sync-faq.js aus frontend/src/hilfe (#2449) - nicht von Hand ändern. Neu erzeugen: node scripts/sync-faq.js",
    bereiche: readJson("bereiche.json").map(bereich),
    fragen: readJson("fragen.json").map(frage),
    themen: themenDateien().map((file) => thema(readJson(file))),
  };
  return `${JSON.stringify(daten, null, 2)}\n`;
}

if (require.main === module) {
  const next = build();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current !== next) {
      console.error("src/faq/webFaq.generated.json passt nicht zu frontend/src/hilfe - bitte `node scripts/sync-faq.js` ausführen.");
      process.exit(1);
    }
    console.log("FAQ der App passt zum Web.");
  } else {
    fs.writeFileSync(OUT, next, "utf8");
    console.log(`geschrieben: ${path.relative(process.cwd(), OUT)}`);
  }
}

module.exports = { build, OUT, WEB };
