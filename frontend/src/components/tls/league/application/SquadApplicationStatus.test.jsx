import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Team-Seite (docs/LIGA.md, B.4, #2205): der Stand der Liga-Anmeldung am richtigen Co-Team. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, resolveMediaUrl: (url) => url, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { TeamsPanel } = await import("@/pages/user/profile/TeamsPanel");

const TEAM = { id: "t1", name: "Loewen", tag: "LOE", my_role: "leader", can_manage: true, members: [], member_ids: [], squad_count: 2 };
const SQUADS = [{ id: "s-a", team_id: "t1", name: "Rudel A", status: "active", members: [] }, { id: "s-b", team_id: "t1", name: "Rudel B", status: "active", members: [] }];

function answer(items) {
  return (url) => {
    if (url === "/teams/my") return Promise.resolve({ data: [TEAM] });
    if (url === "/teams/t1/squads") return Promise.resolve({ data: SQUADS });
    if (url === "/me/league-applications") return items === null ? Promise.reject(new Error("weg")) : Promise.resolve({ data: { items } });
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
  expect(screen.getByTestId("squad-application-carry-a3")).toHaveTextContent("Übernommen aus Season 1: Liga 2 (Abstieg aus Liga 1). Abmelden bis zum Start am 05.01.2027, 00:00 Uhr.");
  expect(row.querySelector("a")).toBeNull();
  screen.getByTestId("squad-application-withdraw-a3").click();
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/me/league-applications/a3/withdraw", {}));
});
