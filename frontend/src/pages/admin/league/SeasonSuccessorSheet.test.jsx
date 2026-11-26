import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Neue Season aus …“ (F.2, #1627) mit den Startrechten der neuen Season (docs/LIGA.md „F.2a“): automatisch dabei oder mit Zusage.
// Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonSuccessorSheet } = await import("./SeasonSuccessorSheet");

const DEFAULTS = { mode: "accept", accept_days: 14, successor: "next", remind_hours: 48, announce: true };
const PREVIEW = {
  season: { id: "s1", name: "Season 1" }, can_create: true, problems: [], successor: null, suggested: { number: 2, name: "Season 2" },
  copied: ["Spielbetrieb"], dates_to_set: ["Beginn der ersten Spielwoche"], map_pool: null, loadout_bans: null, rules: { kind: "none" },
  divisions: [{ level: 1, label: "Liga 1", zones_label: "1 steigt ab", capacity: null,
    teams: [{ squad_id: "q1", display_name: "Rudel Eins · Eins", movement: "stay", from_label: "Liga 1", from_staffel: "A", rank: 1 }] }],
  capacity_hints: [], dropped: [], carried: 1, relegation_note: "",
};
const ANSWER = { data: { ok: true, replay: false, carried: 1, notified: 2, season: { id: "s2", name: "Season 2" } } };

beforeEach(() => {
  for (const mock of [apiMock.get, apiMock.post, toastMock.success, toastMock.error]) mock.mockReset();
  apiMock.post.mockResolvedValue(ANSWER);
});

const open = async (startRights) => {
  apiMock.get.mockResolvedValue({ data: { ...PREVIEW, ...(startRights === undefined ? {} : { start_rights: startRights }) } });
  render(<MemoryRouter><SeasonSuccessorSheet season={{ id: "s1", name: "Season 1" }} onClose={() => {}} onCreated={() => {}} /></MemoryRouter>);
  await screen.findByTestId("successor-team-q1");
  fireEvent.change(screen.getByTestId("successor-start"), { target: { value: "2027-01-05" } });
};

test("ohne Einstellung bleibt es bei „automatisch dabei“ - das Anlegen schickt nichts zu Startrechten", async () => {
  await open({ settings: null, defaults: DEFAULTS });
  expect(screen.getByTestId("successor-rights-accept")).not.toBeChecked();
  expect(screen.getByTestId("successor-teams-note")).toHaveTextContent("Die Teams sind automatisch dabei");
  expect(screen.queryByTestId("successor-rights-days")).toBeNull();
  fireEvent.click(screen.getByTestId("successor-create"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(apiMock.post.mock.calls[0][1]).not.toHaveProperty("start_rights");
});

test("mit Zusage: Frist und Nachrückerregel gehen als Einstellung der neuen Season mit", async () => {
  await open({ settings: { ...DEFAULTS, accept_days: 10 }, defaults: DEFAULTS });
  expect(screen.getByTestId("successor-rights-accept")).toBeChecked();
  expect(screen.getByTestId("successor-rights-days")).toHaveValue(10);
  expect(screen.getByTestId("successor-teams-note")).toHaveTextContent("Die Teams bekommen ein Startrecht und sagen innerhalb von 10 Tagen zu");
  fireEvent.change(screen.getByTestId("successor-rights-days"), { target: { value: "7" } });
  fireEvent.change(screen.getByTestId("successor-rights-successor"), { target: { value: "lead" } });
  fireEvent.click(screen.getByTestId("successor-create"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/successor", expect.objectContaining({
    confirm: true, start_rights: { mode: "accept", accept_days: 7, successor: "lead", remind_hours: 48, announce: true } })));
});

test("einschalten im Blatt nimmt die Vorgaben, ausschalten einer vorhandenen Einstellung heißt „automatisch“", async () => {
  await open({ settings: null, defaults: DEFAULTS });
  fireEvent.click(screen.getByTestId("successor-rights-accept"));
  expect(screen.getByTestId("successor-rights-days")).toHaveValue(14);
  fireEvent.click(screen.getByTestId("successor-create"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/successor", expect.objectContaining({
    start_rights: { mode: "accept", accept_days: 14, successor: "next", remind_hours: 48, announce: true } })));
});

test("eine vorhandene Einstellung mit Zusage lässt sich für die neue Season abschalten", async () => {
  await open({ settings: { ...DEFAULTS, accept_days: 10 }, defaults: DEFAULTS });
  fireEvent.click(screen.getByTestId("successor-rights-accept"));
  fireEvent.click(screen.getByTestId("successor-create"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/successor", expect.objectContaining({
    start_rights: { mode: "auto", accept_days: 10, successor: "next", remind_hours: 48, announce: true } })));
});

test("kennt der Server keine Startrechte, steht nichts davon im Blatt", async () => {
  await open(undefined);
  expect(screen.queryByTestId("successor-rights-accept")).toBeNull();
  fireEvent.click(screen.getByTestId("successor-create"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(apiMock.post.mock.calls[0][1]).not.toHaveProperty("start_rights");
});
