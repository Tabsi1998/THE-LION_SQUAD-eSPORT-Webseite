import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Vereinsplatzierungen im Mitgliederprofil (#859, neu im Referenzen-Design #1944): Kopf nur mit Werten über null, der
// Liga-Weg der Person, die Chronik je Jahr als aufklappbare Liste mit der Platzierung dieser Person. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (value) => [value, { current: null }] }));

const { default: MemberProfilePage } = await import("./MemberProfilePage");

const ANNI = { profile_id: "p1", display_name: "Anni", profile_url: "/members/anni" };
const BENNY = { profile_id: "p2", display_name: "Benny", profile_url: "/members/benny" };

const TEAM_CUP = {
  id: "r1", title: "Winter Cup", display_title: "Winter Cup", organizer: "Probe Cups", game: { id: "g1", display_name: "Rocket League" }, game_id: "g1",
  start_date: "2025-11-15", best_placement: 1, medal: "gold", external_url: "https://cup.example/winter", format: "3vs3", mode: "offline",
  entries: [
    { id: "e1", kind: "team", team_name: "LION A", placement: 1, medal: "gold", member_profile_ids: ["p9"], lineup: ["Gast"], team_count: 12 },
    { id: "e2", kind: "team", team_name: "LION B", placement: 2, medal: "silver", member_profile_ids: ["p1"], lineup_members: [BENNY, ANNI], lineup: ["Gast"], team_count: 12 },
  ],
};
const SOLO_CUP = {
  id: "r2", title: "Herbst Cup", display_title: "Herbst Cup", game: { id: "g2", display_name: "EA FC" }, game_id: "g2", start_date: "2026-02-01",
  best_placement: 3, medal: "bronze", result_url: "https://cup.example/herbst",
  entries: [{ id: "e3", kind: "solo", placement: 3, medal: "bronze", member_profile_ids: ["p1"], lineup_members: [ANNI], participant_count: 20 }],
};
const LEAGUE = {
  id: "r3", title: "SEASON #3 POWERED BY PROBE® NEWCOMER LEAGUE I", display_title: "SEASON #3 POWERED BY PROBE® NEWCOMER LEAGUE I",
  organizer: "PSDL", league: "Newcomer League I", season: "Season 3", game: { id: "g1", display_name: "Rocket League" }, game_id: "g1",
  start_date: "2025-05-19", best_placement: 4, medal: null,
  entries: [{ id: "e4", kind: "team", team_name: "LION B", placement: 4, member_profile_ids: ["p1"], lineup_members: [ANNI, BENNY], team_count: 7 }],
};
const withOwn = (item, index = 0) => ({ ...item, member_entry: item.entries.find((entry) => (entry.member_profile_ids || []).includes("p1")) || item.entries[index] });

const PODIUM_PROFILE = {
  id: "p1", slug: "anni", display_name: "Anni", gamertag: "Anni",
  references: [withOwn(SOLO_CUP), withOwn(TEAM_CUP), withOwn(LEAGUE)],
  reference_stats: { total: 3, gold: 0, silver: 1, bronze: 1, podiums: 2, solo: 1, team: 2 },
};
const NO_PODIUM_PROFILE = {
  ...PODIUM_PROFILE,
  references: [withOwn(LEAGUE), withOwn({ ...LEAGUE, id: "r4", start_date: "2024-09-14", league: "", season: "", display_title: "Club Cup", organizer: "", entries: [{ ...LEAGUE.entries[0], id: "e5", placement: 6 }] })],
  reference_stats: { total: 2, gold: 0, silver: 0, bronze: 0, podiums: 0, solo: 0, team: 2 },
};
const LINEAGES = {
  items: [{
    lineage: { title: "PSDL 3vs3", slug: "psdl", kind: "team_league", organizer: "PSDL", tier_order: null },
    seasons: [
      { season: "Season 3", tier: "Newcomer League I", season_slug: "s3-newcomer", status: "completed", season_result: "promoted", club: { rank: 4, of: 7 }, reference_ids: ["r3"] },
      { season: "Season 4", tier: "League A", season_slug: "s4-league-a", status: "completed", club: { rank: 3, of: 8 }, reference_ids: ["r1"] },
      { season: "Season 5", tier: "League A", season_slug: "s5-league-a", status: "active", club: null, reference_ids: [] },
    ],
  }],
};

let profileData;
let lineageData;
beforeEach(() => {
  profileData = PODIUM_PROFILE;
  lineageData = { items: [] };
  apiMock.get.mockImplementation((url) => {
    if (url === "/reference-series/public/lineages") return Promise.resolve({ data: lineageData });
    return Promise.resolve({ data: profileData });
  });
});

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={["/members/anni"]}>
      <Routes><Route path="/members/:slug" element={<MemberProfilePage />} /></Routes>
    </MemoryRouter>,
  );
}

