// Prüftor (#1660): Diese Browser-Tests laufen in der CI im Job „Prüftor“ gegen das gebaute dist
// (playwright.prueftor.config.js) und nicht noch einmal in den Browser-Teilen (E2E_OHNE_PRUEFTOR=1 in ci.yml).
// Lokal laufen sie mit `yarn test:e2e` wie bisher mit, außer der Ladezeit-Messung: Die misst nur gegen dist sinnvoll.
//
// `check` ordnet jede Datei einer Prüfung des Tors zu (scripts/prueftor.mjs). Tests, deren Titel „Kontrast“ enthält,
// zählen zur Prüfung „kontrast“.
const PRUEFTOR_SPECS = [
  { file: "a11y-pages.spec.js", check: "a11y" },
  { file: "prueftor-a11y.spec.js", check: "a11y" },
  { file: "no-layout-jump.spec.js", check: "ladezeit" },
  { file: "ui-motion.spec.js", check: "bewegung" },
  { file: "prueftor-ladezeit.spec.js", check: "ladezeit" },
];

const LADEZEIT_SPEC = "prueftor-ladezeit.spec.js";

module.exports = { PRUEFTOR_SPECS, LADEZEIT_SPEC };
