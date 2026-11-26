import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a“): Einstellung, Übersicht mit Frist, Zusage eintragen, Nachrücken.
// Nur erfundene Namen.
const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonStartRightsPanel } = await import("./SeasonStartRightsPanel");

const DEFAULTS = { mode: "accept", accept_days: 14, successor: "next", remind_hours: 48, announce: true };
const OFF = { active: false, settings: null, defaults: DEFAULTS, predecessor: null, paused: false, started: false, superadmin: false, counts: {}, rows: [], open_places: [] };
const row = (id, name, extra = {}) => ({
  application_id: id, squad_id: `s-${id}`, display_name: name, division_level: 1, division_label: "Liga 1", movement: "stay", from_label: "Liga 1",
  from_staffel: "A", rank: 1, state: "offered", accept_until: "2026-12-15T17:00:00+00:00", accepted_at: null, accepted_via: null, fills: null,
  filled_by: null, own_team: false, ...extra,
});
const ON = {
  ...OFF, active: true, settings: { ...DEFAULTS, accept_days: 10 }, predecessor: { id: "s1", name: "Season 1" },
  counts: { offered: 1, accepted: 1, expired: 1 },
  rows: [
    row("a1", "Rudel Eins · Eins"),
    row("a2", "Rudel Zwei · Eins", { state: "accepted", accept_until: null, accepted_at: "2026-12-02T10:00:00+00:00", accepted_via: "team", rank: 2 }),
    row("a3", "Rudel Drei · Eins", { state: "expired", accept_until: null, movement: "up", from_label: "Liga 2", rank: 1 }),
    row("a4", "Rudel Vier · Eins", { division_level: 2, division_label: "Liga 2", from_label: "Liga 2", rank: 2 }),
  ],
  open_places: [{ application_id: "a3", display_name: "Rudel Drei · Eins", division_label: "Liga 1", division_level: 1, why: "expired", group: "non_promoted",
    pick: "a4", tied: [], candidates: [{ application_id: "a4", display_name: "Rudel Vier · Eins", from_label: "Liga 2", from_staffel: "A", rank: 2, own_team: false }] }],
};

beforeEach(() => {
  for (const mock of [apiMock.get, apiMock.put, apiMock.post, toastMock.success, toastMock.error]) mock.mockReset();
});

const show = (data, props = {}) => {
  apiMock.get.mockResolvedValue({ data });
  return render(<SeasonStartRightsPanel seasonId="s2" canSeason canApplications {...props} />);
};

test("ohne Einstellung ist alles wie bisher - ein Schalter, keine Übersicht", async () => {
  show(OFF);
  const section = await screen.findByTestId("season-start-rights");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s2/start-rights");
  expect(screen.getByTestId("start-rights-active")).not.toBeChecked();
  expect(section).toHaveTextContent("Aus: Co-Teams aus der Vorgänger-Season sind automatisch dabei");
  expect(screen.queryByTestId("start-rights-mode")).toBeNull();
  expect(screen.queryByTestId("start-rights-rows")).toBeNull();
});

test("einschalten und speichern schickt die Einstellung mit ganzen Zahlen", async () => {
  show(OFF);
  fireEvent.click(await screen.findByTestId("start-rights-active"));
  expect(screen.getByTestId("start-rights-mode")).toHaveValue("accept");
  fireEvent.change(screen.getByTestId("start-rights-days"), { target: { value: "7" } });
  fireEvent.change(screen.getByTestId("start-rights-successor"), { target: { value: "lead" } });
  apiMock.put.mockResolvedValue({ data: { ...OFF, active: true, settings: { ...DEFAULTS, accept_days: 7, successor: "lead" } } });
  fireEvent.click(screen.getByTestId("start-rights-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s2/start-rights",
    { active: true, mode: "accept", accept_days: 7, successor: "lead", remind_hours: 48, announce: true }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Startrechte gespeichert."));
});

test("die Übersicht zeigt je Co-Team den Stand mit Frist - Zusage ist nicht Teilnahme", async () => {
  show(ON);
  const rows = await screen.findByTestId("start-rights-rows");
  expect(screen.getByTestId("start-rights-counts")).toHaveTextContent("1 Zusage offen · 1 zugesagt · 1 verfallen");
  expect(within(rows).getByTestId("start-right-a1")).toHaveTextContent("Zusage offen");
  expect(within(rows).getByTestId("start-right-a1")).toHaveTextContent("bis 15.12.2026, 18:00 Uhr");
  expect(within(rows).getByTestId("start-right-a2")).toHaveTextContent("Zugesagt");
  expect(within(rows).getByTestId("start-right-a3")).toHaveTextContent("Verfallen");
  expect(within(rows).getByTestId("start-right-a3")).toHaveTextContent("Aufstieg · Liga 2 · Staffel A, Platz 1");
  // Nur ein offenes Startrecht hat den Knopf „Zusage eintragen“.
  expect(screen.getByTestId("start-right-accept-a1")).toBeInTheDocument();
  expect(screen.queryByTestId("start-right-accept-a2")).toBeNull();
});

test("Zusage eintragen verlangt einen Grund", async () => {
  show(ON);
  fireEvent.click(await screen.findByTestId("start-right-accept-a1"));
  const confirm = await screen.findByTestId("start-right-accept-confirm");
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByTestId("start-right-accept-reason"), { target: { value: "Zusage am Telefon" } });
  apiMock.post.mockResolvedValue({ data: row("a1", "Rudel Eins · Eins", { state: "accepted" }) });
  fireEvent.click(confirm);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s2/start-rights/a1/accept", { reason: "Zusage am Telefon" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Zusage eingetragen. Das Team bekommt eine Nachricht."));
});

