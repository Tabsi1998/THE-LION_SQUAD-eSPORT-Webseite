// Prüftor (#1660): bekannte Funde bei Barrierefreiheit und Kontrast aus der Zeit vor dem Tor. Sie stehen mit
// Begründung in prueftor-bekannt.json und lassen den Test grün; jeder neue Fund (andere Seite, andere Regel, anderes
// Element) bleibt rot. Wird einer behoben, fliegt er aus der Liste. Wächst die Liste gegenüber main, braucht der PR
// eine Begründung (scripts/prueftor.mjs, docs/entwicklung/prueftor.md).
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "prueftor-bekannt.json");
const ARTEN = new Set(["a11y", "kontrast", "tastatur"]);

function load(file = FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Schlüssel eines bekannten Funds: Seite, Art und Ziel. */
const keyOf = (seite, art, ziel) => `${seite}|${art}|${ziel}`;

/**
 * Funde ohne die bekannten: `findings` sind Texte oder { key, text }. Ergebnis: Texte. Seite „*“ gilt auf jeder Seite
 * (Bausteine des Rahmens wie Fuß und Handy-Leiste).
 */
function withoutKnown(seite, art, findings, list = load()) {
  const known = new Set((list.funde || []).map((fund) => keyOf(fund.seite, fund.art, fund.ziel)));
  return findings
    .map((finding) => (typeof finding === "string" ? { key: finding, text: finding } : finding))
    .filter((finding) => !known.has(keyOf(seite, art, finding.key)) && !known.has(keyOf("*", art, finding.key)))
    .map((finding) => finding.text);
}

/** Jeder Eintrag braucht Seite, bekannte Art, Ziel und eine Begründung. */
function problems(list = load()) {
  return (list.funde || []).flatMap((fund, index) => {
    const out = [];
    if (!fund.seite || !fund.ziel) out.push(`Eintrag ${index + 1}: Seite oder Ziel fehlt`);
    if (!ARTEN.has(fund.art)) out.push(`Eintrag ${index + 1}: unbekannte Art „${fund.art}“`);
    if (typeof fund.grund !== "string" || fund.grund.trim().length < 20) out.push(`Eintrag ${index + 1}: Begründung fehlt oder ist zu kurz`);
    return out;
  });
}

module.exports = { FILE, keyOf, load, problems, withoutKnown };