// Profile ohne Platzhaltertexte (#1268): ohne Biografie fehlt der Absatz einfach.
test("ohne Biografie kein Platzhaltertext", async () => {
  profileData = { ...PODIUM_PROFILE, bio: "" };
  renderProfile();
  expect(await screen.findByTestId("member-references")).toBeInTheDocument();
  expect(screen.queryByText(/Noch keine Biografie/)).toBeNull();
});

// ---------------------------------------------------------------- Kopf

test("Kopf mit Podest: nur die vorhandenen Medaillen, dazu Teilnahmen, Spiele und „seit“ - keine Nullen", async () => {
  renderProfile();
  const section = await screen.findByTestId("member-references");
  expect(apiMock.get).toHaveBeenCalledWith("/membership/profiles/anni");
  expect(within(section).getByText("Vereinsplatzierungen")).toBeInTheDocument();
  // „Alle Referenzen“ filtert die Referenzen-Seite auf diese Person.
  expect(screen.getByTestId("member-references-all")).toHaveAttribute("href", "/references?member=p1&name=Anni");
  expect(screen.queryByTestId("member-reference-medal-gold")).toBeNull();
  expect(screen.getByTestId("member-reference-medal-silver")).toHaveTextContent("1Silber");
  expect(screen.getByTestId("member-reference-medal-bronze")).toHaveTextContent("1Bronze");
  expect(screen.queryByTestId("member-reference-best")).toBeNull();
  const facts = screen.getByTestId("member-reference-facts");
  expect(facts).toHaveTextContent("3Teilnahmen");
  expect(facts).toHaveTextContent("2Spiele");
  expect(facts).toHaveTextContent("seit 2025für den Verein");
  // Die alten Kacheln „0 Gold“ und die Zeile „0 Podestplätze“ gibt es nicht mehr.
  expect(section).not.toHaveTextContent(/\b0\s*(Gold|Podestplätze|als Einzelstarter)/);
});

test("Kopf ohne Podest: „Bestes Ergebnis“ mit Platz, Serie bzw. Liga, Monat und „von N Teams“", async () => {
  profileData = NO_PODIUM_PROFILE;
  renderProfile();
  const best = await screen.findByTestId("member-reference-best");
  expect(within(best).getByTestId("placement-badge")).toHaveTextContent("4.");
  expect(best).toHaveTextContent("Bestes Ergebnis");
  expect(best).toHaveTextContent("PSDL · Newcomer League I");
  expect(best).toHaveTextContent("Mai 2025 · von 7 Teams");
  expect(screen.queryByTestId("member-reference-medal-gold")).toBeNull();
  expect(screen.queryByTestId("member-reference-medal-silver")).toBeNull();
  expect(screen.getByTestId("member-reference-facts")).toHaveTextContent("2Teilnahmen");
  expect(screen.getByTestId("member-reference-facts")).toHaveTextContent("1Spiel");
});

// ---------------------------------------------------------------- Chronik

