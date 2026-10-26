import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Serienseite (#1742, #1745): Kopf, Fortschritt, Gesamtwertung mit gestrichenen Ergebnissen und Finalgrenze, Filter
// „Nur Vereinsspieler“, Finalrechner als Richtwert, Finale als eigene Runde, Termine; nicht indexiert; unbekannt oder
// nicht sichtbar heißt 404, eine alte Adresse führt zur aktuellen. Fremde Namen ohne Link. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", resolveMediaUrl: (value) => (value ? `/api/static${value}` : "") }));
// #1934: Logos laufen über den gemeinsamen Logo-Baustein (SmartLogo) mit resolveMediaUrl - hier als Attrappe.
vi.mock("@/components/tls/SmartLogo", () => ({ SmartLogo: ({ src, className }) => <img data-smart-logo="true" src={src} alt="" className={className} /> }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");
const { SERIES_PROFILE } = await import("@/lib/seriesKinds.fixture");
const { useDocumentTitle } = await import("@/hooks/useDocumentTitle");

function row(key, rank, points, extra = {}) {
  return { key, rank, points, name: `Probe ${key}`, name_hidden: false, club_member: false, profile_slug: null, previous_rank: null, results: [], ...extra };
}

const BODY = {
  lineage: { title: "Probe Cup", slug: "probe-cup", kind: "series", label: "1vs1", organizer: "Probe Liga", game_name: "Probespiel" },
  series: { season: "2026", tier: "Division 1", title: null, season_slug: "2026-division-1", status: "active" },
  rules: { points_mode: "scheme", points_by_place: [10, 8, 6, 4], count_mode: "drop_n", count_n: 1, final_top_n: 2, tiebreakers: ["wins"], bonuses: {}, activity_points: { points: 0 } },
  today: "2026-11-05",
  progress: { total: 3, scored: 2, cancelled: 1, remaining: 1, next: { id: "r3", position: 3, code: "Q3", club_day: "2026-11-12", time: "20:30", state: "planned" } },
  rounds: [
    { id: "r1", position: 1, code: "Q1", club_day: "2026-10-22", time: null, state: "scored", kind: "regular", counts: true },
    { id: "r2", position: 2, code: "Q2", club_day: "2026-10-29", time: null, state: "scored", kind: "regular", counts: true },
    { id: "rx", position: 3, code: "QX", club_day: null, time: null, state: "cancelled", kind: "regular", counts: true },
    { id: "r3", position: 4, code: "Q3", club_day: "2026-11-12", time: "20:30", venue: "Probering", state: "planned", kind: "regular", counts: true },
    { id: "rf", position: 5, code: "FIN", club_day: "2026-11-26", time: null, state: "planned", kind: "final", counts: false, original_club_day: "2026-11-19" },
  ],
  standings: {
    round_id: "r2",
    rows: [
      row("a", 1, 18, { previous_rank: 2, results: [{ round_id: "r1", place: 2, points: 8, counted: true }, { round_id: "r2", place: 1, points: 10, counted: true }] }),
      row("b", 2, 16, { club_member: true, profile_slug: "probe-b", results: [{ round_id: "r1", place: 1, points: 10, counted: true }, { round_id: "r2", place: 3, points: 6, dropped: true }] }),
      row("c", 3, 10, { previous_rank: 1 }),
      row("d", 4, 4, { name: null, name_hidden: true }),
    ],
  },
  final: { round: { id: "rf", code: "FIN", club_day: "2026-11-26", kind: "final" }, rows: [] },
};

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<><ReferenceSeriesPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("Kopf, Fortschritt, Regeln und Termine, nicht indexiert", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026-division-1");
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Probe Cup 2026 · Division 1");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/public/probe-cup/2026-division-1");
  expect(screen.getByText("1vs1 · Probe Liga · Probespiel")).toBeInTheDocument();
  expect(screen.getByTestId("series-progress")).toHaveTextContent("2 von 3 Runden gewertet · 1 abgesagt");
  expect(screen.getByTestId("series-next")).toHaveTextContent("Nächstes Turnier: Q3 · Do., 12.11.2026 · 20:30");
  const rules = screen.getByTestId("series-rules");
  expect(rules).toHaveTextContent("Platz 1 bis 4: 10 · 8 · 6 · 4");
  expect(rules).toHaveTextContent("Ein Streichergebnis");
  expect(rules).toHaveTextContent("mehr Siege");
  expect(rules).toHaveTextContent("Die besten 2 der Gesamtwertung");
  const calendar = screen.getAllByTestId("series-page-round");
  expect(calendar.map((item) => item.dataset.state)).toEqual(["scored", "scored", "cancelled", "planned", "planned"]);
  expect(calendar[4]).toHaveTextContent("ursprünglich Do., 19.11.2026");
  expect(useDocumentTitle).toHaveBeenLastCalledWith("Probe Cup 2026 · Division 1", undefined, { robots: "noindex, follow" });
});

test("Art-Profil (#2024): Turniertage, nächster Turniertag ohne Datum „Termin folgt“, kein Ort", async () => {
  const open = { id: "r4", position: 4, code: "T4", club_day: null, time: "19:00", state: "planned", kind: "regular", counts: true, title: "Probe Halle" };
  apiMock.get.mockResolvedValue({ data: {
    ...BODY, profile: SERIES_PROFILE,
    progress: { total: 9, scored: 2, cancelled: 0, remaining: 7, next: open },
    rounds: [BODY.rounds[0], BODY.rounds[1], { ...open, venue: "Altort" }],
  } });
  renderAt("/references/series/probe-cup/2026-division-1");
  expect(await screen.findByTestId("series-progress")).toHaveTextContent("2 von 9 Turniertagen gewertet");
  expect(screen.getByTestId("series-next")).toHaveTextContent("Nächster Turniertag: T4 · Termin folgt · 19:00");
  const calendar = screen.getAllByTestId("series-page-round");
  expect(calendar[2]).toHaveTextContent("Termin folgt · 19:00");
  expect(calendar[2]).toHaveTextContent("Probe Halle");
  expect(calendar[2]).not.toHaveTextContent("Altort");
});

test("Art-Profil (#2024): Gesamtwertung einer Turnierserie spricht von Turniertagen", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, profile: SERIES_PROFILE } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const rows = within(await screen.findByTestId("series-table")).getAllByTestId("series-row");
  expect(within(rows[0]).getByRole("img", { name: "1 Platz hinauf seit dem Turniertag davor" })).toBeInTheDocument();
});

