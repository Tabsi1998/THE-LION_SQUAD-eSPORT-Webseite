import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Gelernte Schreibweisen aus Ergebnis-Bildern (#2012): sichtbar beim Teilnehmer (Namen) und bei der Saison (Teams) und
// entfernbar - gespeichert wird mit dem Formular, nur die bleibenden gehen mit. Nur erfundene Namen.

const apiMock = { post: vi.fn(), patch: vi.fn(), get: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));

const { ParticipantEditSheet } = await import("./ParticipantEditSheet");
const { SeriesForm } = await import("./SeriesForm");

beforeEach(() => {
  apiMock.patch.mockReset().mockResolvedValue({ data: {} });
  apiMock.post.mockReset().mockResolvedValue({ data: {} });
  apiMock.get.mockReset().mockResolvedValue({ data: { lineages: [] } });
});

test("beim Teilnehmer: gelernte Schreibweisen sehen und einzeln entfernen", async () => {
  const row = { id: "t1", name: "Anna Probe", link: "external", link_status: "decided",
    read_aliases: [{ name: "Anna Prob3", at: "2026-10-22T08:00:00+00:00" }, { name: "Anna Pr0be", at: "2026-10-22T08:00:00+00:00" }] };
  const onSaved = vi.fn();
  render(<ParticipantEditSheet series={{ id: "serie-1" }} row={row} onClose={() => {}} onSaved={onSaved} />);
  const list = screen.getByTestId("participant-edit-read-aliases");
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Anna Prob3", "Anna Pr0be"]);
  fireEvent.click(within(list).getByRole("button", { name: "„Anna Prob3“ entfernen" }));
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Anna Pr0be"]);
  fireEvent.click(screen.getByTestId("participant-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/participants/t1", { read_aliases: ["Anna Pr0be"] }));
  expect(onSaved).toHaveBeenCalled();
});

test("ohne Änderung geht beim Teilnehmer nichts mit", async () => {
  const row = { id: "t1", name: "Anna Probe", link: "external", link_status: "decided", read_aliases: [{ name: "Anna Prob3" }] };
  const onClose = vi.fn();
  render(<ParticipantEditSheet series={{ id: "serie-1" }} row={row} onClose={onClose} onSaved={() => {}} />);
  fireEvent.click(screen.getByTestId("participant-edit-save"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("bei der Saison: gelernte Team-Schreibweisen sehen und entfernen", async () => {
  const series = { id: "serie-1", season: "2026", status: "active", rules: {},
    read_team_aliases: [{ read: "Rotr Racng", team: "Rotor Racing" }, { read: "Blaupfiel", team: "Blaupfeil GP" }] };
  render(<SeriesForm series={series} lineage={{ id: "spur-1", title: "Probe Rennliga", kind: "racing", series: [] }} onClose={() => {}} onSaved={() => {}} />);
  const list = screen.getByTestId("series-read-team-aliases");
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["„Rotr Racng“ → Rotor Racing", "„Blaupfiel“ → Blaupfeil GP"]);
  fireEvent.click(within(list).getByRole("button", { name: "„Blaupfiel“ entfernen" }));
  fireEvent.click(screen.getByTestId("series-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1", expect.objectContaining({ read_team_aliases: ["Rotr Racng"] })));
});
