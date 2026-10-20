import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Referenzen als Erfolgswand (#409): Medaillenbilanz oben, Trophäenwand mit den Podestplätzen,
// Bilanz je Spiel als Filter, Zeitleiste nach Saison; Chips aus Feldern, Einträge mit eigener
// Platzierung in Podest-Optik; Podest zählt je Eintrag.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (value) => [value, { current: null }] }));

const { default: ReferencesPage, timelineGroups } = await import("./ReferencesPage");

const ITEMS = [
  {
    id: "r1", title: "Winter Cup", display_title: "Winter Cup", organizer: "ESL", league: "Liga X", season: "Season 3", format: "HC",
    platforms: ["PS"], reference_meta: { platforms: [{ key: "PS", label: "PlayStation" }] }, status: "completed",
    game_id: "g1", game: { id: "g1", name: "Call of Duty" }, best_placement: 1, medal: "gold",
    entries: [
      { id: "e1", kind: "solo", placement: 1, medal: "gold", lineup_members: [{ profile_id: "p1", display_name: "Anni", profile_url: "/members/anni" }], lineup: [] },
      { id: "e2", kind: "solo", placement: 4, medal: null, participant_count: 32, lineup_members: [{ profile_id: "p2", display_name: "Benny" }], lineup: [] },
    ],
  },
  {
    id: "r2", title: "Herbst Cup", display_title: "Herbst Cup", season: "Season 2", platforms: ["PC"], reference_meta: { platforms: [] }, status: "planned",
    game_id: "g2", game: { id: "g2", name: "Rocket League" }, best_placement: null, medal: null,
    entries: [{ id: "e3", kind: "team", team_name: "LION A", placement: null, lineup_members: [{ profile_id: "p1", display_name: "Anni" }, { profile_id: "p2", display_name: "Benny" }], lineup: ["Gast"] }],
  },
];
const SUMMARY = { total: 2, entries: 3, podiums: 1, gold: 1, silver: 0, bronze: 0, games: 2, seasons: ["Season 2", "Season 3"] };

let running = { today: "2026-11-09", items: [] };
beforeEach(() => {
  running = { today: "2026-11-09", items: [] };
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url === "/reference-series/public/running" ? running : { items: ITEMS, summary: SUMMARY } }));
});

const CUP = { lineage: { title: "Probe Monatscup mit einem sehr langen Namen ohne Leerzeichen-Pause", slug: "probe-cup", kind: "series", label: null, game_name: "Probespiel" }, game: null, series: { season: "2026", tier: null, title: null, season_slug: "2026" }, progress: { total: 4, scored: 1 }, next: { code: "Q2", title: null, club_day: "2026-11-09", time: "20:00", state: "today" }, today: true, club: { rank: 2, of: 12 } };
const LEAGUE = { lineage: { title: "Probe Liga", slug: "probe-liga", kind: "team_league", label: "4vs4", game_name: null }, game: null, series: { season: "2026", tier: "Division 1", title: null, season_slug: "2026" }, progress: { total: 8, scored: 0 }, next: { code: "ST1", title: null, club_day: "2026-11-23", time: null, state: "planned" }, today: false, club: null };

test("Läuft gerade: ohne laufende Serie kein Bereich, die Seite bleibt wie sie ist", async () => {
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  expect(await screen.findByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("references-running")).toBeNull();
  expect(screen.getByTestId("references-trophies")).toBeInTheDocument();
});

