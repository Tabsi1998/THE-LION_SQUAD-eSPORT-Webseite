import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { runAtTestClock } from "@/testClock";

// Feste Uhr (#1307): die Datums-Texte lassen das laufende Jahr weg und sagen „heute“/„morgen“.
runAtTestClock();

// Team-Seite (docs/LIGA.md, B.4, #2205): der Stand der Liga-Anmeldung am richtigen Co-Team. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, resolveMediaUrl: (url) => url, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { TeamsPanel } = await import("@/pages/user/profile/TeamsPanel");

const TEAM = { id: "t1", name: "Loewen", tag: "LOE", my_role: "leader", can_manage: true, members: [], member_ids: [], squad_count: 2 };
const SQUADS = [{ id: "s-a", team_id: "t1", name: "Rudel A", status: "active", members: [] }, { id: "s-b", team_id: "t1", name: "Rudel B", status: "active", members: [] }];

function answer(items, startRights = []) {
  return (url) => {
    if (url === "/teams/my") return Promise.resolve({ data: [TEAM] });
    if (url === "/teams/t1/squads") return Promise.resolve({ data: SQUADS });
    if (url === "/me/league-applications") return items === null ? Promise.reject(new Error("weg")) : Promise.resolve({ data: { items, start_rights: startRights } });
    return Promise.resolve({ data: [] });
  };
}

test("der Stand steht beim richtigen Co-Team, mit Staffel, Grund und Link", async () => {
  apiMock.get.mockImplementation(answer([
    { id: "a1", squad_id: "s-a", status: "accepted", staffel: "Liga 1 · Staffel A", title: "Probe-Liga Season 1", url: "/liga/probe-liga/season-1" },
    { id: "a2", squad_id: "s-b", status: "rejected", decision_reason: "Kader zu klein", title: "Probe-Liga Season 1", url: "/liga/probe-liga/season-1" },
  ]));
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);

  const first = await screen.findByTestId("squad-application-a1");
  // Das eigene Team liest „Angemeldet“ (#2348), die Leitung weiter „Angenommen“.
  expect(first).toHaveTextContent("Angemeldet");
  expect(first).not.toHaveTextContent("Angenommen");
  expect(first).toHaveTextContent("Liga 1 · Staffel A");
  expect(first.querySelector("a")).toHaveAttribute("href", "/liga/probe-liga/season-1");
  expect(screen.getByTestId("squad-application-a2")).toHaveTextContent("Kader zu klein");
});

test("ohne Anmeldung oder wenn die Abfrage fehlschlägt, bleibt die Karte wie bisher", async () => {
  apiMock.get.mockImplementation(answer(null));
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);

  await waitFor(() => expect(screen.getByTestId("team-squad-roles-s-a")).toBeInTheDocument());
  expect(screen.queryByText("Angenommen")).toBeNull();
});

test("übernommen aus der Vorgänger-Season (F.2, #1627): Herkunft, Frist, ohne Link zur noch verborgenen Season, Abmelden", async () => {
  apiMock.get.mockImplementation(answer([
    { id: "a3", squad_id: "s-a", status: "accepted", title: "Probe-Liga Season 2", url: null, can_withdraw: true,
      carry_over: { from_season_name: "Season 1", from_label: "Liga 1", division_label: "Liga 2", movement: "down", withdraw_until: "2027-01-04T23:00:00+00:00" } },
  ]));
  apiMock.post.mockResolvedValue({ data: { status: "withdrawn" } });
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);
  const row = await screen.findByTestId("squad-application-a3");
  expect(screen.getByTestId("squad-application-carry-a3")).toHaveTextContent("Übernommen aus Season 1: Liga 2 (Abstieg aus Liga 1). Abmelden bis zum Start am Di 5. Jänner 2027 · 00:00.");
  expect(row.querySelector("a")).toBeNull();
  screen.getByTestId("squad-application-withdraw-a3").click();
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/me/league-applications/a3/withdraw", {}));
});

