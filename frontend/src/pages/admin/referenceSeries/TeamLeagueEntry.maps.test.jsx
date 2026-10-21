import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Maps im Ergebnisblatt der Team-Liga (#1616 an #1931): Auswahl aus dem Map-Pool der Saison mit Bild, Zuordnung eines
// getippten Namens über Schreibweisen, unbekannte Namen gelb markiert (bleiben Freitext), ohne Spiel nur Freitext. Nur
// erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler"), resolveMediaUrl: (url) => url || "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResultEntrySheet } = await import("./ResultEntrySheet");

const SERIES = { id: "serie-1", lineage: { title: "Probe Liga", kind: "team_league" }, access: { role: "board", can_publish: true } };
const CHOICES = {
  source: "pool", game: { id: "g1", name: "Probe Shooter" }, pool_version: 2,
  modes: [
    { mode: "snd", label: "Suchen & Zerstören", maps: [
      { map_id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: "/api/static/uploads/hafen.webp", aliases: ["Harbour Edge"] },
      { map_id: "nebel", slug: "nebelwerk", name: "Nebelwerk", image_url: null, aliases: [] },
    ] },
  ],
};

function data(choices = CHOICES) {
  return {
    round: { id: "st1", code: "ST1", club_day: "2026-06-10", opponent: "Probe Falken", at_home: true },
    series: { id: "serie-1", kind: "team_league", team_name: "Probe Löwen", own_teams: ["Probe Löwen"],
      own_team_list: [{ name: "Probe Löwen", aliases: [] }], rules: { points_mode: "organizer" }, map_choices: choices },
    access: { role: "board", can_publish: true }, version: 0, target: "sheet", participants: [],
    sheet: { status: "draft", matches: [{ home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 0, maps: [], lineup: [] }] },
  };
}

async function openSheet(body = data()) {
  apiMock.get.mockResolvedValue({ data: body });
  apiMock.post.mockResolvedValue({ data: { version: 0, target: "sheet", can_save: true, errors: [], warnings: [], rows: [], matches: [], unknown_names: [] } });
  render(<ResultEntrySheet series={SERIES} round={body.round} onClose={() => {}} onSaved={() => {}} />);
  return screen.findByTestId("result-team-league");
}

async function payload() {
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  return apiMock.post.mock.calls.at(-1)[1];
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
});

test("der Map-Pool der Saison steht je Modus mit Bild da – ein Klick setzt die Map ins Veto", async () => {
  await openSheet();
  const strip = screen.getByTestId("result-map-pool");
  expect(within(strip).getByText("Suchen & Zerstören")).toBeInTheDocument();
  expect(strip.querySelector("img")).toHaveAttribute("src", "/api/static/uploads/hafen.webp");
  fireEvent.click(within(strip).getByRole("button", { name: "Hafenkante ins Veto" }));
  fireEvent.click(within(strip).getByRole("button", { name: "Nebelwerk ins Veto" }));
  expect(screen.getAllByTestId("result-map-name").map((input) => input.value)).toEqual(["Hafenkante", "Nebelwerk"]);
  fireEvent.change(screen.getAllByTestId("result-map-role")[0], { target: { value: "banned:own" } });
  fireEvent.change(screen.getAllByTestId("result-map-home")[0], { target: { value: "6" } });
  fireEvent.change(screen.getAllByTestId("result-map-away")[0], { target: { value: "3" } });
  const maps = (await payload()).matches[0].maps;
  // Der Modus aus dem Pool geht mit - der Server prüft die Map genau in diesem Modus.
  expect(maps.map((item) => [item.name, item.map_id, item.mode, item.role || ""])).toEqual([["Hafenkante", "hafen", "snd", "banned"], ["Nebelwerk", "nebel", "snd", ""]]);
});

test("ein getippter Name findet die Map über ihre Schreibweise, ein unbekannter wird gelb markiert und bleibt", async () => {
  await openSheet();
  fireEvent.click(screen.getByTestId("result-map-add"));
  const input = screen.getByTestId("result-map-name");
  fireEvent.change(input, { target: { value: "harbour edge" } });
  expect(screen.getByTestId("result-map-thumb")).toBeInTheDocument();
  fireEvent.blur(input);
  expect(input).toHaveValue("Hafenkante");

  fireEvent.click(screen.getByTestId("result-map-add"));
  const second = screen.getAllByTestId("result-map-name")[1];
  fireEvent.change(second, { target: { value: "Karte Unbekannt" } });
  expect(screen.getByTestId("result-map-unknown")).toHaveTextContent("Nicht im Map-Pool");
  expect(second).toHaveAttribute("data-unknown", "true");
  fireEvent.change(screen.getAllByTestId("result-map-home")[1], { target: { value: "6" } });
  fireEvent.change(screen.getAllByTestId("result-map-away")[1], { target: { value: "2" } });
  fireEvent.change(screen.getAllByTestId("result-map-home")[0], { target: { value: "6" } });
  fireEvent.change(screen.getAllByTestId("result-map-away")[0], { target: { value: "4" } });
  const maps = (await payload()).matches[0].maps;
  expect(maps.map((item) => [item.name, item.map_id || null])).toEqual([["Hafenkante", "hafen"], ["Karte Unbekannt", null]]);
});

test("ohne Spiel der Spur: kein Pool, keine Markierung – Freitext wie bisher", async () => {
  await openSheet(data(null));
  expect(screen.queryByTestId("result-map-pool")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("result-map-add"));
  fireEvent.change(screen.getByTestId("result-map-name"), { target: { value: "Karte Unbekannt" } });
  expect(screen.queryByTestId("result-map-unknown")).not.toBeInTheDocument();
});