test("Art-Profil (#2024): ohne Ergebnis „nach dem ersten gewerteten Turniertag“", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, profile: SERIES_PROFILE, standings: null } });
  renderAt("/references/series/probe-cup/2026-division-1");
  expect(await screen.findByTestId("series-no-table")).toHaveTextContent("die Tabelle erscheint nach dem ersten gewerteten Turniertag.");
});

test("Tabelle: gestrichene Ergebnisse, Bewegung, Finalgrenze; fremde Namen ohne Link", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026-division-1");
  const table = await screen.findByTestId("series-table");
  const rows = within(table).getAllByTestId("series-row");
  expect(rows).toHaveLength(4);
  // Der Name ist der Zeilenkopf - Screenreader lesen ihn zu jeder Zelle der Zeile.
  expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["Probe a", "Probe bVerein", "Probe c", "Name ausgeblendet"]);
  expect(within(rows[0]).getByRole("rowheader")).toHaveAttribute("scope", "row");
  // Spalten: Wertungsrunden ohne Finale, die abgesagte durchgestrichen.
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["#", "Name", "Q1", "Q2", "QX", "Q3", "Pkt"]);
  // Gestrichen: blass und für Screenreader benannt.
  expect(within(rows[1]).getByText("Q2: 6 Punkte, Platz 3, gestrichen")).toBeInTheDocument();
  expect(rows[1].querySelector("[data-dropped='true']")).not.toBeNull();
  expect(rows[0].querySelector("[data-dropped='true']")).toBeNull();
  // Bewegung seit der Runde davor.
  expect(within(rows[0]).getByRole("img", { name: "1 Platz hinauf seit der Runde davor" })).toBeInTheDocument();
  expect(within(rows[2]).getByRole("img", { name: "2 Plätze hinunter seit der Runde davor" })).toBeInTheDocument();
  // Finalgrenze nach Platz 2.
  const cut = within(table).getByTestId("series-cutline");
  expect(cut).toHaveTextContent("Finalgrenze · Top 2");
  expect(rows[1].nextElementSibling).toBe(cut);
  // Nur das Vereinsmitglied verlinkt, Fremde sind Text, ein ausgeblendeter Name bleibt ausgeblendet.
  expect(within(table).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/members/probe-b"]);
  expect(within(rows[0]).queryByRole("link")).toBeNull();
  expect(rows[3]).toHaveTextContent("Name ausgeblendet");
  expect(rows[1]).toHaveAttribute("data-club", "true");
});

