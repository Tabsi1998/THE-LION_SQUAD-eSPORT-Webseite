import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Wächter „Nichts Wichtiges mit …“ (#1314): Titel, Namen, Daten, Orte, Rollen und Zustände werden nicht mit `truncate`
// oder `line-clamp` gekürzt - sie brechen um (`tls-wrap` in index.css), lange Titel kommen eine Stufe kleiner
// (lib/longTitle.js). „…“ bleibt Vorschau-Texten (Anrisse, Beschreibungen) und technischen Werten (Hash, Token, Pfad,
// Link), die ihren vollen Text im `title` tragen. Jede Kürzung im Bereich steht unten mit Grund; eine neue schlägt an.
//
// Bereich Teil 1: öffentliche Seiten außerhalb von Profil, Team, Liga und Turnier (Start, News, Events, Kalender,
// Verein, Über uns, Kontakt, Galerie, Hilfe, Kopf, Glocke) und die Verwaltung ohne Liga, Turnier, Serien, Maps, F1 und
// Mitgliederprofile. Teil 2 nimmt die übrigen Seiten in SCOPE auf.

const root = path.join(process.cwd(), "src");

const PUBLIC_PAGES = [
  "HomePage", "NewsPage", "NewsDetailPage", "EventsPage", "EventDetailPage", "EventLivePage", "EventLeadPage",
  "CalendarPage", "VereinPage", "AboutPage", "ClubPages", "ContactPage", "GalleryPage", "GalleryAlbumPage", "FaqPage",
  "HelpTopicPage",
].map((name) => `pages/public/${name}.jsx`);

const COMPONENTS = [
  "NewsLead", "NewsTextCard", "NotificationBell", "NotificationRow", "UserMenu", "GlobalSearch", "PublicLayout",
  "MainNav", "BottomNav", "EventRecap", "AdminLayout", "PersonPicker", "UploadProgressPanel", "BoardPortrait",
  "LiveStreamSlider", "TwitchClips", "SeasonPassWidget", "HomeTodayStrip", "HomeLeaguePromo", "SponsorTicker",
].map((name) => `components/tls/${name}.jsx`);

// Verwaltung ohne die Bereiche, an denen Teil 2 bzw. andere Tickets arbeiten.
const ADMIN_OUTSIDE = /^pages\/admin\/(league|tournament|referenceSeries|maps|f1|members)\/|^pages\/admin\/(AdminTournament|AdminSeasons|AdminClubMemberProfiles|AdminF1|AdminPrizes|AdminStations|AdminReferenceSeries)|^pages\/admin\/games\/GameMapsTab/;

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.jsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(root, file).split(path.sep).join("/");

const SCOPE = [
  ...PUBLIC_PAGES,
  ...COMPONENTS,
  ...sourceFiles(path.join(root, "pages/admin")).map(rel).filter((name) => !ADMIN_OUTSIDE.test(name)),
];

// Erlaubte Kürzungen: Datei, ein eindeutiges Stück der Zeile, wie oft, und der Grund.
const ALLOWED = [
  { file: "pages/public/HomePage.jsx", needle: "line-clamp-3\">{news.excerpt}", why: "Vorschau: Anriss der News" },
  { file: "pages/public/NewsPage.jsx", needle: "line-clamp-3 flex-1\">{n.excerpt}", why: "Vorschau: Anriss der News" },
  { file: "pages/public/EventsPage.jsx", needle: "line-clamp-2 flex-1\">{descriptionPreview}", why: "Vorschau: Beschreibung des Events" },
  { file: "pages/public/EventDetailPage.jsx", needle: "line-clamp-2\">{n.excerpt}", why: "Vorschau: Anriss der News" },
  { file: "pages/public/EventLivePage.jsx", needle: "truncate\" title={station.notes", why: "Vorschau: Notiz zur Station, ganz im title" },
  { file: "pages/public/CalendarPage.jsx", needle: "block h-5 min-w-0 truncate", why: "Balken im Monatsraster: ganz im title und aria-label, darunter in der Liste ohne Kürzung" },
  { file: "pages/public/GalleryPage.jsx", needle: "line-clamp-2\">{a.description}", why: "Vorschau: Beschreibung des Albums" },
  { file: "pages/public/FaqPage.jsx", needle: "line-clamp-2\">{treffer.text}", why: "Vorschau: Antworttext im Suchtreffer" },
  { file: "components/tls/NewsLead.jsx", needle: "line-clamp-3\">{news.excerpt}", why: "Vorschau: Anriss der News" },
  { file: "components/tls/NewsTextCard.jsx", needle: "line-clamp-4 ${SENTENCE_SIZE", why: "Vorschau: Satz aus der News auf der Bild-Fläche" },
  { file: "components/tls/NotificationRow.jsx", needle: "truncate\" data-testid={`${testIdPrefix}-preview-", why: "Vorschau: Text der Benachrichtigung" },
  { file: "components/tls/UserMenu.jsx", needle: "max-w-[10rem] truncate", why: "eigener Name im Kopf: einzeilig, ganz im title, im aria-label und im Menü" },
  { file: "components/tls/EventRecap.jsx", needle: "line-clamp-2\">{recap.report.excerpt}", why: "Vorschau: Anriss des Berichts" },
  { file: "components/tls/LiveStreamSlider.jsx", needle: "line-clamp-2 font-semibold text-white\" title={activeStream.title", why: "Vorschau: Titel des fremden Twitch-Streams, ganz im title" },
  { file: "components/tls/LiveStreamSlider.jsx", needle: "truncate tls-type-small text-white/50\" title={stream.title", why: "Vorschau: Titel des fremden Twitch-Streams, ganz im title" },
  { file: "components/tls/AdminLayout.jsx", needle: "block truncate tls-type-small font-normal text-quiet", why: "Vorschau: Suchhinweis unter dem Menüpunkt" },
  { file: "pages/admin/achievements/CatalogTab.jsx", needle: "truncate\">{g.description", why: "Vorschau: Beschreibung" },
  { file: "pages/admin/AdminAppReleasesPage.jsx", needle: "truncate max-w-[16rem]\" title={row.sha256", why: "technisch: Prüfsumme, ganz im title" },
  { file: "pages/admin/AdminBenefitsPage.jsx", needle: "line-clamp-3\">{b.description}", why: "Vorschau: Beschreibung" },
  { file: "pages/admin/AdminGameServersPage.jsx", needle: "line-clamp-2\">{server.description}", why: "Vorschau: Beschreibung" },
  { file: "pages/admin/AdminMediaPage.jsx", needle: "truncate\" title={it.filename}", why: "Dateiname in der Bildkachel, ganz im title" },
  { file: "pages/admin/AdminMobilePushPage.jsx", needle: "truncate\">{token.token_preview}", count: 2, why: "technisch: Ausschnitt des Geräte-Tokens" },
  { file: "pages/admin/AdminNavPage.jsx", needle: "font-mono truncate max-w-[180px]\">{it.to}", why: "technisch: Pfad des Menüpunkts" },
  { file: "pages/admin/AdminNavPage.jsx", needle: "font-mono truncate max-w-[160px]\">{c.to}", why: "technisch: Pfad des Unterpunkts" },
  { file: "pages/admin/AdminOpsPage.jsx", needle: "truncate\" title={tile.detail}", why: "Vorschau: Betriebs-Detail, ganz im title" },
  { file: "pages/admin/AdminPartnersPage.jsx", needle: "line-clamp-2\">{p.description}", why: "Vorschau: Beschreibung" },
  { file: "pages/admin/AdminPartnersPage.jsx", needle: "truncate max-w-full\" title={p.link}", why: "technisch: Link, ganz im title" },
  { file: "pages/admin/AdminSponsorsPage.jsx", needle: "line-clamp-2\">{s.description}", why: "Vorschau: Beschreibung" },
  { file: "pages/admin/AdminSponsorsPage.jsx", needle: "hover:underline truncate\" title={s.link}", why: "technisch: Link, ganz im title" },
  { file: "pages/admin/GameMatchDataFields.jsx", needle: "truncate tls-type-small text-white/70\" title={rule}", why: "Vorschau: Regeltext, ganz im title" },
  { file: "pages/admin/media/parts.jsx", needle: "truncate\">{event.mime", why: "technisch: Dateityp" },
  { file: "pages/admin/settings/DiscordGuildsPanel.jsx", needle: "hover:text-white truncate\" title={guild.invite_url}", why: "technisch: Einladungslink, ganz im title" },
];

const CUT = /(?<![\w-])(truncate|line-clamp(?:-\d+|-none)?)(?![\w-])/;

function findings() {
  const unexplained = [];
  const used = new Map(ALLOWED.map((entry) => [entry, 0]));
  for (const file of SCOPE) {
    const lines = readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = CUT.exec(line);
      if (!match || match[1] === "line-clamp-none") return;
      const entry = ALLOWED.find((item) => item.file === file && line.includes(item.needle));
      if (entry) used.set(entry, used.get(entry) + 1);
      else unexplained.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  const stale = ALLOWED.filter((entry) => used.get(entry) !== (entry.count || 1)).map((entry) => `${entry.file}: ${entry.needle} (${used.get(entry)} statt ${entry.count || 1})`);
  return { unexplained, stale };
}

test("der Bereich ist nicht leer und jede Datei darin gibt es", () => {
  expect(SCOPE.length).toBeGreaterThan(100);
  for (const file of SCOPE) expect(() => readFileSync(path.join(root, file), "utf8"), file).not.toThrow();
});

test("keine neue Kürzung an Titeln, Namen, Daten, Orten oder Rollen - nur die erlaubten mit Grund", () => {
  expect(findings().unexplained).toEqual([]);
});

test("die Liste der Ausnahmen ist aktuell: jede trifft genau so oft wie angegeben", () => {
  expect(findings().stale).toEqual([]);
});

test("jede Ausnahme hat einen Grund", () => {
  for (const entry of ALLOWED) expect(entry.why.length, entry.needle).toBeGreaterThan(8);
});

test("der Baustein bricht an Wortgrenzen um, trennt deutsch und schneidet nichts ab", () => {
  const css = readFileSync(path.join(root, "index.css"), "utf8");
  const rule = css.split("\n").find((line) => line.startsWith(".tls-wrap {")) || "";
  expect(rule).toContain("overflow-wrap: anywhere");
  expect(rule).toContain("hyphens: auto");
  expect(rule).toContain("min-width: 0");
  expect(rule).not.toContain("ellipsis");
  expect(readFileSync(path.join(process.cwd(), "index.html"), "utf8")).toContain('<html lang="de">');
});
