import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Knöpfe (#1082): eine Sprache für alle öffentlichen Seiten - wichtig (blau, Lichtlauf, Pfeil fährt 3 px),
// zweitrangig (blauer Rahmen), leise (Nebensachen), gefährlich (Löschen, Stornieren, Aufgeben in Rot) und seit #1335
// Ehre (Gold mit dunkler Schrift - nur „Antrag stellen“ auf „Mitglied werden“; im Mitgliederbereich kein Gold-Knopf, #1336).

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "src/index.css"), "utf8").replace(/\r\n/g, "\n");
const system = readFileSync(path.join(root, "src/styles/system.css"), "utf8").replace(/\r\n/g, "\n");

function rule(selector, source = css) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("}", start));
}

test("die fünf Arten haben je ihren Stil, Fokus ist für alle sichtbar, Hover nur mit Maus", () => {
  expect(rule(".tls-btn--primary")).toMatch(/background-color: var\(--tls-cyan\)/);
  expect(rule(".tls-btn--primary")).toMatch(/background-image: linear-gradient/);
  expect(rule(".tls-btn--secondary")).toMatch(/border: 1px solid rgba\(41, 182, 232/);
  expect(rule(".tls-btn--quiet")).toMatch(/border: 1px solid rgba\(255, 255, 255/);
  expect(rule(".tls-btn--danger")).toMatch(/border: 1px solid rgba\(255, 59, 48/);
  expect(rule(".tls-btn--honor")).toMatch(/background-color: var\(--tls-gold\)/);
  expect(rule(".tls-btn--honor")).toMatch(/color: #1A1400/);
  expect(rule(".tls-btn:focus-visible")).toMatch(/outline: 2px solid/);
  // Karten zeigen beim Fokus die Ecken (#1316) - ohne den 3-px-Ring aus App.css, der sie verdecken würde.
  expect(rule(".tls-card:focus-visible")).toMatch(/outline: 2px solid transparent;/);
  const hover = css.slice(css.indexOf(".tls-btn--primary:hover"), css.indexOf(".tls-btn:hover:not(:disabled) .lucide-arrow-right"));
  for (const variant of ["primary", "secondary", "quiet", "danger", "honor"]) expect(hover).toContain(`.tls-btn--${variant}:hover:not(:disabled)`);
  // Der goldene Lichtlauf hängt wie der blaue an „Bewegung reduzieren“.
  expect(hover).toMatch(/\.tls-btn--honor:hover:not\(:disabled\) \{[^}]*calc\(150% - 200% \* var\(--tls-motion-on\)\)/);
  // Lichtlauf und Pfeil hängen an „Bewegung reduzieren“.
  expect(css).toMatch(/\.tls-btn:hover:not\(:disabled\) \.lucide-arrow-right \{\s*transform: translateX\(calc\(3px \* var\(--tls-motion-on\)\)\)/);
});

// Fokus mit der Tastatur (#1316): Knöpfe und Karten tragen die Ecken-Klammern aus styles/system.css - vier Winkel in
// Cyan, 11 px lang, 2 px stark, 5 px außerhalb - statt eines weißen Rahmens oder Rings. Der Rahmen bleibt da, aber
// durchsichtig: Im Kontrast-Modus von Windows bekommt er die Systemfarbe, Verläufe und Schatten fallen dort weg.
test("Fokus: Ecken-Klammern an Knöpfen und Karten, dazu ein durchsichtiger Rahmen für den Kontrast-Modus", () => {
  const root = rule(":root, :where(.tls-you), :where(.tls-btn), :where(.tls-card)", system.slice(system.indexOf("/* Ecken-Klammern (#1316)")));
  expect(root).toMatch(/--tls-corner-len: 11px;/);
  expect(root).toMatch(/--tls-corner-width: 2px;/);
  expect(root).toMatch(/--tls-corner-out: 5px;/);
  const corners = root.slice(root.indexOf("--tls-corners:"));
  expect(corners.match(/linear-gradient\(var\(--tls-brand\) 0 0\)/g)).toHaveLength(8);
  for (const corner of ["top left", "top right", "bottom left", "bottom right"]) expect(corners.split(corner).length - 1).toBe(2);

  expect(rule(".tls-btn:focus-visible")).toMatch(/outline: 2px solid transparent;/);
  expect(rule(".tls-btn:focus-visible")).toMatch(/box-shadow: none;/);
  expect(rule(".tls-btn:focus-visible")).not.toMatch(/#FFFFFF/);
  // Knopf über ::before; Karte über ::after, damit das Live-Licht (.tls-live-frame::before) daneben weiterläuft.
  expect(rule(".tls-card:focus-visible::before")).toBe("");
  for (const pseudo of [".tls-btn:focus-visible::before", ".tls-card:focus-visible::after"]) {
    const corners = rule(pseudo);
    expect(corners).toMatch(/content: "";/);
    expect(corners).toMatch(/position: absolute;/);
    expect(corners).toMatch(/inset: calc\(-1 \* var\(--tls-corner-out\)\);/);
    expect(corners).toMatch(/pointer-events: none;/);
    expect(corners).toMatch(/background: var\(--tls-corners\);/);
    // Keine Bewegung, kein Schein an den Winkeln.
    expect(corners).not.toMatch(/animation|transition|box-shadow|filter/);
  }
  // Die Winkel brauchen eine Stelle mit Lage - ohne Gewicht, damit `absolute` oder `fixed` am Knopf weiter gelten.
  expect(system).toMatch(/:where\(\.tls-you\), :where\(\.tls-btn\), :where\(\.tls-card\) \{ position: relative; \}/);
  // In wischbaren Leisten sitzen die Winkel an der Kante - die Leiste schneidet oben und unten ab.
  expect(css).toMatch(/\n\.tls-swipe :is\(\.tls-btn, \.tls-card\) \{ --tls-corner-out: 0px; \}/);
  // Karten heben sich um 5 px - Leisten mit Karten haben oben 6 px Luft, fest (kein Sprung beim Fokus).
  expect(css).toMatch(/\n\.tls-swipe:has\(\.tls-card\) \{ padding-top: 6px; \}/);
  // Alle anderen Stellen behalten den Ring, aber auch dort mit durchsichtigem Rahmen statt `outline: none`.
  expect(css).toMatch(/\n:focus-visible \{ outline: 2px solid transparent; outline-offset: 2px; box-shadow: 0 0 0 2px var\(--tls-cyan\); \}/);
});

// Wächter: Ein Knopf (button, Link, a) mit eigener Farbe oder eigenem Rahmen ohne .tls-btn fällt auf. Umschalter mit
// Zustand (Reiter, Filter) stehen in Vorlagen und zählen nicht; Werkzeuge der Verwaltung auch nicht.
const ADMIN_TOOLS = new Set([
  "AdminLayout.jsx", "AdminSheet.jsx", "SetupGuide.jsx", "DolibarrSourceBlock.jsx", "EventBillingSection.jsx", "EventDaysSection.jsx",
  "EventLocationsSection.jsx", "InvoiceTermsPanel.jsx", "MarkdownEditor.jsx", "ImageUpload.jsx", "DiscordPreview.jsx", "DiscordMessagePreview.jsx",
]);

// Bewusst keine Knöpfe im Sinn von #1082 - jede neue Ausnahme muss hier eingetragen und begründet werden.
const EXCEPTIONS = {
  "components/tls/BallotPopup.jsx": 1, // schwebender Hinweis „Abstimmung offen“
  "components/tls/GlobalSearch.jsx": 1, // Kacheln der Suche
  "components/tls/MentionText.jsx": 1, // @-Erwähnung im Text
  "components/tls/PublicLayout.jsx": 2, // offizieller Discord-Knopf; Login als Personen-Symbol wie Lupe und Glocke (#1234)
  "components/tls/references/HonorHeader.jsx": 1, // Sprungmarken als Chips (seit #1305 erkennt der Test auch Farb-Rollen)
  "pages/public/CalendarPage.jsx": 1, // Terminzeile
  "pages/public/EventDetailPage.jsx": 1, // Zeile eines Turniers am Event
  "pages/public/FaqPage.jsx": 1, // Zeile einer Anleitung in einem Bereich der FAQ (#2448)
  "pages/public/NewsDetailPage.jsx": 1, // verwandter Beitrag
  "pages/public/PartnerDetailPage.jsx": 1, // Werkzeug-Zeile in der Partnerfarbe
  "pages/public/PublicProfilePage.jsx": 3, // Zeilen (Team, Referenz); Schild „Vereinsmitglied · Funktion“ mit Link zum Vereinsprofil (#1267)
  "pages/public/ServersPage.jsx": 2, // Serverzeile, Kopierfeld
  "pages/public/TournamentDetailPage.jsx": 1, // Partner-Schild „mit …“
  "pages/public/VereinPage.jsx": 1, // Kacheln des Mitgliederbereichs (#1147), wie in der App
  "pages/public/profile/OwnProfileParts.jsx": 1, // Zeilen im Kasten „Nur für dich“ (#1149)
};

function filesIn(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesIn(full);
    return name.endsWith(".jsx") && !name.endsWith(".test.jsx") && !ADMIN_TOOLS.has(name) ? [full] : [];
  });
}

function ownStyledButtons(text) {
  const tags = [...text.matchAll(/<([A-Za-z][\w.]*)/g)].map((m) => ({ at: m.index, name: m[1] }));
  let count = 0;
  for (const m of text.matchAll(/className="([^"]*)"/g)) {
    const tag = tags.filter((t) => t.at < m.index).pop();
    if (!tag || !["button", "Link", "a", "NavLink"].includes(tag.name)) continue;
    const cls = m[1];
    if (/\btls-(btn|store|card)\b/.test(cls) || !/\bp[xy]-\d/.test(cls)) continue;
    // Farbig: ein Hexwert oder eine Farb-Rolle (#1305: bg-honor/5, border-warn/40 …).
    const colorful = /\b(?:bg|border)-(?:\[#[0-9A-Fa-f]{6}\]|(?:brand|live|warn|ok|honor|event|quiet)\b)/.test(cls);
    // GROSS kommt seit der Schrift-Treppe (#1302) auch vom Etikett (tls-type-label).
    if (colorful || (/\bborder\b/.test(cls) && /\b(?:uppercase|tls-type-label)\b/.test(cls))) count += 1;
  }
  return count;
}

test("öffentliche Seiten haben keine Knöpfe mit eigenem Stil mehr (nur die eingetragenen Ausnahmen)", () => {
  const src = path.join(root, "src");
  const found = {};
  for (const file of [...filesIn(path.join(src, "pages/public")), ...filesIn(path.join(src, "components/tls"))]) {
    const count = ownStyledButtons(readFileSync(file, "utf8"));
    if (count) found[path.relative(src, file).split(path.sep).join("/")] = count;
  }
  expect(found).toEqual(EXCEPTIONS);
});
