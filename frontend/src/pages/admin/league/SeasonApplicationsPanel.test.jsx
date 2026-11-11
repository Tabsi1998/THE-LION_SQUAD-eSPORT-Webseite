import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Eingang der Leitung (docs/LIGA.md, B.4, #2205): prüfen, annehmen, ablehnen mit Pflichtgrund, Warteliste, Zuteilung. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonApplicationsPanel } = await import("./SeasonApplicationsPanel");

const ROW = {
  id: "a1", status: "submitted", squad_id: "s1", team_id: "t1", display_name: "Loewen · Rudel", submitted_at: "2026-11-02T18:00:00+00:00", applied_by_name: "Mila", rules_version: 2,
  rules_at: "2026-11-02T18:00:00+00:00", privacy_at: "2026-11-02T18:00:00+00:00", member_count: 5, captain_name: "Mila", vice_name: "Tom", problems: [], warnings: [], shared_with: [], own_team: false, history: [{ status: "submitted", at: "2026-11-02T18:00:00+00:00", by_name: "Mila" }],
};
const BODY = {
  configured: true, window: "open", stats: { slots: 8, taken: 1, free: 7, open: 1, waiting: 0, unassigned: 0, full: false },
  items: [ROW],
  divisions: [{ id: "d1", label: "Liga 1", staffeln: [{ tournament_id: "t1", staffel: "A", participant_count: 1, max_participants: 8 }] }],
};

function renderPanel() {
  return render(<MemoryRouter><SeasonApplicationsPanel seasonId="s1" /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
  apiMock.post.mockResolvedValue({ data: {} });
});

test("ohne Fenster und ohne Anträge bleibt der Bereich weg", async () => {
  apiMock.get.mockResolvedValue({ data: { configured: false, items: [], stats: {}, divisions: [] } });
  const { container } = renderPanel();

  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container.querySelector("[data-testid='season-applications']")).toBeNull();
});

test("der Eingang zeigt Zahlen, Zustimmung und Kader", async () => {
  renderPanel();

  expect(await screen.findByTestId("season-applications-stats")).toHaveTextContent("1 von 8 Startplätzen belegt");
  const row = screen.getByTestId("application-a1");
  expect(row).toHaveTextContent("Loewen · Rudel");
  expect(row).toHaveTextContent("Eingereicht");
  expect(row).toHaveTextContent("Regeln Version 2");
  expect(row).toHaveTextContent("Datenschutz zugestimmt");
  expect(row).toHaveTextContent("5 Spieler");
});

test("annehmen und gleich zuteilen", async () => {
  renderPanel();
  await screen.findByTestId("application-a1");

  fireEvent.change(screen.getByTestId("application-staffel-a1"), { target: { value: "t1" } });
  fireEvent.click(screen.getByTestId("application-accept-a1"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/accept", { tournament_id: "t1" }));
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("annehmen ohne Staffel teilt später zu", async () => {
  renderPanel();
  fireEvent.click(await screen.findByTestId("application-accept-a1"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/accept", {}));
});

test("ablehnen verlangt einen Grund, erst dann geht der Knopf", async () => {
  renderPanel();
  fireEvent.click(await screen.findByTestId("application-reject-open-a1"));

  const send = screen.getByTestId("application-reject-send-a1");
  expect(send).toBeDisabled();
  fireEvent.change(screen.getByTestId("application-reason-a1"), { target: { value: "Kader zu klein" } });
  fireEvent.click(send);

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/reject", { reason: "Kader zu klein" }));
});

test("in Prüfung und Warteliste", async () => {
  renderPanel();
  fireEvent.click(await screen.findByTestId("application-review-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/review", {}));
  fireEvent.click(await screen.findByTestId("application-waitlist-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/waitlist", {}));
});

test("ein angenommener Antrag ohne Staffel wird zugeteilt, mit Staffel führt der Link in die Verwaltung", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [
    { ...ROW, id: "a1", status: "accepted" },
    { ...ROW, id: "a2", status: "accepted", squad_id: "s2", assignment: { tournament_id: "t1", label: "Liga 1 · Staffel A" } },
  ] } });
  renderPanel();
  await screen.findByTestId("application-a1");

  fireEvent.change(screen.getByTestId("application-staffel-a1"), { target: { value: "t1" } });
  fireEvent.click(screen.getByTestId("application-assign-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/assign", { tournament_id: "t1" }));

  expect(screen.getByTestId("application-a2")).toHaveTextContent("Liga 1 · Staffel A");
  expect(screen.getByTestId("application-open-staffel-a2")).toHaveAttribute("href", "/admin/tournaments/t1");
  expect(screen.queryByTestId("application-reject-open-a2")).toBeNull();
});

test("Gründe, Warnungen und das eigene Team stehen im Klartext da", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [{ ...ROW, problems: ["Rudel hat 2 Spieler."], warnings: ["Tom: Spiel-ID fehlt."], shared_with: ["Falken · Horst"], own_team: true }] } });
  renderPanel();

  const row = await screen.findByTestId("application-a1");
  expect(row).toHaveTextContent("Rudel hat 2 Spieler.");
  expect(row).toHaveTextContent("Tom: Spiel-ID fehlt.");
  expect(row).toHaveTextContent("Falken · Horst");
  expect(row).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
});

