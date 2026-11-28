import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { runAtTestClock } from "@/testClock";

// Feste Uhr (#1307): die Datums-Texte lassen das laufende Jahr weg und sagen „heute“/„morgen“.
runAtTestClock();

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

  expect(screen.getByTestId("league-application-window")).toHaveTextContent("Offen bis Fr 20. November · 20:00");
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

test("Season aus dem Vorgänger ohne Fenster (F.2, #1627): nur Co-Teams mit Antrag, Herkunft und „Abmelden“; Gäste sehen nichts", async () => {
  const carried = { ...SQUAD, state: "accepted", can_apply: true, application: { id: "a9", status: "accepted", can_withdraw: true,
    carry_over: { from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up", withdraw_until: "2027-01-04T23:00:00+00:00" } } };
  const other = { ...SQUAD, squad_id: "s2", display_name: "Loewen · Zwei", state: "none", application: null };
  apiMock.get.mockResolvedValue({ data: view([carried, other], { application: null }) });
  apiMock.post.mockResolvedValue({ data: {} });
  const first = renderPanel(null);
  expect(await screen.findByTestId("league-application-carry-s1")).toHaveTextContent("Übernommen aus Season 1: Liga 1 (Aufstieg aus Liga 2)");
  expect(screen.getByTestId("league-application-window")).toHaveTextContent("automatisch dabei");
  expect(screen.queryByTestId("league-application-row-s2")).toBeNull();
  fireEvent.click(screen.getByTestId("league-application-withdraw-s1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/leagues/probe-liga/season-1/applications/a9/withdraw", {}));
  expect(confirmMock.mock.calls.at(-1)[0].title).toBe("Von der Season abmelden?");
  first.unmount();
  authMock.current = null;
  const { container } = renderPanel(null);
  expect(container.querySelector("[data-testid='league-application']")).toBeNull();
});

test("Nachmeldung (Nr. 180): läuft das Fenster über den Season-Start, sagt die Ligaseite es - geschlossen nicht mehr", () => {
  authMock.current = null;
  const { unmount } = renderPanel({ ...BLOCK, season_starts_at: "2026-11-17T00:00:00" });
  expect(screen.getByTestId("league-application-after-start")).toHaveTextContent("Anmeldung läuft nach Season-Start weiter (bis Fr 20. November · 20:00).");
  unmount();
  renderPanel({ ...BLOCK, season_starts_at: "2026-11-17T00:00:00", state: "closed" });
  expect(screen.queryByTestId("league-application-after-start")).toBeNull();
});

// Startrechte (#1627, docs/LIGA.md „F.2a“): Die Zusage geht über denselben Antrag - auf der Ligaseite wie unter Teams.
test("ein offenes Startrecht zeigt Frist und „Startrecht annehmen“ statt „automatisch dabei“", async () => {
  const carried = { ...SQUAD, state: "accepted", can_submit: false, application: { id: "a9", status: "accepted", can_withdraw: true,
    carry_over: { from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up", withdraw_until: "2027-01-04T23:00:00+00:00",
      start_right: { state: "offered", accept_until: "2026-12-15T17:00:00+00:00", can_accept: true, can_decline: false, fills: null } } } };
  apiMock.get.mockResolvedValue({ data: view([carried]) });
  apiMock.post.mockResolvedValue({ data: { status: "accepted" } });
  renderPanel();
  const row = await screen.findByTestId("league-application-row-s1");
  expect(screen.getByTestId("league-application-state-s1")).toHaveTextContent("Startrecht – Zusage offen");
  expect(row).toHaveTextContent("Startrecht für Liga 1: bitte bis Di 15. Dezember · 18:00 zusagen.");
  expect(row).not.toHaveTextContent("automatisch dabei");
  fireEvent.click(screen.getByTestId("league-start-right-accept-a9"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/me/league-applications/a9/start-right", { action: "accept" }));
});

test("ohne Startrecht bleibt ein übernommenes Co-Team „automatisch dabei“", async () => {
  const carried = { ...SQUAD, state: "accepted", can_submit: false, application: { id: "a8", status: "accepted", can_withdraw: true,
    carry_over: { from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up", withdraw_until: "2027-01-04T23:00:00+00:00" } } };
  apiMock.get.mockResolvedValue({ data: view([carried]) });
  renderPanel();
  const row = await screen.findByTestId("league-application-row-s1");
  expect(row).toHaveTextContent("Ihr seid automatisch dabei.");
  expect(screen.getByTestId("league-application-state-s1")).toHaveTextContent("Angemeldet – Zuteilung folgt");
  expect(screen.queryByTestId("league-start-right-accept-a8")).toBeNull();
});

test("führt die Season Startrechte im Modus „automatisch“, bleibt der Satz „Ihr seid automatisch dabei“ stehen", async () => {
  const carried = { ...SQUAD, state: "accepted", can_submit: false, application: { id: "a7", status: "accepted", can_withdraw: true,
    carry_over: { from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up", withdraw_until: "2027-01-04T23:00:00+00:00",
      start_right: { state: "confirmed", accept_until: null, paused: false, waits_for_lead: false, can_accept: false, can_decline: false, fills: null } } } };
  apiMock.get.mockResolvedValue({ data: view([carried]) });
  renderPanel();
  const row = await screen.findByTestId("league-application-row-s1");
  expect(row).toHaveTextContent("Ihr seid automatisch dabei. Die Staffel teilt die Liga-Leitung noch zu.");
  expect(screen.getByTestId("league-application-state-s1")).toHaveTextContent("Angemeldet – Zuteilung folgt");
});

test("ein Nachrücker im Modus „automatisch“ liest seinen eigenen Satz - nicht beide", async () => {
  const carried = { ...SQUAD, state: "accepted", can_submit: false, application: { id: "a6", status: "accepted", can_withdraw: true,
    carry_over: { from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up", withdraw_until: "2027-01-04T23:00:00+00:00",
      start_right: { state: "confirmed", accept_until: null, can_accept: false, can_decline: true, fills: { from_label: "Liga 2" } } } } };
  apiMock.get.mockResolvedValue({ data: view([carried]) });
  renderPanel();
  const row = await screen.findByTestId("league-application-row-s1");
  expect(row).toHaveTextContent("Nachgerückt in Liga 1. Wer lieber in Liga 2 bleibt, lehnt bis zum Start ab.");
  expect(row).not.toHaveTextContent("Ihr seid automatisch dabei");
  expect(screen.getByTestId("league-start-right-decline-a6")).toBeInTheDocument();
});


// ---------------------------------------------------------------- Solo-Liga (#1629, P2): Anmeldung als Spieler

const PLAYER = { user_id: "u1", display_name: "Duellant Eins", can_apply: true, state: "open", application: null, problems: [], warnings: [], shortfall: null, can_submit: true };

function soloView(player = PLAYER, extra = {}) {
  return view([], { kind: "solo", player, application: { ...BLOCK, participant_kind: "solo" }, ...extra });
}

test("Solo-Liga: ein Gast liest „Anmelden, dann mitspielen“, der Knopf für Co-Teams fehlt", () => {
  authMock.current = null;
  renderPanel({ ...BLOCK, participant_kind: "solo" });

  expect(screen.getByTestId("league-application-login")).toHaveTextContent("Anmelden, dann mitspielen");
  expect(screen.getByTestId("league-application-solo")).toHaveTextContent("Du meldest dich selbst als Spieler an");
});

test("Solo-Liga: „Als Spieler anmelden“ statt „Mit Co-Team anmelden“", async () => {
  apiMock.get.mockResolvedValue({ data: soloView() });
  renderPanel({ ...BLOCK, participant_kind: "solo" });

  expect(await screen.findByTestId("league-application-start-player")).toHaveAttribute("href", "/liga/probe-liga/season-1/anmelden");
  expect(screen.getByTestId("league-application-start-player")).toHaveTextContent("Als Spieler anmelden");
  expect(screen.queryByTestId("league-application-start")).toBeNull();
  expect(screen.queryByTestId("league-application-player")).toBeNull();
});

test("Solo-Liga: Was nicht geht, steht im Klartext - ohne Knopf", async () => {
  apiMock.get.mockResolvedValue({ data: soloView({ ...PLAYER, can_submit: false, problems: ["Diese Season ist nur für Mitglieder. Du bist kein Vereinsmitglied."] }) });
  renderPanel({ ...BLOCK, participant_kind: "solo" });

  expect(await screen.findByTestId("league-application-season-problems")).toHaveTextContent("Du bist kein Vereinsmitglied.");
  expect(screen.queryByTestId("league-application-start-player")).toBeNull();
});

test("Solo-Liga: Stand per Du, offene Punkte und Zurückziehen der eigenen Anmeldung", async () => {
  const application = { id: "a1", status: "submitted", can_withdraw: true, staffel: null };
  apiMock.get.mockResolvedValue({ data: soloView({ ...PLAYER, state: "submitted", application, can_submit: false, warnings: ["Dein Geburtsdatum fehlt im Profil."] }) });
  apiMock.post.mockResolvedValue({ data: {} });
  renderPanel({ ...BLOCK, participant_kind: "solo" });

  expect(await screen.findByTestId("league-application-player-state")).toHaveTextContent("Eingereicht");
  expect(screen.getByTestId("league-application-player")).toHaveTextContent("Die Liga-Leitung prüft deine Anmeldung");
  expect(screen.getByTestId("league-application-player-open")).toHaveTextContent("Dein Geburtsdatum fehlt im Profil.");
  expect(screen.getByTestId("league-application-player")).not.toHaveTextContent("Co-Team");
  fireEvent.click(screen.getByTestId("league-application-player-withdraw"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/leagues/probe-liga/season-1/applications/a1/withdraw", {}));
  expect(confirmMock.mock.calls.at(-1)[0].description).toMatch(/^Du bist dann nicht mehr angemeldet/);
});

test("Solo-Liga: zugeteilt - „Du spielst in …“, Zurückziehen nur über die Leitung", async () => {
  const application = { id: "a1", status: "accepted", can_withdraw: false, staffel: "Liga 1 · Staffel A" };
  apiMock.get.mockResolvedValue({ data: soloView({ ...PLAYER, state: "accepted", application, can_submit: false }) });
  renderPanel({ ...BLOCK, participant_kind: "solo" });

  expect(await screen.findByTestId("league-application-player-state")).toHaveTextContent("Angemeldet");
  expect(screen.getByTestId("league-application-player")).toHaveTextContent("Du spielst in Liga 1 · Staffel A.");
  expect(screen.queryByTestId("league-application-player-withdraw")).toBeNull();
});

test("Solo-Liga ohne Fenster: eigener Satz statt „Eure Co-Teams sind automatisch dabei“, kein Satz für die App", async () => {
  const application = { id: "a1", status: "accepted", can_withdraw: false, staffel: "Liga 1 · Staffel A" };
  apiMock.get.mockResolvedValue({ data: soloView({ ...PLAYER, state: "accepted", application, can_submit: false }, { application: null,
    hint: "Als Spieler meldest du dich bis zum App-Ausbau auf der Website an." }) });
  renderPanel(null);

  expect(await screen.findByTestId("league-application-player")).toHaveTextContent("Du spielst in Liga 1 · Staffel A.");
  expect(screen.getByTestId("league-application-window")).toHaveTextContent("Gerade kein Anmeldefenster");
  expect(screen.getByTestId("league-application-window")).not.toHaveTextContent("Co-Teams");
  expect(screen.queryByTestId("league-application-hint")).toBeNull();
});