import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Ergebnisseite einer Runde (#1950): Hauptrennen als Vorgabe, Reiter in der Adresse, Tabelle wie beim Veranstalter mit
// Abzeichen, Teamfarben und hervorgehobenen Vereinsfahrern, ein Lauf ohne Zeiten ohne leere Spalten, fremde Namen nicht
// in der Zusammenfassung, Zeiten zählen hoch. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceRoundPage } = await import("./ReferenceRoundPage");

const person = (key, name, extra = {}) => ({
  key, name, name_hidden: false, club_member: false, profile_slug: null, own: false, status: "finished", marks: [],
  start_number: null, team: null, team_color: null, grid: null, gained: null, time: null, gap: null, penalty_seconds: null,
  points: null, fastest_lap: false, fastest_lap_time: null, driver_of_the_day: false, ...extra,
});

const QUALI = {
  id: "q1", key: "qualifying", session: "Qualifying", label: "Qualifying", kind: "qualifying", state: "scored",
  club_day: "2026-10-08", time: "20:00", counts: false, has_result: true, columns: ["start_number", "time", "gap"],
  pole: { key: "eins", time: "1:40,474" }, best_club: "eins", original: null,
  rows: [
    person("eins", "Probe Eins", { place: 1, start_number: "1", team: "Probe Löwen", team_color: "#facc15", time: "1:40,474", marks: ["pole"], own: true, club_member: true, profile_slug: "probe-eins" }),
    person("fremd", "Fremd Zwei", { place: 2, start_number: "98", team: "Fremd Rot", team_color: "#ef4444", gap: "+0,261" }),
  ],
};

const RACE = {
  id: "r1", key: "rennen", session: "Rennen", label: "Rennen", kind: "race", state: "scored", club_day: "2026-10-08",
  time: "20:30", counts: true, has_result: true, columns: ["start_number", "grid", "time", "gap", "penalty_seconds", "points"],
  pole: null, best_club: "eins", original: null,
  rows: [
    person("fremd", "Fremd Zwei", { place: 1, start_number: "98", team: "Fremd Rot", team_color: "#ef4444", grid: 2, gained: 1, time: "31:55,056", points: 35, driver_of_the_day: true }),
    person("eins", "Probe Eins", { place: 2, start_number: "1", team: "Probe Löwen", team_color: "#facc15", grid: 1, gained: -1, gap: "+6,197", points: 31, marks: ["fastest_lap", "pole"], fastest_lap: true, fastest_lap_time: "1:43,375", own: true, club_member: true, profile_slug: "probe-eins" }),
    person("drei", "Fremd Drei", { place: 3, start_number: "7", team: "Fremd Blau", gap: "+2 Runden", penalty_seconds: 5, points: 26 }),
    person("vier", null, { place: null, status: "dnf", name_hidden: true, team: "Fremd Blau", points: 0 }),
  ],
};

const PAGE = {
  lineage: { title: "Probe Rennliga", slug: "probe-rennliga", kind: "racing" },
  series: { season: "2026", season_slug: "2026", status: "active" },
  own_teams: ["Probe Löwen"],
  round: { number: 1, total: 3, code: "R1", title: null, venue: "Baku City Circuit", country_code: "AZ", club_day: "2026-10-08" },
  previous: null,
  next: { number: 2, code: "R2", country_code: "SG", venue: "Singapur" },
  sessions: [QUALI, RACE],
  main: "rennen",
  summary: {
    winner: { key: "fremd", session: "rennen", grid: 2 },
    pole: { key: "eins", session: "qualifying", time: "1:40,474" },
    fastest_lap: { key: "eins", session: "rennen", time: "1:43,375" },
    driver_of_the_day: { key: "fremd", session: "rennen" },
  },
  club_drivers: ["eins"],
};

function Where() {
  const location = useLocation();
  return <span data-testid="where">{`${location.pathname}${location.search}`}</span>;
}

function renderAt(path, body = PAGE) {
  apiMock.get.mockResolvedValue({ data: body });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/references/series/:lineageSlug/:seasonSlug/runde/:roundNumber" element={<><ReferenceRoundPage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  apiMock.get.mockReset();
});

