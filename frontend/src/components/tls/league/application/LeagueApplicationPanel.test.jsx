import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Ligaseite (docs/LIGA.md, B.4, #2205): Fenster und Plätze für alle, Knopf und Status nur für Berechtigte. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const authMock = { current: null };
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => ({ user: authMock.current }) }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { LeagueApplicationPanel } = await import("./LeagueApplicationPanel");

const BLOCK = { state: "open", opens_at: "2026-11-01T17:00:00+00:00", closes_at: "2026-11-20T19:00:00+00:00", slots: 8, slots_free: 3, waitlist: true, waitlist_full: false, waitlist_note: "Die Leitung entscheidet nach Eingang.", entry_policy: "all" };
const SQUAD = { squad_id: "s1", squad_name: "Rudel", display_name: "Loewen · Rudel", can_apply: true, state: "open", application: null, problems: [], warnings: [], can_submit: true };

function view(squads = [SQUAD], extra = {}) {
  return { application: BLOCK, rules: { label: "Version 1" }, privacy: { text: "Hinweis", url: "/privacy" }, season_problems: [], squads, hint: null, ...extra };
}

function renderPanel(block = BLOCK) {
  return render(<MemoryRouter><LeagueApplicationPanel leagueSlug="probe-liga" seasonSlug="season-1" block={block} /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  confirmMock.mockClear();
  authMock.current = { id: "u1" };
});

test("ein Gast sieht Fenster, Plätze und den Weg zum Einloggen, aber keine Abfrage geht raus", async () => {
  authMock.current = null;
  renderPanel();

  expect(screen.getByTestId("league-application-window")).toHaveTextContent("Offen bis 20.11.2026, 20:00 Uhr");
  expect(screen.getByTestId("league-application-seats")).toHaveTextContent("3 von 8 Startplätzen frei");
  expect(screen.getByTestId("league-application-waitlist-note")).toHaveTextContent("nach Eingang");
  expect(screen.getByTestId("league-application-login")).toHaveAttribute("href", "/login?next=%2Fliga%2Fprobe-liga%2Fseason-1%2Fanmelden");
  expect(apiMock.get).not.toHaveBeenCalled();
});

test("ein Gast sieht im geschlossenen Fenster keinen Weg zum Einloggen", () => {
  authMock.current = null;
  renderPanel({ ...BLOCK, state: "closed" });

  expect(screen.getByTestId("league-application-window")).toHaveTextContent("Vorbei seit");
  expect(screen.queryByTestId("league-application-login")).toBeNull();
});

test("Captain bekommt den Knopf, ein Mitglied nicht", async () => {
  apiMock.get.mockResolvedValue({ data: view() });
  const { unmount } = renderPanel();

  expect(await screen.findByTestId("league-application-start")).toHaveAttribute("href", "/liga/probe-liga/season-1/anmelden");
  unmount();

  apiMock.get.mockResolvedValue({ data: view([{ ...SQUAD, can_apply: false, problems: undefined }]) });
  renderPanel();
  await screen.findByTestId("league-application-row-s1");
  expect(screen.queryByTestId("league-application-start")).toBeNull();
});

test("nur für Mitglieder steht als eigener Satz da", () => {
  authMock.current = null;
  renderPanel({ ...BLOCK, entry_policy: "members" });

  expect(screen.getByTestId("league-application-policy")).toHaveTextContent("Nur für Vereinsmitglieder");
});

