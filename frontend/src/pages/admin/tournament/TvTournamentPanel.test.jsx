import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { play, singleElimination } from "../../../../e2e/fixtures/tvBrackets.mjs";

// Beim Turnier (Meilenstein 60): „Pause bis“ (#1123) nur beim Status „Pausiert“, als Uhrzeit heute (oder morgen, wenn
// sie schon vorbei ist); der Sponsor je Runde (#1125) nur aus den Sponsoren mit „TV / Anzeige“.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { PauseUntilControl, RoundSponsorsPanel, pauseUntilFromClock } = await import("./TvTournamentPanel");

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: [{ id: "sp1", name: "Pixelwerk", logo_url: "/a.png" }, { id: "sp2", name: "Morgenrot", logo_url: "/b.png" }] });
  apiMock.put.mockResolvedValue({ data: {} });
});

test("„14:30“ ist heute um 14:30 in Wien - ist das schon vorbei, morgen", () => {
  const now = Date.parse("2026-10-10T14:00:00+02:00");
  expect(pauseUntilFromClock("14:30", now)).toBe("2026-10-10T12:30:00.000Z");
  expect(pauseUntilFromClock("13:59", now)).toBe("2026-10-11T11:59:00.000Z");
  expect(pauseUntilFromClock("kaputt", now)).toBeNull();
});

test("„Pause bis“ nur beim Status „Pausiert“; speichern und „ohne Uhrzeit“", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  const { rerender } = render(<PauseUntilControl tournament={{ id: "t1", status: "live" }} onSaved={onSaved} />);
  expect(screen.queryByTestId("admin-tr-pause-until")).not.toBeInTheDocument();
  rerender(<PauseUntilControl tournament={{ id: "t1", status: "paused", paused_until: "2026-10-10T12:30:00Z" }} onSaved={onSaved} />);
  const input = screen.getByTestId("admin-tr-pause-until-input");
  expect(input).toHaveValue("14:30");
  await user.clear(input);
  await user.type(input, "15:00");
  await user.click(screen.getByTestId("admin-tr-pause-until-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/tournaments/t1/pause", { paused_until: expect.stringMatching(/T1[34]:00:00\.000Z$/) }));
  await user.click(screen.getByTestId("admin-tr-pause-until-clear"));
  await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith("/tournaments/t1/pause", { paused_until: null }));
  expect(onSaved).toHaveBeenCalled();
});

test("Sponsor je Runde: nur TV-Sponsoren zur Wahl, gespeichert wird je Runde ein Eintrag", async () => {
  const user = userEvent.setup();
  const bracket = singleElimination(8);
  play(bracket, ["A"]);
  const tournament = { id: "t1", round_sponsors: [{ stage_id: "stage-1", section: "WB", round: 1, sponsor_id: "sp1" }] };
  render(<MemoryRouter><RoundSponsorsPanel tournament={tournament} matches={bracket.matches_v2} stages={bracket.stages} /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/sponsors?placement=tv"));
  const roundTwo = await screen.findByTestId("admin-tr-round-sponsor-stage-1::WB::2");
  expect(roundTwo).toHaveTextContent("Runde 2");
  expect(screen.getByTestId("admin-tr-round-sponsors-save")).toBeDisabled();
  await user.selectOptions(roundTwo.querySelector("select"), "sp2");
  await user.click(screen.getByTestId("admin-tr-round-sponsors-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/tournaments/t1/round-sponsors", {
    items: [
      { stage_id: "stage-1", section: "WB", round: 1, sponsor_id: "sp1" },
      { stage_id: "stage-1", section: "WB", round: 2, sponsor_id: "sp2" },
    ],
  }));
});

// Doppel-K.-o., wie die Leitung ihn schreibt (#1792): Die Loser-Runden tragen die Nummer ihrer Zeit; der Server nennt sie
// im Baum fortlaufend (`round_label`).
const DOUBLE_WITH_LOSER = [
  { id: "a", match_key: "A", stage_id: "s1", section: "WB", round: 1, round_name: "Runde 1", round_label: "Runde 1", slots: [] },
  { id: "c", match_key: "C", stage_id: "s1", section: "WB", round: 2, round_name: "Finale", round_label: "Finale", slots: [] },
  { id: "la", match_key: "LA", stage_id: "s1", section: "LB", round: 2, round_name: "Runde 2", round_label: "Loser Runde 1", slots: [] },
  { id: "lb", match_key: "LB", stage_id: "s1", section: "LB", round: 3, round_name: "Runde 3", round_label: "Loser Runde 2", slots: [] },
  { id: "gf", match_key: "FINAL", stage_id: "s1", section: "GF", round: 4, round_name: "Grand Final", round_label: "Grand Final", slots: [] },
];

test("Rundensponsoren heißen wie im Baum - auch im Loser Bracket (#1947)", async () => {
  render(<MemoryRouter><RoundSponsorsPanel tournament={{ id: "t1" }} matches={DOUBLE_WITH_LOSER} stages={[{ id: "s1", name: "Cup" }]} /></MemoryRouter>);
  const loserOne = await screen.findByTestId("admin-tr-round-sponsor-s1::LB::2");
  expect(loserOne).toHaveTextContent("Loser Runde 1");
  expect(loserOne).not.toHaveTextContent("Runde 2");
  expect(screen.getByTestId("admin-tr-round-sponsor-s1::LB::3")).toHaveTextContent("Loser Runde 2");
  expect(screen.getByTestId("admin-tr-round-sponsor-s1::GF::4")).toHaveTextContent("Grand Final");
  expect(screen.getByTestId("admin-tr-round-sponsor-s1::WB::2")).toHaveTextContent("Winner Bracket · Finale");
});

test("ohne Sponsor mit „TV / Anzeige“ sagt das Feld, was zu tun ist", async () => {
  apiMock.get.mockResolvedValue({ data: [] });
  const bracket = singleElimination(4);
  render(<MemoryRouter><RoundSponsorsPanel tournament={{ id: "t1" }} matches={bracket.matches_v2} stages={bracket.stages} /></MemoryRouter>);
  expect(await screen.findByTestId("admin-tr-round-sponsors-none")).toHaveTextContent("TV / Anzeige");
});

test("Staffel-Seite (#2262): Sponsor je Spielwoche in Liga-Wörtern, ohne Weg zu „TV & Beamer“", async () => {
  const user = userEvent.setup();
  const bracket = singleElimination(4);
  render(<MemoryRouter><RoundSponsorsPanel tournament={{ id: "t1" }} matches={bracket.matches_v2} stages={bracket.stages} league /></MemoryRouter>);
  expect(await screen.findByTestId("admin-tr-round-sponsors-league")).toHaveTextContent("Spielwoche");
  expect(screen.queryByRole("link", { name: /TV & Beamer/ })).toBeNull();
  const [first] = await screen.findAllByRole("combobox");
  await waitFor(() => expect(first).not.toBeDisabled());
  await user.selectOptions(first, "sp1");
  await user.click(screen.getByTestId("admin-tr-round-sponsors-save"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Spielwoche")));
});
