import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Knöpfe (#1082): eine Sprache für alle öffentlichen Seiten - wichtig (blau, Lichtlauf, Pfeil fährt 3 px),
// zweitrangig (blauer Rahmen), leise (Nebensachen), gefährlich (Löschen, Stornieren, Aufgeben in Rot) und seit #1335
// Ehre (Gold mit dunkler Schrift - nur „Antrag stellen“ auf „Mitglied werden“; im Mitgliederbereich kein Gold-Knopf, #1336).

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "src/index.css"), "utf8").replace(/\r\n/g, "\n");

function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start));
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
  const hover = css.slice(css.indexOf(".tls-btn--primary:hover"), css.indexOf(".tls-btn:hover:not(:disabled) .lucide-arrow-right"));
  for (const variant of ["primary", "secondary", "quiet", "danger", "honor"]) expect(hover).toContain(`.tls-btn--${variant}:hover:not(:disabled)`);
  // Der goldene Lichtlauf hängt wie der blaue an „Bewegung reduzieren“.
  expect(hover).toMatch(/\.tls-btn--honor:hover:not\(:disabled\) \{[^}]*calc\(150% - 200% \* var\(--tls-motion-on\)\)/);
  // Lichtlauf und Pfeil hängen an „Bewegung reduzieren“.
  expect(css).toMatch(/\.tls-btn:hover:not\(:disabled\) \.lucide-arrow-right \{\s*transform: translateX\(calc\(3px \* var\(--tls-motion-on\)\)\)/);
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
  "components/tls/PublicLayout.jsx": 1, // offizieller Discord-Knopf
  "pages/public/CalendarPage.jsx": 1, // Terminzeile
  "pages/public/EventDetailPage.jsx": 1, // Zeile eines Turniers am Event
  "pages/public/NewsDetailPage.jsx": 1, // verwandter Beitrag
  "pages/public/PartnerDetailPage.jsx": 1, // Werkzeug-Zeile in der Partnerfarbe
  "pages/public/PublicProfilePage.jsx": 2, // Zeilen (Team, Referenz)
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
    const colorful = /\b(?:bg|border)-\[#[0-9A-Fa-f]{6}\]/.test(cls);
    if (colorful || (/\bborder\b/.test(cls) && /\buppercase\b/.test(cls))) count += 1;
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