test("Chronik je Jahr: Zeile mit eigenem Platz, kurzem Titel (langer im Tooltip), Spiel, Team mit „von N Teams“ und Datum", async () => {
  renderProfile();
  const year2026 = await screen.findByTestId("member-references-year-2026");
  expect(year2026).toHaveTextContent("1 Teilnahme");
  const year2025 = screen.getByTestId("member-references-year-2025");
  expect(year2025).toHaveTextContent("2 Teilnahmen");

  // Im Team: Platz 2 des eigenen Teams - nicht der Sieg des anderen Vereinsteams.
  const team = screen.getByTestId("member-reference-row-r1");
  expect(within(team).getByTestId("placement-badge")).toHaveAttribute("data-medal", "silver");
  expect(team).toHaveTextContent("Winter Cup");
  expect(team).toHaveTextContent("Rocket League");
  expect(team).toHaveTextContent("LION B");
  expect(team).toHaveTextContent("von 12 Teams");
  expect(team).toHaveTextContent("15.11.2025");

  const solo = screen.getByTestId("member-reference-row-r2");
  expect(within(solo).getByTestId("placement-badge")).toHaveAttribute("data-medal", "bronze");
  expect(solo).toHaveTextContent("Einzelstarter");
  expect(solo).toHaveTextContent("von 20 Teilnehmern");

  const league = screen.getByTestId("member-reference-row-r3");
  const title = within(league).getByTestId("member-reference-title");
  expect(title).toHaveTextContent(/^PSDL · Newcomer League I · Season 3$/);
  expect(title).toHaveAttribute("title", "SEASON #3 POWERED BY PROBE® NEWCOMER LEAGUE I");
  expect(title.className).toMatch(/break-words|overflow-wrap/);
  expect(title.className).not.toMatch(/(^|\s)(truncate|line-clamp)/);
});

test("Details klappen auf: Format, Aufstellung mit der Person hervorgehoben, Beim Veranstalter - immer nur eine Zeile offen", async () => {
  renderProfile();
  // Die neueste Teilnahme steht offen, die übrigen zu.
  const newest = await screen.findByTestId("member-reference-row-r2");
  expect(newest).toHaveAttribute("aria-expanded", "true");
  const team = screen.getByTestId("member-reference-row-r1");
  expect(team).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByTestId("member-reference-details-r1")).toBeNull();

  fireEvent.click(team);
  expect(team).toHaveAttribute("aria-expanded", "true");
  expect(newest).toHaveAttribute("aria-expanded", "false");
  const details = screen.getByTestId("member-reference-details-r1");
  expect(team).toHaveAttribute("aria-controls", details.id);
  expect(details).toHaveTextContent("3vs3");
  expect(details).toHaveTextContent("Vor Ort");
  const people = within(details).getAllByTestId("member-reference-person");
  expect(people.map((person) => person.textContent)).toEqual(["Benny", "Anni", "Gast"]);
  expect(people[1]).toHaveAttribute("data-self", "true");
  expect(people[0]).toHaveAttribute("data-self", "false");
  expect(people[0]).toHaveAttribute("href", "/members/benny");
  // Links: Details (Bericht, Partner, Ort auf der Detailseite), dann Beim Veranstalter; ohne Saison kein „Saison ansehen“.
  const links = within(screen.getByTestId("member-reference-links-r1")).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual(["Details", "Beim Veranstalter"]);
  expect(links[0]).toHaveAttribute("href", "/references/r1");
  expect(links[1]).toHaveAttribute("href", "https://cup.example/winter");
  // Ohne Daten kein „X von Y Spielen“.
  expect(details).not.toHaveTextContent(/von \d+ Spielen/);

  fireEvent.click(team);
  expect(team).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByTestId("member-reference-details-r1")).toBeNull();
});

test("auch ohne weitere Angaben klappt jede Zeile auf - mindestens mit „Details“ zur Referenz", async () => {
  const bare = { ...SOLO_CUP, id: "r9", result_url: null, start_date: "2026-03-01" };
  profileData = { ...PODIUM_PROFILE, references: [withOwn(bare), ...PODIUM_PROFILE.references] };
  renderProfile();
  const row = await screen.findByTestId("member-reference-row-r9");
  expect(row.tagName).toBe("BUTTON");
  expect(row).toHaveAttribute("aria-expanded", "true");
  const links = within(screen.getByTestId("member-reference-links-r9")).getAllByRole("link");
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["Details", "/references/r9"]]);
});

test("der lange Veranstalter-Titel steht in den Details", async () => {
  renderProfile();
  fireEvent.click(await screen.findByTestId("member-reference-row-r3"));
  expect(screen.getByTestId("member-reference-details-r3")).toHaveTextContent("SEASON #3 POWERED BY PROBE® NEWCOMER LEAGUE I");
});

// ---------------------------------------------------------------- Saison und Liga-Weg

