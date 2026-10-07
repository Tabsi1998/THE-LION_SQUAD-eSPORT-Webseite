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

const ReferencesPage = (await import("./ReferencesPage")).default;

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

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: { items: ITEMS, summary: SUMMARY } });
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

  // Zeitleiste: neueste Saison zuerst.
  const timeline = screen.getByTestId("references-timeline");
  expect(timeline.textContent.indexOf("Season 3")).toBeLessThan(timeline.textContent.indexOf("Season 2"));

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

test("Saison-Filter und Podest-Filter wirken je Teilnahme bzw. je Eintrag", async () => {
  render(<MemoryRouter><ReferencesPage /></MemoryRouter>);
  await screen.findByTestId("reference-card-r1");
  fireEvent.click(screen.getByTestId("references-season-Season 2"));
  expect(screen.queryByTestId("reference-card-r1")).toBeNull();
  expect(screen.getByTestId("reference-card-r2")).toBeInTheDocument();

  fireEvent.click(screen.getByText("Alle Saisons"));
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