test("zeigt das Hauptrennen wie beim Veranstalter - Kopf, Abzeichen, Teamfarbe, Vereinsfahrer hervorgehoben", async () => {
  renderAt("/references/series/probe-rennliga/2026/runde/1");
  expect(await screen.findByTestId("round-head")).toHaveTextContent("Aserbaidschan");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/public/probe-rennliga/2026/rounds/1");
  expect(screen.getByTestId("round-eyebrow")).toHaveTextContent("Runde 1 von 3 · Do., 08.10.2026");
  expect(screen.getByTestId("round-head")).toHaveTextContent("Baku City Circuit");
  expect(screen.getByTestId("round-next")).toHaveAttribute("href", "/references/series/probe-rennliga/2026/runde/2");
  expect(screen.getByTestId("round-prev")).toHaveAttribute("aria-disabled", "true");

  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  const table = screen.getByTestId("round-table");
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(
    ["Pos", "Nr", "Name", "Team", "Start", "Zeit", "Abstand", "Strafe", "Punkte"]);
  const rows = within(table).getAllByTestId("round-row");
  expect(rows).toHaveLength(4);
  expect(rows[1]).toHaveAttribute("data-own", "true");
  expect(within(rows[1]).getByText("Probe Eins").closest("a")).toHaveAttribute("href", "/members/probe-eins");
  expect(within(rows[1]).getAllByTestId("round-badge").map((badge) => badge.textContent)).toEqual(["Pole", "Schnellste Runde"]);
  expect(within(rows[0]).getByText("Fahrer des Tages")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Fremd Rot")).toHaveStyle({ color: "#ef4444" });
  expect(within(rows[1]).getByRole("img", { name: "1 Platz verloren" })).toBeInTheDocument();
  expect(within(rows[2]).getByText("+5 s")).toBeInTheDocument();
  expect(within(rows[2]).getByText("+2 Runden")).toBeInTheDocument();
  expect(within(rows[3]).getByText("DNF")).toBeInTheDocument();
  expect(within(rows[3]).getByText("Name ausgeblendet")).toBeInTheDocument();
  expect(rows[3]).toHaveAttribute("data-out", "true");
  expect(screen.getByTestId("round-own-teams")).toHaveTextContent("Vereinsteams hervorgehoben: Probe Löwen");
  expect(screen.queryByTestId("round-original")).not.toBeInTheDocument();
});

test("die Zusammenfassung nennt fremde Fahrer nur über ihr Team", async () => {
  renderAt("/references/series/probe-rennliga/2026/runde/1");
  const summary = await screen.findByTestId("round-summary");
  expect(within(summary).getByTestId("round-fact-winner")).toHaveTextContent("Fremd Rot");
  expect(within(summary).getByTestId("round-fact-winner")).toHaveTextContent("von Startplatz 2");
  expect(summary).not.toHaveTextContent("Fremd Zwei");
  expect(within(summary).getByTestId("round-fact-pole")).toHaveTextContent("Probe Eins");
  expect(within(summary).getByTestId("round-fact-best_club")).toHaveTextContent("Probe Eins · P2");
  expect(within(summary).getByTestId("round-fact-best_club")).toHaveTextContent("31 Punkte");
});

test("der Reiter steht in der Adresse; das Hauptrennen braucht keinen", async () => {
  renderAt("/references/series/probe-rennliga/2026/runde/1?lauf=qualifying");
  const quali = await screen.findByTestId("round-tab-qualifying");
  expect(quali).toHaveAttribute("aria-selected", "true");
  const table = screen.getByTestId("round-table");
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Pos", "Nr", "Name", "Team", "Zeit", "Abstand"]);
  expect(within(screen.getByTestId("round-summary")).getByTestId("round-fact-best_club")).toHaveTextContent("Bester Vereinsfahrer · Qualifying");
  fireEvent.click(screen.getByTestId("round-tab-rennen"));
  expect(screen.getByTestId("where")).toHaveTextContent("/references/series/probe-rennliga/2026/runde/1");
  expect(screen.getByTestId("where").textContent).not.toContain("lauf=");
  expect(screen.getByTestId("round-panel")).toHaveAttribute("data-session", "rennen");
  // Pfeiltasten wechseln den Reiter.
  fireEvent.keyDown(screen.getByTestId("round-tab-rennen"), { key: "ArrowLeft" });
  expect(screen.getByTestId("round-tab-qualifying")).toHaveFocus();
  expect(screen.getByTestId("where")).toHaveTextContent("?lauf=qualifying");
});

test("ohne Zeiten nur Pos, Name, Team und Punkte - auch am Handy ohne leere Felder", async () => {
  const plain = { ...RACE, columns: ["points"], rows: RACE.rows.map((item) => ({ ...item, time: null, gap: null, grid: null, gained: null, start_number: null, penalty_seconds: null })) };
  renderAt("/references/series/probe-rennliga/2026/runde/1", { ...PAGE, sessions: [plain], summary: { winner: { key: "fremd", session: "rennen" } } });
  const table = await screen.findByTestId("round-table");
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Pos", "Name", "Team", "Punkte"]);
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  const items = within(screen.getByTestId("round-list")).getAllByTestId("round-item");
  expect(items[0]).toHaveTextContent("35 P");
  expect(items[0]).not.toHaveTextContent("–");
});

test("Zeiten zählen beim Öffnen hoch und stehen am Ende genau da", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  // Gezählt wird nur, wenn der Browser zu „Bewegung reduzieren“ Auskunft gibt (#1969) - hier: keine Einschränkung.
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  try {
    renderAt("/references/series/probe-rennliga/2026/runde/1");
    await act(async () => { await Promise.resolve(); });
    const table = screen.getByTestId("round-table");
    const first = within(table).getAllByTestId("round-row")[0];
    expect(first.querySelector("[data-counting='true']")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(first).toHaveTextContent("31:55,056");
    expect(first.querySelector("[data-counting='true']")).toBeNull();
  } finally {
    delete window.matchMedia;
  }
});

test("eine Runde, die es nicht gibt, ist 404", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 404 } });
  render(
    <MemoryRouter initialEntries={["/references/series/probe-rennliga/2026/runde/9"]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug/runde/:roundNumber" element={<ReferenceRoundPage />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("not-found")).toBeInTheDocument();
});

