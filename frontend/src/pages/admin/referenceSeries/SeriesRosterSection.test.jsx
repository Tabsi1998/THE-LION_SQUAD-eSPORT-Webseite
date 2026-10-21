import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Kader je Saison-Team (#1931): je eigenem Team die Spieler (Team der Teilnehmer, auch in anderer Schreibweise),
// „Kader einfügen“ von der Match-Seite und herausnehmen. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeriesRosterSection } = await import("./SeriesRosterSection");

const SERIES = {
  id: "serie-1", lineage: { title: "Probe Liga", kind: "team_league" },
  own_teams: [{ name: "Probe Löwen", aliases: [] }, { name: "Probe Löwen B", aliases: [] }],
};
const PARTICIPANTS = [
  { id: "p-anna", name: "Anna Probe", default_team: "Probe Löwen", kind: "person", link: "member", link_status: "decided" },
  { id: "p-bert", name: "Bert Probe", default_team: "probe-löwen", kind: "person", link: "guest", link_status: "decided" },
  { id: "p-cleo", name: "Cleo Probe", default_team: "Probe Löwen B", kind: "person", link: "external", link_status: "open" },
  { id: "p-dora", name: "Dora Probe", default_team: null, kind: "person", link: "external", link_status: "decided" },
];

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: { participants: PARTICIPANTS, counts: {} } });
  apiMock.post.mockResolvedValue({ data: { created: [{ id: "n1" }], assigned: [{ id: "p-dora" }], skipped: 0 } });
  apiMock.patch.mockResolvedValue({ data: {} });
});

test("je eigenem Team der Kader, auch in anderer Schreibweise; Mitglied, Gast und offen sind erkennbar", async () => {
  render(<SeriesRosterSection series={SERIES} />);
  const teams = await screen.findAllByTestId("roster-team");
  await waitFor(() => expect(within(teams[0]).getAllByTestId("roster-player")).toHaveLength(2));
  expect(within(teams[0]).getAllByTestId("roster-player").map((item) => item.textContent)).toEqual(["Anna ProbeMitglied", "Bert ProbeGast"]);
  expect(within(teams[1]).getByTestId("roster-player")).toHaveTextContent("Cleo Probeoffen");
});

test("Kader einfügen: Namen von der Match-Seite mit Team an den Server, herausnehmen leert das Team", async () => {
  render(<SeriesRosterSection series={SERIES} />);
  const teams = await screen.findAllByTestId("roster-team");
  fireEvent.click(within(teams[0]).getByTestId("roster-paste-open"));
  fireEvent.change(screen.getByTestId("roster-paste-names"), { target: { value: "Seasonteam-Mitglieder\tWarorga\nDora Probe\t✓\nNeu Nina\t" } });
  expect(screen.getByTestId("roster-paste-count")).toHaveTextContent("Dora Probe, Neu Nina");
  fireEvent.click(screen.getByTestId("roster-paste-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/participants/batch",
    { names: ["Dora Probe", "Neu Nina"], team: "Probe Löwen" }));

  await waitFor(() => expect(within(teams[0]).getAllByTestId("roster-remove").length).toBeGreaterThan(0));
  fireEvent.click(within(teams[0]).getAllByTestId("roster-remove")[0]);
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/participants/p-anna", { default_team: null }));
});