test("mit Saison: Liga-Weg der Person mit ihrem Platz und Vermerk, Link zur Serie, in den Details „Saison ansehen“", async () => {
  lineageData = LINEAGES;
  profileData = { ...PODIUM_PROFILE, references: PODIUM_PROFILE.references.map((item) => (item.id === "r3" ? { ...item, external_url: "https://psdl.example/s3" } : item)) };
  renderProfile();
  const path = await screen.findByTestId("member-path-psdl");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/public/lineages");
  expect(path).toHaveTextContent("Liga-Weg · PSDL 3vs3");
  const steps = within(path).getAllByTestId("member-path-step");
  // Nur die Saisons der Person mit ihrem eigenen Platz - die laufende Saison ohne sie fehlt.
  expect(steps.map((step) => step.textContent)).toEqual(["Season 3Newcomer League I4. · Aufstieg", "Season 4League A2. Platz"]);
  expect(within(path).getByRole("link", { name: "Zur Serie" })).toHaveAttribute("href", "/references/series/psdl/s5-league-a");

  fireEvent.click(screen.getByTestId("member-reference-row-r3"));
  // Reihenfolge: Saison ansehen, Details, Beim Veranstalter.
  const links = within(screen.getByTestId("member-reference-links-r3")).getAllByRole("link");
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Saison ansehen", "/references/series/psdl/s3-newcomer"],
    ["Details", "/references/r3"],
    ["Beim Veranstalter", "https://psdl.example/s3"],
  ]);
});

test("nur eine Saison der Spur: kein Liga-Weg, die Zeile führt trotzdem zur Saison", async () => {
  const [lineage] = LINEAGES.items;
  lineageData = { items: [{ ...lineage, seasons: lineage.seasons.map((season) => ({ ...season, reference_ids: season.reference_ids.filter((id) => id === "r3") })) }] };
  renderProfile();
  fireEvent.click(await screen.findByTestId("member-reference-row-r3"));
  const links = screen.getByTestId("member-reference-links-r3");
  expect(await within(links).findByRole("link", { name: "Saison ansehen" })).toHaveAttribute("href", "/references/series/psdl/s3-newcomer");
  expect(screen.queryByTestId("member-paths")).toBeNull();
});

test("ohne verknüpfte Saison kein Liga-Weg; fällt der Abruf aus, bleibt die Liste", async () => {
  apiMock.get.mockImplementation((url) => {
    if (url === "/reference-series/public/lineages") return Promise.reject(new Error("aus"));
    return Promise.resolve({ data: profileData });
  });
  renderProfile();
  expect(await screen.findByTestId("member-reference-row-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("member-paths")).toBeNull();
});

test("ohne Teilnahmen kein leerer Block und kein Abruf der Spuren", async () => {
  profileData = { ...PODIUM_PROFILE, references: [], reference_stats: {} };
  renderProfile();
  expect(await screen.findByText("Anni", { selector: "h1" })).toBeInTheDocument();
  expect(screen.queryByTestId("member-references")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalledWith("/reference-series/public/lineages");
});

// Lange Namen (#1218): höchstens zwei Zeilen, ein Name ab 16 Zeichen eine Schriftstufe kleiner, der ganze Name bleibt lesbar.
test("ein Name mit 24 Zeichen kommt eine Stufe kleiner, ein kurzer Name nicht", async () => {
  profileData = { ...PODIUM_PROFILE, gamertag: "NachtfalkeDerSuperliga24", references: [], reference_stats: {} };
  const { unmount } = renderProfile();
  const long = await screen.findByTestId("member-head-name");
  expect(long).toHaveTextContent("NachtfalkeDerSuperliga24");
  expect(long).toHaveAttribute("title", "NachtfalkeDerSuperliga24");
  expect(long.className).toContain("tls-head-name tls-head-name--long");
  expect(long.className).toContain("text-4xl md:text-6xl");
  unmount();
  profileData = { ...PODIUM_PROFILE, references: [], reference_stats: {} };
  renderProfile();
  const short = await screen.findByTestId("member-head-name");
  expect(short.className).toContain("tls-head-name");
  expect(short.className).not.toContain("tls-head-name--long");
  expect(short.className).toContain("text-5xl md:text-7xl");
});