test("ein Lauf ohne Ergebnis sagt, wann es kommt", async () => {
  const planned = { ...RACE, state: "planned", has_result: false, rows: [], columns: [], club_day: "2026-10-22", time: "20:30" };
  renderAt("/references/series/probe-rennliga/2026/runde/1", { ...PAGE, sessions: [QUALI, planned], summary: {} });
  expect(await screen.findByTestId("round-empty")).toHaveTextContent("Noch kein Ergebnis – Rennen am Do., 22.10.2026, 20:30 Uhr.");
});

test("Original-Bilder des Laufs (#1933): „Original ansehen“ öffnet das Vollbild, je Reiter die eigenen", async () => {
  const pictures = [
    { id: "o1", kind: "race", url: "/api/reference-series/public/probe-rennliga/2026/originals/o1", width: 1600, height: 900 },
    { id: "o2", kind: "table", url: "/api/reference-series/public/probe-rennliga/2026/originals/o2", width: 1200, height: 900 },
  ];
  renderAt("/references/series/probe-rennliga/2026/runde/1", { ...PAGE, sessions: [{ ...QUALI, originals: [] }, { ...RACE, originals: pictures }] });
  const button = await screen.findByTestId("round-original");
  expect(button).toHaveAccessibleName("Original ansehen, 2 Bilder");
  fireEvent.click(button);
  const viewer = screen.getByRole("dialog");
  expect(viewer).toHaveAccessibleName("Original-Bilder: R1 Aserbaidschan · Rennen");
  expect(within(viewer).getByTestId("original-viewer-label")).toHaveTextContent("Rennen");
  fireEvent.click(within(viewer).getByTestId("original-viewer-close"));
  fireEvent.click(screen.getByTestId("round-tab-qualifying"));
  expect(screen.queryByTestId("round-original")).toBeNull();
});