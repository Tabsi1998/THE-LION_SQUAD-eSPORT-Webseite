import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Folie „Tabelle“ (#2121): 64 Spieler in acht Gruppen passen mit normaler Schrift auf ein Bild; mit großer Schrift
// blättert die Folie je Durchgang weiter, statt Zeilen abzuschneiden. Erfundene Namen.

const apiMock = { get: vi.fn(async () => ({ data: { settings: {} } })) };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));

const { TvScreen } = await import("./TvScreen");
const { TvStandingsSlide } = await import("./TvStandings");

const groups = "abcdefgh".split("").map((key, group) => ({
  group: { id: `g-${key}`, group_key: key },
  standings: Array.from({ length: 8 }, (_, index) => ({
    registration_id: `r-${group}-${index}`, display_name: `Spieler ${group * 8 + index + 1}`, rank: index + 1,
    played: 1, won: 1, drawn: 0, lost: 0, score_diff: 1, points: 3,
  })),
}));

function renderSlide(query, turn = 0) {
  return render(
    <MemoryRouter initialEntries={[`/display/bracket/t1${query}`]}>
      <TvScreen><TvStandingsSlide standings={groups} turn={turn} /></TvScreen>
    </MemoryRouter>,
  );
}

test("acht Gruppen mit normaler Schrift: alle auf einem Bild, ohne S/U/N", async () => {
  renderSlide("");
  const slide = await screen.findByTestId("tv-standings-slide");
  expect(slide.querySelectorAll("[data-testid^='tv-standings-group-']")).toHaveLength(8);
  expect(slide).not.toHaveAttribute("data-page");
  expect(slide).toHaveAttribute("data-compact", "1");
});

test("große Schrift: weniger Gruppen je Bild, der nächste Durchgang zeigt die nächsten", async () => {
  const { unmount } = renderSlide("?text_size=large");
  const slide = await screen.findByTestId("tv-standings-slide");
  expect(slide).toHaveAttribute("data-page", "1/4");
  expect(screen.getByTestId("tv-standings-group-g-a")).toBeInTheDocument();
  expect(screen.queryByTestId("tv-standings-group-g-c")).toBeNull();
  unmount();
  renderSlide("?text_size=large", 1);
  expect((await screen.findByTestId("tv-standings-slide"))).toHaveAttribute("data-page", "2/4");
  expect(screen.getByTestId("tv-standings-group-g-c")).toBeInTheDocument();
});

test("Punktabzug (E.3): am TV steht die Höhe an der Zeile, ohne Abzug nichts", async () => {
  const standings = [{ group: { id: "g-a", group_key: "a" }, standings: [
    { registration_id: "r1", display_name: "Nordlicht", rank: 1, played: 1, won: 1, drawn: 0, lost: 0, score_diff: 1, points: 3 },
    { registration_id: "r2", display_name: "Steinbock", rank: 2, played: 1, won: 1, drawn: 0, lost: 0, score_diff: 1, points: 1, deducted_points: 2 },
  ] }];
  render(
    <MemoryRouter initialEntries={["/display/bracket/t1"]}>
      <TvScreen><TvStandingsSlide standings={standings} turn={0} /></TvScreen>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("tv-deducted-r2")).toHaveTextContent("−2 Punkte Abzug");
  expect(screen.queryByTestId("tv-deducted-r1")).not.toBeInTheDocument();
});

test("Zonen (#1648): am TV dasselbe Symbol wie im Web - hinauf, hinunter, ohne Zone keines", async () => {
  const zoned = [{ ...groups[0], standings: groups[0].standings.map((row, index) => (index === 0 ? { ...row, zone: "promotion" } : index === 7 ? { ...row, zone: "relegation" } : row)) }];
  render(
    <MemoryRouter initialEntries={["/display/bracket/t1"]}>
      <TvScreen><TvStandingsSlide standings={zoned} turn={0} /></TvScreen>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("tv-zone-r-0-0")).toHaveAttribute("data-zone", "promotion");
  expect(screen.getByTestId("tv-zone-r-0-7")).toHaveAttribute("data-zone", "relegation");
  expect(screen.queryByTestId("tv-zone-r-0-3")).toBeNull();
});

test("Nachmeldung (#2422): die Zeile sagt, ab welcher Woche das Team dabei ist", async () => {
  const late = [{ ...groups[0], standings: groups[0].standings.map((row, index) => (index === 7 ? { ...row, late_entry: true, late_from_week: 3 } : row)) }];
  render(
    <MemoryRouter initialEntries={["/display/bracket/t1"]}>
      <TvScreen><TvStandingsSlide standings={late} turn={0} /></TvScreen>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("tv-late-r-0-7")).toHaveTextContent("Nachgemeldet ab Woche 3");
  expect(screen.queryByTestId("tv-late-r-0-6")).toBeNull();
});

test("Schweizer System (#1559): Median-Buchholz als Spalte, „weiter“ und „ausgeschieden“ an der Zeile", async () => {
  const row = (id, rank, extra) => ({ registration_id: id, display_name: `Spieler ${rank}`, rank, played: 3, won: 4 - rank, drawn: 0, lost: rank - 1,
    buchholz: 5, median_buchholz: 2, points: 4 - rank, ...extra });
  render(
    <MemoryRouter initialEntries={["/display/bracket/t1"]}>
      <TvScreen><TvStandingsSlide standings={[row("r1", 1, { swiss_status: "advanced" }), row("r2", 2), row("r3", 3, { swiss_status: "eliminated" }), row("r4", 2, { swiss_status: "tied" })]} /></TvScreen>
    </MemoryRouter>,
  );
  const slide = await screen.findByTestId("tv-standings-slide");
  expect([...slide.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["#", "Name", "Sp", "S", "U", "N", "MBHZ", "BHZ", "Pkt"]);
  expect(screen.getByTestId("tv-swiss-status-r1")).toHaveTextContent("weiter");
  expect(screen.getByTestId("tv-swiss-status-r3")).toHaveTextContent("ausgeschieden");
  expect(screen.queryByTestId("tv-swiss-status-r2")).toBeNull();
  expect(screen.getByTestId("tv-swiss-status-r4")).toHaveTextContent("Gleichstand");
});

// Gastteam (#1665): Am TV steht „Gast“ hinter dem Namen und bleibt sichtbar - gekürzt („…“) wird nur der Name selbst.
test("ein langer Name wird gekürzt, „· Gast“ bleibt außerhalb der Kürzung stehen", async () => {
  const long = "Höhere Technische Bundeslehranstalt Probeberg · Klasse 4B mit sehr langem Namen";
  render(
    <MemoryRouter initialEntries={["/display/bracket/t1"]}>
      <TvScreen><TvStandingsSlide standings={[{ registration_id: "r-g", display_name: long, rank: 1, played: 1, won: 1, drawn: 0, lost: 0,
        score_diff: 1, points: 3, guest_badge: { label: "Gast" } }]} turn={0} /></TvScreen>
    </MemoryRouter>,
  );
  const guest = await screen.findByTestId("tv-guest-r-g");
  expect(guest).toHaveTextContent("Gast");
  const name = guest.closest("td").querySelector(".tv-standings__nametext");
  expect(name).not.toBeNull();
  expect(name).toHaveTextContent(long);
  expect(name.contains(guest)).toBe(false);
});