test("Filter „Nur Vereinsspieler“ zeigt nur Vereinsspieler mit ihrem echten Rang", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026-division-1");
  const toggle = await screen.findByTestId("series-filter-club");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  const rows = within(screen.getByTestId("series-table")).getAllByTestId("series-row");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent("2");
  expect(rows[0]).toHaveTextContent("Probe b");
});

test("Handy: Karten mit den ersten zehn und Vereinsspielern, volle Tabelle aufklappbar", async () => {
  const many = Array.from({ length: 13 }, (_, index) => row(`p${index + 1}`, index + 1, 100 - index, { club_member: index === 11 }));
  apiMock.get.mockResolvedValue({ data: { ...BODY, standings: { round_id: "r2", rows: many } } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const cards = await screen.findByTestId("series-cards");
  expect(within(cards).getAllByTestId("series-card")).toHaveLength(11);
  fireEvent.click(within(cards).getByTestId("series-expand"));
  expect(within(cards).getAllByTestId("series-card")).toHaveLength(13);
  expect(within(cards).queryByTestId("series-expand")).toBeNull();
});

test("Finalrechner: als Richtwert gekennzeichnet, für den gewählten Spieler", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026-division-1");
  const calc = await screen.findByTestId("series-final-calc");
  expect(calc).toHaveTextContent("Richtwert");
  // Vorgewählt: das Vereinsmitglied (Platz 2, innerhalb).
  expect(within(calc).getByTestId("series-final-calc-result")).toHaveTextContent("Innerhalb der Finalgrenze – 6 Punkte vor Platz 3.");
  // Ein ausgeblendeter Name steht nicht in der Auswahl.
  expect(within(calc).getAllByRole("option").map((option) => option.textContent)).toEqual(["1. Probe a", "2. Probe b", "3. Probe c"]);
  fireEvent.change(within(calc).getByTestId("series-final-calc-select"), { target: { value: "c" } });
  expect(within(calc).getByTestId("series-final-calc-result")).toHaveTextContent("Bis zur Finalgrenze fehlen 6 Punkte: etwa 6 in der letzten offenen Runde.");
});

test("Finale als eigene Runde: erst der Termin, dann die Endplatzierung mit Podest", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  const { unmount } = renderAt("/references/series/probe-cup/2026-division-1");
  expect(await screen.findByTestId("series-final")).toHaveTextContent("Die Endplatzierung steht hier nach dem Finale.");
  unmount();
  const final = { ...BODY.final, rows: [
    { key: "b", place: 1, name: "Probe b", club_member: true }, { key: "a", place: 2, name: "Probe a" },
    { key: "d", place: 3, name: null, name_hidden: true },
  ] };
  apiMock.get.mockResolvedValue({ data: { ...BODY, final } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const rows = await screen.findAllByTestId("series-final-row");
  expect(rows.map((item) => item.textContent)).toEqual(["1. (Gold)Probe bVerein", "2. (Silber)Probe a", "3. (Bronze)Name ausgeblendet"]);
});

test("ohne Ergebnisse: Hinweis statt Tabelle, kein Rechner", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, standings: null, final: null } });
  renderAt("/references/series/probe-cup/2026-division-1");
  expect(await screen.findByTestId("series-no-table")).toBeInTheDocument();
  expect(screen.queryByTestId("series-final-calc")).toBeNull();
  expect(screen.queryByTestId("series-final")).toBeNull();
});

test("eine alte Adresse führt zur aktuellen", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/references/series/probe-cup/2026-division-1"));
});

test("unbekannt oder nicht sichtbar: 404", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 404 } });
  renderAt("/references/series/gibt-es/nicht");
  expect(await screen.findByTestId("not-found")).toBeInTheDocument();
});