// ---------------------------------------------------------------- Startrechte (#1627, docs/LIGA.md „F.2a“)

const CARRY = { from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up", withdraw_until: "2027-01-04T23:00:00+00:00" };

test("Startrecht mit Zusage: Frist, Knopf „Startrecht annehmen“ - und „Zusage offen“ statt „Angemeldet“", async () => {
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(answer([
    { id: "a4", squad_id: "s-a", status: "accepted", title: "Probe-Liga Season 2", url: null, can_withdraw: true,
      carry_over: { ...CARRY, start_right: { state: "offered", accept_until: "2026-12-15T17:00:00+00:00", can_accept: true, can_decline: false, fills: null } } },
  ]));
  apiMock.post.mockResolvedValue({ data: { status: "accepted" } });
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);
  const row = await screen.findByTestId("squad-application-a4");
  expect(row).toHaveTextContent("Startrecht – Zusage offen");
  expect(row).not.toHaveTextContent("Angemeldet");
  expect(screen.getByTestId("squad-start-right-line-a4")).toHaveTextContent("Startrecht für Liga 1: bitte bis Di 15. Dezember · 18:00 zusagen. Ohne Zusage verfällt es.");
  expect(screen.queryByTestId("squad-start-right-decline-a4")).toBeNull();
  screen.getByTestId("squad-start-right-accept-a4").click();
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/me/league-applications/a4/start-right", { action: "accept" }));
});

test("ein Nachrücker kann zusagen oder das Nachrücken ablehnen", async () => {
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(answer([
    { id: "a5", squad_id: "s-a", status: "accepted", title: "Probe-Liga Season 2", url: null, can_withdraw: true,
      carry_over: { ...CARRY, start_right: { state: "offered", accept_until: "2026-12-15T17:00:00+00:00", can_accept: true, can_decline: true, fills: { from_label: "Liga 2" } } } },
  ]));
  apiMock.post.mockResolvedValue({ data: { status: "accepted" } });
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);
  expect(await screen.findByTestId("squad-start-right-line-a5")).toHaveTextContent("ohne Antwort bleibt ihr in Liga 2");
  screen.getByTestId("squad-start-right-decline-a5").click();
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/me/league-applications/a5/start-right", { action: "decline" }));
});

test("ohne Recht zum Handeln (Kader) steht der Stand da, aber kein Knopf", async () => {
  apiMock.get.mockImplementation(answer([
    { id: "a6", squad_id: "s-a", status: "accepted", title: "Probe-Liga Season 2", url: null,
      carry_over: { ...CARRY, start_right: { state: "accepted", accept_until: null, can_accept: false, can_decline: false, fills: null } } },
  ]));
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);
  expect(await screen.findByTestId("squad-application-a6")).toHaveTextContent("Zugesagt – Zuteilung folgt");
  expect(screen.queryByTestId("squad-start-right-accept-a6")).toBeNull();
});

test("vor der Folge-Season: Prognose und bestätigtes Startrecht stehen beim richtigen Co-Team - mit dem Wort dafür", async () => {
  apiMock.get.mockImplementation(answer([], [
    { squad_id: "s-a", season_id: "s1", title: "Probe-Liga Season 1", url: "/liga/probe-liga/season-1", state: "forecast", movement: "up", rank: 1, zone_label: "Aufstieg", division_label: null },
    { squad_id: "s-b", season_id: "s9", title: "Andere Liga Season 3", url: null, state: "confirmed", movement: "stay", rank: 2, division_label: "Liga 2" },
  ]));
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);
  const forecast = await screen.findByTestId("squad-start-right-outlook-s-a-s1");
  expect(forecast).toHaveTextContent("Probe-Liga Season 1");
  expect(forecast).toHaveTextContent("Prognose nach der laufenden Tabelle: Aufstieg (Platz 1). Fest ist das erst, wenn die Season abgeschlossen ist.");
  expect(screen.getByTestId("squad-start-right-outlook-s-b-s9")).toHaveTextContent("Bestätigt: Startrecht für Liga 2 in der nächsten Season.");
});