test("offene Punkte je Team stehen da, und die Leitung lässt trotzdem zu (#2313)", async () => {
  const shortfall = "Nur 2 von 5 Spielern sind spielberechtigt, für ein Spiel braucht ein Team mindestens 3. Bis zum ersten Spiel im Profil nachtragen. Sonst kann das Team nicht einchecken und gilt als nicht angetreten – die Liga-Leitung kann das Spiel dann kampflos werten.";
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [{ ...ROW, shortfall, warnings: ["Mila: Geburtsdatum fehlt.", "Tom: Spiel-ID fehlt.", "Ida: Erfüllt die Altersvorgabe dieser Season nicht."] }] } });
  renderPanel();

  const open = await screen.findByTestId("application-open-points-a1");
  expect(open).toHaveTextContent("Offene Punkte · 3 Spieler");
  expect(open).toHaveTextContent("Nur 2 von 5 Spielern");
  expect(open).toHaveTextContent("Zulassen geht trotzdem.");
  expect(screen.queryByTestId("application-problems-a1")).toBeNull();
  fireEvent.click(screen.getByTestId("application-accept-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/accept", {}));
});

// Befangenheit (#2245): Über das eigene Team entscheidet eine zweite Person, der Superadmin nur als Notausnahme mit Grund.
test("beim eigenen Team stehen statt der Knöpfe ein Satz", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [{ ...ROW, own_team: true }, { ...ROW, id: "a2", squad_id: "s2", own_team: false }] } });
  renderPanel();

  expect(await screen.findByTestId("application-own-team-a1")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  for (const id of ["application-accept-a1", "application-review-a1", "application-waitlist-a1", "application-reject-open-a1", "application-staffel-a1", "application-conflict-reason-a1"]) {
    expect(screen.queryByTestId(id)).toBeNull();
  }
  expect(screen.getByTestId("application-accept-a2")).toBeInTheDocument();
  expect(screen.queryByTestId("application-own-team-a2")).toBeNull();
});

test("auch ein angenommener Antrag des eigenen Teams wird nicht selbst zugeteilt", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [{ ...ROW, status: "accepted", own_team: true }] } });
  renderPanel();

  await screen.findByTestId("application-own-team-a1");
  expect(screen.queryByTestId("application-assign-a1")).toBeNull();
});

test("der Superadmin entscheidet beim eigenen Team nur mit Grund für die Notausnahme", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, superadmin: true, items: [{ ...ROW, own_team: true }] } });
  renderPanel();

  const field = await screen.findByTestId("application-conflict-reason-a1");
  expect(screen.getByTestId("application-a1")).toHaveTextContent("Grund für die Notausnahme");
  expect(screen.getByTestId("application-accept-a1")).toBeDisabled();
  expect(screen.getByTestId("application-review-a1")).toBeDisabled();
  fireEvent.change(field, { target: { value: "  Sonst niemand da " } });
  fireEvent.click(screen.getByTestId("application-accept-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/accept", { conflict_reason: "Sonst niemand da" }));

  fireEvent.click(screen.getByTestId("application-reject-open-a1"));
  fireEvent.change(screen.getByTestId("application-reason-a1"), { target: { value: "Kader zu klein" } });
  fireEvent.click(screen.getByTestId("application-reject-send-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/reject", { reason: "Kader zu klein", conflict_reason: "Sonst niemand da" }));
});

test("ohne Bezug zum Team fragt der Eingang den Superadmin nach keinem Grund", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, superadmin: true } });
  renderPanel();

  fireEvent.click(await screen.findByTestId("application-accept-a1"));
  expect(screen.queryByTestId("application-conflict-reason-a1")).toBeNull();
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/accept", {}));
});

test("der Verlauf zeigt eine Notausnahme mit Grund", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [{ ...ROW, status: "in_review", history: [...ROW.history, { status: "in_review", at: "2026-11-03T10:00:00+00:00", by_name: "Chefin", conflict_reason: "Sonst niemand da" }] }] } });
  renderPanel();

  expect(await screen.findByTestId("application-a1")).toHaveTextContent("Notausnahme: Sonst niemand da");
});