// ---------------------------------------------------------------- Partner (#1934)
test("Kopf: Veranstaltet von mit Original-Logo und Link, Mitwirkende darunter", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, partners: {
    organizers: [{ id: "p1", slug: "probe-ananas", name: "Probe Ananas", logo_url: "/uploads/ananas.png", role: "organizer" }],
    contributors: [{ id: "p2", slug: "probe-kokos", name: "Probe Kokos", logo_url: null, role: "contributor" },
      { id: "p3", slug: "probe-mango", name: "Probe Mango", logo_url: null, role: "contributor" }],
  } } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const organizers = await screen.findByTestId("series-organizers");
  expect(organizers).toHaveTextContent("Veranstaltet von");
  const host = screen.getByTestId("series-organizer-probe-ananas");
  expect(host).toHaveAttribute("href", "/partners/probe-ananas");
  expect(host).toHaveTextContent("Probe Ananas");
  const logo = host.querySelector("img[data-smart-logo]");
  expect(logo).toHaveAttribute("src", "/api/static/uploads/ananas.png");
  expect(logo.className).not.toMatch(/grayscale|invert|brightness|opacity/);
  expect(screen.getByTestId("series-contributors")).toHaveTextContent("Mit Probe Kokos · Probe Mango");
  expect(screen.getByTestId("series-contributor-probe-mango")).toHaveAttribute("href", "/partners/probe-mango");
});

test("Kopf ohne Partner bleibt wie bisher", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, partners: { organizers: [], contributors: [] } } });
  renderAt("/references/series/probe-cup/2026-division-1");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByTestId("series-partners")).toBeNull();
  expect(screen.queryByTestId("series-data-source")).toBeNull();
});

// Partner-Plattform (#1964): „Daten von …“ mit Link zur Partnerseite, ohne gewählten Partner zur Plattform.
test("Hinweis „Daten von …“: mit Partner zur Partnerseite, sonst zur Plattform in neuem Tab", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, data_source: { provider: "PineApps", url: "https://tft.pineapps.at",
    partner: { id: "p-ananas", slug: "probe-ananas", name: "Probe Ananas" } } } });
  const { unmount } = renderAt("/references/series/probe-cup/2026-division-1");
  const hint = await screen.findByTestId("series-data-source");
  expect(hint).toHaveTextContent("Daten von Probe Ananas");
  expect(within(hint).getByRole("link", { name: "Probe Ananas" })).toHaveAttribute("href", "/partners/probe-ananas");
  unmount();
  apiMock.get.mockResolvedValue({ data: { ...BODY, data_source: { provider: "PineApps", url: "https://tft.pineapps.at", partner: null } } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const plain = await screen.findByTestId("series-data-source");
  expect(plain).toHaveTextContent("Daten von PineApps");
  const link = within(plain).getByRole("link", { name: /PineApps/ });
  expect(link).toHaveAttribute("href", "https://tft.pineapps.at");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

// Map-Pool der Saison (#1616): als Karten mit Bild unter dem Rest der Seite - ohne Pool kein Abschnitt.
test("der Map-Pool der Saison steht mit seinen Maps auf der Seite", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, map_pool: { id: "p1", version: 1, origin: "reference_series",
    modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "nebel", name: "Nebelwerk", image_url: null }] }] } } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const pool = await screen.findByTestId("map-pool");
  expect(within(pool).getByRole("heading", { level: 2 })).toHaveTextContent("Map-Pool");
  expect(within(pool).getByText("Nebelwerk")).toBeInTheDocument();
});

test("ohne Map-Pool kein Abschnitt", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, map_pool: null } });
  renderAt("/references/series/probe-cup/2026-division-1");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByTestId("map-pool")).not.toBeInTheDocument();
});

test("Original-Bilder des Veranstalters (#1933): „Original ansehen“ am Termin mit öffentlichen Bildern", async () => {
  const picture = { id: "o1", kind: "table", url: "/api/reference-series/public/probe-cup/2026-division-1/originals/o1", width: 1200, height: 800 };
  apiMock.get.mockResolvedValue({ data: { ...BODY, originals: { r2: [picture] } } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const calendar = await screen.findAllByTestId("series-page-round");
  expect(within(calendar[0]).queryByTestId("series-page-round-originals")).toBeNull();
  const button = within(calendar[1]).getByTestId("series-page-round-originals");
  fireEvent.click(button);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Original-Bilder: Q2");
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Tabelle");
});