test("der Status zeigt Grund und Staffel und bietet das Zurückziehen", async () => {
  const rejected = { ...SQUAD, state: "rejected", application: { id: "a1", status: "rejected", decision_reason: "Kader passt nicht", can_withdraw: false } };
  const assigned = { ...SQUAD, squad_id: "s2", squad_name: "Horde", state: "accepted", application: { id: "a2", status: "accepted", staffel: "Liga 1 · Staffel A", can_withdraw: false } };
  const waiting = { ...SQUAD, squad_id: "s3", squad_name: "Meute", state: "waitlist", application: { id: "a3", status: "waitlist", can_withdraw: true } };
  apiMock.get.mockResolvedValue({ data: view([rejected, assigned, waiting]) });
  apiMock.post.mockResolvedValue({ data: {} });
  renderPanel();

  expect(await screen.findByTestId("league-application-row-s1")).toHaveTextContent("Kader passt nicht");
  expect(screen.getByTestId("league-application-row-s1")).toHaveTextContent("Abgelehnt");
  expect(screen.getByTestId("league-application-row-s2")).toHaveTextContent("Liga 1 · Staffel A");
  expect(screen.queryByTestId("league-application-withdraw-s2")).toBeNull();

  fireEvent.click(screen.getByTestId("league-application-withdraw-s3"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/leagues/probe-liga/season-1/applications/a3/withdraw", {}));
  expect(confirmMock).toHaveBeenCalled();
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

// #2348: Das eigene Team liest „Angemeldet“, ohne Staffel mit „Zuteilung folgt“; eingereicht steht mit einem Satz, dass die Leitung prüft.
test("angenommen heißt für das Team Angemeldet, eingereicht nennt die Prüfung", async () => {
  const assigned = { ...SQUAD, state: "accepted", application: { id: "a1", status: "accepted", staffel: "Liga 1 · Staffel A", can_withdraw: false } };
  const unassigned = { ...SQUAD, squad_id: "s2", state: "accepted", application: { id: "a2", status: "accepted", staffel: null, can_withdraw: true } };
  const submitted = { ...SQUAD, squad_id: "s3", state: "submitted", application: { id: "a3", status: "submitted", can_withdraw: true } };
  apiMock.get.mockResolvedValue({ data: view([assigned, unassigned, submitted]) });
  renderPanel();

  expect(await screen.findByTestId("league-application-state-s1")).toHaveTextContent(/^Angemeldet$/);
  expect(screen.getByTestId("league-application-state-s2")).toHaveTextContent("Angemeldet – Zuteilung folgt");
  expect(screen.getByTestId("league-application-row-s2")).toHaveTextContent("Liga und Staffel teilt die Liga-Leitung noch zu.");
  expect(screen.getByTestId("league-application-state-s3")).toHaveTextContent("Eingereicht");
  expect(screen.getByTestId("league-application-row-s3")).toHaveTextContent("Die Liga-Leitung prüft die Anmeldung und meldet sich.");
  expect(screen.getByTestId("league-application-row-s1")).not.toHaveTextContent("Die Liga-Leitung prüft");
});

test("eine automatische Zuteilung zieht das Team selbst zurück, die Rückfrage nennt die Staffel (#2348)", async () => {
  const assigned = { ...SQUAD, state: "accepted", application: { id: "a1", status: "accepted", staffel: "Liga 1 · Staffel A", can_withdraw: true } };
  apiMock.get.mockResolvedValue({ data: view([assigned]) });
  apiMock.post.mockResolvedValue({ data: {} });
  renderPanel();

  fireEvent.click(await screen.findByTestId("league-application-withdraw-s1"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/leagues/probe-liga/season-1/applications/a1/withdraw", {}));
  expect(confirmMock.mock.calls.at(-1)[0].description).toContain("spielt nicht mehr in Liga 1 · Staffel A");
});

test("der Stand einer laufenden Anmeldung nennt die offenen Punkte (#2313)", async () => {
  const submitted = { ...SQUAD, state: "submitted", application: { id: "a1", status: "submitted", can_withdraw: true },
    warnings: ["Mila: Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein."], shortfall: null };
  apiMock.get.mockResolvedValue({ data: view([submitted, { ...SQUAD, squad_id: "s2", warnings: ["Tom: Probe-ID fehlt im Profil."] }]) });
  renderPanel();

  const open = await screen.findByTestId("league-application-open-s1");
  expect(open).toHaveTextContent("Die Anmeldung zählt");
    expect(open).toHaveTextContent("nicht einchecken und nicht aufgestellt werden");
  expect(open).toHaveTextContent("Mila: Geburtsdatum fehlt");
  expect(screen.queryByTestId("league-application-open-s2")).toBeNull();
});

test("ohne Regelwerk nennt die Seite den Grund statt des Knopfs", async () => {
  apiMock.get.mockResolvedValue({ data: view([{ ...SQUAD, can_submit: false }], { rules: null, season_problems: ["Für diese Season ist noch kein gültiges Regelwerk veröffentlicht."] }) });
  renderPanel();

  expect(await screen.findByTestId("league-application-season-problems")).toHaveTextContent("Regelwerk");
  expect(screen.queryByTestId("league-application-start")).toBeNull();
});

test("die Teamleitung ohne Rolle bekommt den Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: view([{ ...SQUAD, can_apply: false }], { hint: "Anmelden dürfen Captain und Vertreter." }) });
  renderPanel();

  expect(await screen.findByTestId("league-application-hint")).toHaveTextContent("Captain und Vertreter");
});

test("schlägt die Abfrage fehl, bleibt der öffentliche Teil stehen", async () => {
  apiMock.get.mockRejectedValue(new Error("weg"));
  renderPanel();

  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.getByTestId("league-application-window")).toBeInTheDocument();
  expect(screen.queryByTestId("league-application-start")).toBeNull();
});