test("abgelehnt und zurückgezogen stehen eingeklappt, ohne Knöpfe", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [{ ...ROW, status: "rejected", decision_reason: "Kader zu klein", decided_by_name: "Leitung" }, { ...ROW, id: "a2", status: "withdrawn" }] } });
  renderPanel();

  expect(await screen.findByTestId("season-applications-closed")).toHaveTextContent("Abgeschlossen (2)");
  expect(screen.getByTestId("application-a1")).toHaveTextContent("Kader zu klein");
  expect(screen.queryByTestId("application-accept-a1")).toBeNull();
  expect(screen.queryByTestId("application-reject-open-a2")).toBeNull();
});

test("das Team einer Person der Leitung ist nach automatischer Annahme markiert (#2348)", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [
    { ...ROW, id: "a1", status: "accepted", auto_accepted: true, lead_team_auto: true },
    { ...ROW, id: "a2", squad_id: "s2", status: "accepted", auto_accepted: true, lead_team_auto: false },
  ] } });
  renderPanel();

  expect(await screen.findByTestId("application-lead-team-a1")).toHaveTextContent("Team der Leitung – automatisch angenommen");
  expect(screen.queryByTestId("application-lead-team-a2")).toBeNull();
});

// Automatisch angenommen (#2348): zurückstufen nur mit Grund, eine automatische Zuteilung nehmen Ablehnen und Warteliste wieder heraus.
test("eine automatisch angenommene Anmeldung geht nur mit Grund auf die Warteliste", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [{ ...ROW, status: "accepted", auto_accepted: true, decided_at: "2026-11-02T18:00:00+00:00",
    history: [...ROW.history, { status: "accepted", at: "2026-11-02T18:00:00+00:00", by_name: "automatisch", auto: true }] }] } });
  renderPanel();

  const row = await screen.findByTestId("application-a1");
  expect(screen.getByTestId("application-auto-a1")).toHaveTextContent("Automatisch angenommen 02.11.2026");
  expect(row).toHaveTextContent("Angenommen, automatisch");
  expect(screen.queryByTestId("application-waitlist-a1")).toBeNull();
  fireEvent.click(screen.getByTestId("application-waitlist-open-a1"));
  const send = screen.getByTestId("application-waitlist-send-a1");
  expect(send).toBeDisabled();
  fireEvent.change(screen.getByTestId("application-reason-a1"), { target: { value: "Erst die Kader prüfen" } });
  fireEvent.click(send);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/waitlist", { reason: "Erst die Kader prüfen" }));
});

test("auch eine von Hand angenommene Anmeldung geht nur mit Grund auf die Warteliste, eingereichte mit einem Klick", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [{ ...ROW, id: "a1", status: "accepted" }, { ...ROW, id: "a2", squad_id: "s2" }] } });
  renderPanel();

  await screen.findByTestId("application-a1");
  expect(screen.queryByTestId("application-waitlist-a1")).toBeNull();
  fireEvent.click(screen.getByTestId("application-waitlist-open-a1"));
  expect(screen.getByTestId("application-waitlist-send-a1")).toBeDisabled();
  fireEvent.change(screen.getByTestId("application-reason-a1"), { target: { value: "Platz wird anders gebraucht" } });
  fireEvent.click(screen.getByTestId("application-waitlist-send-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/waitlist", { reason: "Platz wird anders gebraucht" }));
  expect(screen.getByTestId("application-waitlist-a2")).toBeInTheDocument();
});

test("eine automatische Zuteilung lässt sich ablehnen, eine der Leitung nicht", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, items: [
    { ...ROW, id: "a1", status: "accepted", auto_accepted: true, assignment: { tournament_id: "t1", label: "Liga 1 · Staffel A", auto: true } },
    { ...ROW, id: "a2", squad_id: "s2", status: "accepted", assignment: { tournament_id: "t1", label: "Liga 1 · Staffel A" } },
  ] } });
  renderPanel();

  expect(await screen.findByTestId("application-auto-seat-a1")).toHaveTextContent("wieder aus der Staffel");
  expect(screen.queryByTestId("application-assign-a1")).toBeNull();
  expect(screen.queryByTestId("application-staffel-a1")).toBeNull();
  expect(screen.getByTestId("application-waitlist-open-a1")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("application-reject-open-a1"));
  fireEvent.change(screen.getByTestId("application-reason-a1"), { target: { value: "Kader passt nicht" } });
  fireEvent.click(screen.getByTestId("application-reject-send-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications/a1/reject", { reason: "Kader passt nicht" }));
  expect(screen.queryByTestId("application-reject-open-a2")).toBeNull();
});

test("eine Absage des Servers steht als Meldung da, und die Liste lädt neu", async () => {
  apiMock.post.mockRejectedValue({ response: { data: { detail: "Alle Startplätze sind vergeben." } } });
  renderPanel();
  fireEvent.click(await screen.findByTestId("application-accept-a1"));

  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Alle Startplätze sind vergeben."));
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});