test("ein freier Platz nennt den Vorschlag, Nachrücken geht mit Grund", async () => {
  show(ON);
  const place = await screen.findByTestId("start-right-place-a3");
  expect(place).toHaveTextContent("Liga 1: Platz von Rudel Drei · Eins frei (Frist verfallen). Nach der Regel rückt Rudel Vier · Eins nach – der beste Nicht-Aufsteiger.");
  fireEvent.click(screen.getByTestId("start-right-fill-a3"));
  const confirm = await screen.findByTestId("start-right-fill-confirm");
  expect(screen.getByTestId("start-right-fill-candidate-a4")).toBeChecked();
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByTestId("start-right-fill-reason"), { target: { value: "Platz 2 rückt nach" } });
  apiMock.post.mockResolvedValue({ data: row("a4", "Rudel Vier · Eins") });
  fireEvent.click(confirm);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s2/start-rights/a3/fill", { candidate_id: "a4", reason: "Platz 2 rückt nach" }));
});

test("über das eigene Team entscheidet eine andere Person", async () => {
  show({ ...ON, rows: [row("a1", "Rudel Eins · Eins", { own_team: true })], open_places: [] });
  fireEvent.click(await screen.findByTestId("start-right-accept-a1"));
  expect(await screen.findByTestId("start-right-accept-own-team")).toBeInTheDocument();
  expect(screen.getByTestId("start-right-accept-confirm")).toBeDisabled();
});

test("wird der Endstand des Vorgängers geprüft, sagt die Übersicht das - und nachrücken wartet", async () => {
  show({ ...ON, paused: true });
  expect(await screen.findByTestId("start-rights-paused")).toHaveTextContent("Season 1 ist wieder geöffnet");
  expect(screen.getByTestId("start-rights-paused")).toHaveTextContent("niemand rückt nach");
  expect(screen.queryByTestId("start-right-fill-a3")).toBeNull();
});

test("in der Pause sagt die Übersicht, dass die Fristen ruhen und sich verlängern, und die Zeile nennt keine Frist", async () => {
  show({ ...ON, paused: true, rows: [row("a1", "Rudel Eins · Eins", { accept_until: null, paused: true })], open_places: [] });
  expect(await screen.findByTestId("start-rights-paused")).toHaveTextContent("Die Fristen stehen still und laufen danach um die Dauer der Pause länger. Zusagen geht weiter");
  expect(screen.getByTestId("start-right-a1")).toHaveTextContent("Frist ruht");
  expect(screen.getByTestId("start-right-a1")).not.toHaveTextContent("Zusage bis");
});

test("ist das Startdatum erreicht, sagt die Übersicht, dass nichts mehr von selbst geschieht - die Leitung trägt die Zusage ein", async () => {
  show({ ...ON, started: true, rows: [row("a1", "Rudel Eins · Eins", { waits_for_lead: true })] });
  expect(await screen.findByTestId("start-rights-started")).toHaveTextContent("Das Startdatum ist erreicht: Ab jetzt verfällt kein Startrecht mehr von selbst, und niemand rückt automatisch nach.");
  expect(screen.getByTestId("start-right-a1")).toHaveTextContent("Frist vorbei – jetzt entscheidest du");
  expect(screen.getByTestId("start-right-accept-a1")).toBeInTheDocument();
  expect(screen.queryByTestId("start-right-fill-a3")).toBeNull();
});

test("Umschalten auf „automatisch“ fragt im Panel nach, bevor offene Startrechte als zugesagt gelten", async () => {
  show({ ...ON, open_rights: 3 });
  fireEvent.change(await screen.findByTestId("start-rights-mode"), { target: { value: "auto" } });
  fireEvent.click(screen.getByTestId("start-rights-save"));
  // Erst die Rückfrage - gespeichert ist noch nichts.
  const box = await screen.findByTestId("start-rights-confirm-open");
  expect(box).toHaveTextContent("3 offene Startrechte gelten dann als zugesagt und brauchen keine Zusage mehr.");
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("start-rights-confirm-cancel"));
  expect(screen.queryByTestId("start-rights-confirm-open")).toBeNull();
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("start-rights-save"));
  apiMock.put.mockResolvedValue({ data: { ...ON, settings: { ...ON.settings, mode: "auto" }, open_rights: 0 } });
  fireEvent.click(await screen.findByTestId("start-rights-confirm-yes"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s2/start-rights",
    { active: true, mode: "auto", accept_days: 10, successor: "next", remind_hours: 48, announce: true, confirm_open: true }));
  await waitFor(() => expect(screen.queryByTestId("start-rights-confirm-open")).toBeNull());
});

test("ohne offene Startrechte speichert Umschalten ohne Rückfrage", async () => {
  show({ ...ON, open_rights: 0 });
  fireEvent.change(await screen.findByTestId("start-rights-mode"), { target: { value: "auto" } });
  apiMock.put.mockResolvedValue({ data: { ...ON, settings: { ...ON.settings, mode: "auto" } } });
  fireEvent.click(screen.getByTestId("start-rights-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s2/start-rights",
    { active: true, mode: "auto", accept_days: 10, successor: "next", remind_hours: 48, announce: true }));
  expect(screen.queryByTestId("start-rights-confirm-open")).toBeNull();
});

test("ohne „Season konfigurieren“ ist die Einstellung nur zu lesen, ohne „Anmeldungen“ gibt es keine Knöpfe", async () => {
  show(ON, { canSeason: false, canApplications: false });
  expect(await screen.findByTestId("start-rights-readonly")).toBeInTheDocument();
  expect(screen.queryByTestId("start-rights-save")).toBeNull();
  expect(screen.queryByTestId("start-right-accept-a1")).toBeNull();
  expect(screen.queryByTestId("start-right-fill-a3")).toBeNull();
});