test("Läuft gerade: Heute im Einsatz mit Fortschritt, Termin, Platz und Link; die anderen darunter", async () => {
  running = { today: "2026-11-09", items: [CUP, LEAGUE] };
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  const today = await screen.findByTestId("references-today");
  const card = within(today).getByTestId("running-card-probe-cup-2026");
  expect(card).toHaveAttribute("href", "/references/series/probe-cup/2026");
  expect(card).toHaveTextContent("1 von 4 Terminen");
  expect(within(card).getByTestId("running-next")).toHaveTextContent("Heute, 20:00 Uhr · Q2");
  expect(within(card).getByTestId("running-place")).toHaveTextContent("2. von 12");
  expect(within(card).getByTestId("running-today-badge")).toBeInTheDocument();
  expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

  const list = screen.getByTestId("references-running-list");
  const league = within(list).getByTestId("running-card-probe-liga-2026");
  expect(league).toHaveTextContent("0 von 8 Terminen");
  expect(within(league).getByTestId("running-next")).toHaveTextContent("23.11. · ST1");
  expect(within(league).getByTestId("running-place")).toHaveTextContent("Noch offen");
  expect(within(league).queryByTestId("running-today-badge")).toBeNull();
  expect(within(today).queryByTestId("running-card-probe-liga-2026")).toBeNull();
  // Reihenfolge: Bereich steht vor der Vitrine.
  expect(screen.getByTestId("references-running").compareDocumentPosition(screen.getByTestId("references-trophies")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("Läuft gerade: ein fehlgeschlagener Abruf blendet den Bereich aus", async () => {
  apiMock.get.mockImplementation((url) => (url === "/reference-series/public/running" ? Promise.reject(new Error("x")) : Promise.resolve({ data: { items: ITEMS, summary: SUMMARY } })));
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  expect(await screen.findByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("references-running")).toBeNull();
});

test("drei Zahlen, Chips aus den Feldern, Einträge mit eigener Platzierung und Profil-Link", async () => {
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  expect(await screen.findByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.getByTestId("references-stat-total")).toHaveTextContent("2");
  expect(screen.getByTestId("references-stat-podiums")).toHaveTextContent("1");
  expect(screen.getByTestId("references-stat-gold")).toHaveTextContent("1");
  expect(screen.getByTestId("references-stat-silver")).toHaveTextContent("0");

  // Vitrine (#1334): nur der Podestplatz steht dort - als Pokal in seinem Metall, mit Platz, Wettbewerb und Feldgröße.
  const trophies = screen.getByTestId("references-trophies");
  expect(trophies).toHaveTextContent("1 Podestplatz");
  expect(screen.getByTestId("reference-trophy-r1")).toHaveTextContent("1. PlatzWinter CupCall of Duty");
  expect(screen.getByTestId("reference-trophy-r1").querySelector("svg")).toHaveAttribute("data-medal", "gold");
  expect(screen.getByTestId("reference-trophy-r1")).toHaveAttribute("href", "/references/r1");
  expect(trophies.querySelector("img")).toBeNull();
  expect(screen.queryByTestId("reference-trophy-r2")).toBeNull();

  // Bilanz je Spiel: Teilnahmen und Podestplätze je Spiel.
  expect(screen.getByTestId("references-game-g1")).toHaveTextContent("1 Teilnahme");
  expect(screen.getByTestId("references-game-g1")).toHaveTextContent("1× Podest");
  expect(screen.getByTestId("references-game-g2")).not.toHaveTextContent("Podest");

  // Zeitleiste (#1748): nach Jahr gruppiert; ohne Datum landen beide Teilnahmen unter „Ohne Datum“.
  expect(screen.getByTestId("references-timeline-none")).toHaveTextContent("Ohne Datum");
  expect(screen.getByTestId("references-timeline-none")).toHaveTextContent("2 Teilnahmen");

  const chips = screen.getByTestId("reference-chips-r1");
  expect(chips).toHaveTextContent("PlayStation");
  expect(chips).toHaveTextContent("HC");
  expect(chips).toHaveTextContent("Liga X");
  expect(chips).toHaveTextContent("Season 3");

  const gold = screen.getByTestId("reference-entry-e1");
  expect(gold).toHaveTextContent("1.");
  expect(gold).toHaveTextContent("Einzel");
  expect(gold.querySelector('a[href="/members/anni"]')).toBeInTheDocument();
  expect(screen.getByTestId("reference-entry-e2")).toHaveTextContent("4.");
  expect(screen.getByTestId("reference-entry-e2")).toHaveTextContent("von 32");

  const team = screen.getByTestId("reference-entry-e3");
  expect(team).toHaveTextContent("Team");
  expect(team).toHaveTextContent("LION A");
  expect(team).toHaveTextContent("Dabei");
  expect(team).toHaveTextContent("Gast");
});

test("Jahres-Filter (#1748) und Podest-Filter wirken je Teilnahme bzw. je Eintrag", async () => {
  const third = { ...ITEMS[1], id: "r3", title: "Altes Turnier", display_title: "Altes Turnier", start_date: null };
  apiMock.get.mockResolvedValue({ data: { items: [{ ...ITEMS[0], start_date: "2026-02-01" }, { ...ITEMS[1], start_date: "2025-11-15" }, third], summary: SUMMARY } });
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  await screen.findByTestId("reference-card-r1");
  // Die Chips folgen der Gruppierung: Alle Jahre, neuestes Jahr zuerst, „Ohne Datum“ am Ende - keine Freitext-Saisons.
  const filters = screen.getByTestId("references-filters");
  expect(filters.textContent).toMatch(/Alle Jahre.*2026.*2025.*Ohne Datum/);
  expect(screen.queryByText("Alle Saisons")).toBeNull();
  expect(screen.queryByTestId("references-season-Season 2")).toBeNull();
  // Die Saison bleibt als Text auf der Karte.
  expect(screen.getByTestId("reference-chips-r1")).toHaveTextContent("Season 3");

  fireEvent.click(screen.getByTestId("references-year-2025"));
  expect(screen.queryByTestId("reference-card-r1")).toBeNull();
  expect(screen.queryByTestId("reference-card-r3")).toBeNull();
  expect(screen.getByTestId("reference-card-r2")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("references-year-none"));
  expect(screen.getByTestId("reference-card-r3")).toBeInTheDocument();
  expect(screen.queryByTestId("reference-card-r2")).toBeNull();

  fireEvent.click(screen.getByText("Alle Jahre"));
  fireEvent.click(screen.getByText("Podest"));
  expect(screen.getByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("reference-card-r2")).toBeNull();
});

test("die Spiel-Kachel filtert die Zeitleiste und lässt sich zurücksetzen", async () => {
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  await screen.findByTestId("reference-card-r1");
  fireEvent.click(screen.getByTestId("references-game-g2"));
  expect(screen.queryByTestId("reference-card-r1")).toBeNull();
  expect(screen.getByTestId("reference-card-r2")).toBeInTheDocument();
  // Die Trophäenwand bleibt vom Filter unberührt - sie ist die Erfolgsbilanz des Vereins.
  expect(screen.getByTestId("reference-trophy-r1")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("references-reset"));
  expect(screen.getByTestId("reference-card-r1")).toBeInTheDocument();
});

test("Partner II (#469): eine Referenz nennt ihren Partner mit Link auf die Partnerseite", async () => {
  apiMock.get.mockResolvedValue({ data: { items: [{ ...ITEMS[0], partners: [{ id: "p1", slug: "pineapps-esports", name: "PineApps eSports" }] }, ITEMS[1]], summary: SUMMARY } });
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  expect(await screen.findByTestId("reference-partner-pineapps-esports")).toHaveAttribute("href", "/partners/pineapps-esports");
});

test("aus dem Mitgliederprofil (#859): nur die Teilnahmen dieser Person, Chip mit Namen hebt den Filter auf", async () => {
  const onlyBennyInR2 = { ...ITEMS[1], entries: [{ ...ITEMS[1].entries[0], lineup_members: [{ profile_id: "p2", display_name: "Benny" }] }] };
  apiMock.get.mockResolvedValue({ data: { items: [ITEMS[0], onlyBennyInR2], summary: SUMMARY } });
  render(<MemoryRouter initialEntries={["/references?member=p1&name=Anni"]}><ReferencesPage /></MemoryRouter>);
  expect(await screen.findByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("reference-card-r2")).toBeNull();
  expect(screen.getByTestId("references-member")).toHaveTextContent("Nur Anni");
  expect(screen.getByTestId("references-timeline")).toHaveTextContent("1 von 2");
  // Die Karte zeigt den eigenen Eintrag dieser Person - wie im Profil -, nicht die ganze Teilnahme.
  const own = screen.getByTestId("reference-card-r1");
  expect(within(own).getByTestId("reference-entry-e1")).toBeInTheDocument();
  expect(within(own).queryByTestId("reference-entry-e2")).toBeNull();
  fireEvent.click(screen.getByTestId("references-member"));
  expect(await screen.findByTestId("reference-card-r2")).toBeInTheDocument();
  expect(screen.queryByTestId("references-member")).toBeNull();
});

// ---------------------------------------------------------------- Jahr für Jahr (#1748)

const at = (id, start_date, extra = {}) => ({ id, start_date, ...extra });
const keysOf = (groups) => groups.map((group) => [group.key, group.items.map((item) => item.id)]);

test("Zeitleiste nach Jahr (#1748): neuestes Jahr zuerst, ohne Datum am Ende, innerhalb neu vor alt", () => {
  const groups = timelineGroups([
    at("a", "2024-05-01"), at("b", null), at("c", "2026-03-01"), at("d", "2026-09-01"), at("e", ""),
  ]);
  expect(keysOf(groups)).toEqual([["2026", ["d", "c"]], ["2024", ["a"]], ["", ["b", "e"]]]);
  expect(groups.map((group) => group.label)).toEqual(["2026", "2024", "Ohne Datum"]);
});

test("Zeitleiste nach Jahr (#1748): der Jahreswechsel zählt in Wiener Zeit", () => {
  const groups = timelineGroups([
    // 31.12.2025 23:30 UTC ist in Wien schon der 1. Jänner 2026.
    at("utc", "2025-12-31T23:30:00Z"),
    // Ohne Zone meint die Wiener Uhr: noch 2025.
    at("wall", "2025-12-31T23:30:00"),
    // Ein reines Datum bleibt dieser Tag.
    at("day", "2026-01-01"),
  ]);
  expect(keysOf(groups)).toEqual([["2026", ["day", "utc"]], ["2025", ["wall"]]]);
});

test("Zeitleiste nach Jahr (#1748): gleiche Season-Nummer verschiedener Spiele und Jahre landet nicht in einer Gruppe", () => {
  const groups = timelineGroups([
    at("cod", "2025-04-01", { season: "Season 3", game_id: "g1" }),
    at("rl", "2026-04-01", { season: "Season 3", game_id: "g2" }),
    at("rl-old", "2025-10-01", { season: "Season 3", game_id: "g2" }),
  ]);
  expect(keysOf(groups)).toEqual([["2026", ["rl"]], ["2025", ["rl-old", "cod"]]]);
});

test("Zeitleiste nach Jahr (#1748): ein ungültiges Startdatum fällt aufs Enddatum zurück - für Jahr und Reihenfolge", () => {
  const groups = timelineGroups([
    at("early", "2025-02-01"),
    at("broken", "kein Datum", { end_date: "2025-08-01" }),
    at("late", "2025-11-01"),
  ]);
  expect(keysOf(groups)).toEqual([["2025", ["late", "broken", "early"]]]);
});

test("Zeitleiste nach Jahr (#1748): ohne Startdatum zählt das Enddatum, kaputte Daten verschwinden nicht", () => {
  const groups = timelineGroups([at("end", null, { end_date: "2023-06-30" }), at("bad", "kein Datum")]);
  expect(keysOf(groups)).toEqual([["2023", ["end"]], ["", ["bad"]]]);
});

test("Jahr für Jahr auf der Seite (#1748): Jahresköpfe, Medaillenzähler bleibt je Eintrag aus der Bilanz", async () => {
  const dated = [{ ...ITEMS[0], start_date: "2026-02-01" }, { ...ITEMS[1], start_date: "2025-11-15" }];
  // Bilanz wie vom Server, je Eintrag gezählt - die Seite zeigt sie unverändert und rechnet nichts je Teilnahme um.
  apiMock.get.mockResolvedValue({ data: { items: dated, summary: { ...SUMMARY, gold: 2, silver: 1, bronze: 3, podiums: 6 } } });
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  expect(await screen.findByTestId("references-timeline-2026")).toHaveTextContent("2026");
  expect(within(screen.getByTestId("references-timeline-2026")).getByTestId("reference-card-r1")).toBeInTheDocument();
  expect(within(screen.getByTestId("references-timeline-2025")).getByTestId("reference-card-r2")).toBeInTheDocument();
  expect(screen.queryByTestId("references-timeline-none")).toBeNull();
  expect(screen.getByTestId("references-stat-gold")).toHaveTextContent("2");
  expect(screen.getByTestId("references-stat-silver")).toHaveTextContent("1");
  expect(screen.getByTestId("references-stat-bronze")).toHaveTextContent("3");
  expect(screen.getByTestId("references-stat-podiums")).toHaveTextContent("6");
});

test("Spiel-Logo (#1748): mit Logo das Bild; ohne Logo im kleinen Chip der Pokal, das Kürzel erst in der Spiel-Kachel", async () => {
  const withLogo = { ...ITEMS[0], game: { ...ITEMS[0].game, logo_url: "/media/cod.png", short_name: "CoD" } };
  const noLogo = { ...ITEMS[1], game: { ...ITEMS[1].game, short_name: "rl" } };
  apiMock.get.mockResolvedValue({ data: { items: [withLogo, noLogo], summary: SUMMARY } });
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  const logoCard = within(await screen.findByTestId("reference-card-r1")).getByTestId("reference-game-logo");
  expect(logoCard.querySelector("img")).toHaveAttribute("src", "/media/cod.png");
  expect(logoCard).not.toHaveTextContent("COD");
  const codeCard = within(screen.getByTestId("reference-card-r2")).getByTestId("reference-game-logo");
  expect(codeCard.querySelector("img")).toBeNull();
  // Im 20-px-Chip wäre das Kürzel nicht lesbar - und der volle Name steht ohnehin daneben.
  expect(codeCard.textContent).toBe("");
  expect(codeCard.querySelector("svg")).toBeInTheDocument();
  // Die Spiel-Kachel ist groß genug für das Kürzel; mit Logo nimmt sie das Logo.
  expect(within(screen.getByTestId("references-game-g2")).getByTestId("reference-game-logo")).toHaveTextContent("RL");
  expect(within(screen.getByTestId("references-game-g1")).getByTestId("reference-game-logo").querySelector("img")).toHaveAttribute("src", "/media/cod.png");
});

test("Spiel-Kacheln brechen lange Namen um statt sie abzuschneiden (#1812)", async () => {
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  await screen.findByTestId("reference-card-r1");
  for (const id of ["references-game-all", "references-game-g1"]) {
    const name = within(screen.getByTestId(id)).getByTestId("references-game-name");
    expect(name.className).not.toMatch(/line-clamp/);
    expect(name.className).toContain("break-words");
    expect(name.className).not.toMatch(/(^|\s)truncate(\s|$)/);
  }
});
