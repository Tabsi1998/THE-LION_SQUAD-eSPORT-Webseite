import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Reiter „Strafen“ der Season (E.3): verhängen mit Führung, widerrufen mit Grund, Einspruch nur durch eine andere Person,
// über das eigene Team entscheidet niemand selbst. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonSanctionsTab } = await import("./SeasonSanctionsTab");

const KINDS = [
  { key: "warning", label: "Verwarnung", targets: ["player", "squad"] },
  { key: "point_deduction", label: "Punktabzug", targets: ["squad"] },
  { key: "player_ban", label: "Spielsperre", targets: ["player"], ban: true, provisional: true },
];
const item = (id, extra = {}) => ({
  id, kind: "player_ban", kind_label: "Spielsperre", target_type: "player", target_name: "Mila", squad_name: "Rudel A", rule_ref: "Anlage C.4",
  reason: "Makro nachgewiesen", period: "2 Liga-Spiele, noch 2", state: "final", status: "active", created_at: "2026-11-12T18:00:00+00:00",
  created_by_name: "Strafleitung", appeal_until: "2099-01-01T00:00:00+00:00", can_appeal: true, appeal: null, proofs: [], proof_count: 0,
  own_side: false, own_decision: false, ...extra,
});
const DATA = {
  items: [
    item("s1"),
    item("s2", { own_decision: true, appeal: { state: "open", at: "2026-11-12T19:00:00+00:00", by_name: "Mila", text: "Das war ich nicht." } }),
    item("s3", { own_side: true }),
    item("s4", { status: "provisional", state: "provisional", period: "vorläufig, bis die Liga-Leitung entschieden hat", appeal_until: null, can_appeal: false }),
    item("s5", { status: "revoked", revoked_at: "2026-11-12T20:00:00+00:00", revoke_reason: "Irrtum", revoked_by_name: "Zweitleitung" }),
  ],
  open_appeals: 1, kinds: KINDS, appeal_hours: 48, superadmin: false, limits: { points_max: 99, matches_max: 50 },
  catalog: [{ key: "cheating", label: "Cheating", rule_ref: "Anlage C.4", kind: "player_ban", kind_label: "Spielsperre" }],
  targets: [{ tournament_id: "t1", title: "Liga 1 · Staffel A", squads: [{ registration_id: "r1", squad_id: "q1", name: "Rudel A", players: [{ id: "u1", name: "Mila" }] }],
    matches: [{ id: "m1", matchday: 1, label: "Rudel A gegen Horst", registration_ids: ["r1", "r2"] }] }],
};

function renderTab() {
  return render(<MemoryRouter><SeasonSanctionsTab seasonId="season-1" /></MemoryRouter>);
}

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/proofs") ? { items: [] } : DATA }));
  apiMock.post.mockResolvedValue({ data: { kind_label: "Spielsperre" } });
});

test("zeigt laufende Strafen mit Stand und Frist, widerrufene erst unter „Alle“", async () => {
  renderTab();
  expect(await screen.findByTestId("season-sanctions-count")).toHaveTextContent("4 Strafen laufen · 1 Einspruch wartet");
  expect(screen.getByTestId("sanction-status-s1")).toHaveTextContent("Gilt");
  expect(screen.getByTestId("sanction-period-s1")).toHaveTextContent("2 Liga-Spiele, noch 2");
  expect(screen.getByTestId("sanction-deadline-s1")).toHaveTextContent("Einspruch möglich");
  expect(screen.getByTestId("sanction-status-s4")).toHaveTextContent("Vorläufig");
  expect(screen.queryByTestId("sanction-s5")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("sanction-filter-all"));
  expect(screen.getByTestId("sanction-s5")).toHaveTextContent("Widerrufen");
  expect(screen.getByTestId("sanction-s5")).toHaveTextContent("Irrtum");
  expect(screen.queryByTestId("sanction-revoke-s5")).not.toBeInTheDocument();
});

test("über den Einspruch gegen die eigene Strafe und über das eigene Team entscheidet eine andere Person", async () => {
  renderTab();
  expect(await screen.findByTestId("sanction-own-decision-s2")).toHaveTextContent("entscheidet eine andere Person");
  expect(screen.queryByTestId("sanction-appeal-grant-s2")).not.toBeInTheDocument();
  expect(screen.getByTestId("sanction-own-team-s3")).toHaveTextContent("eigenes Team");
  expect(screen.queryByTestId("sanction-revoke-s3")).not.toBeInTheDocument();
});

test("widerruft nur mit Grund und bestätigt eine vorläufige Sperre mit Dauer", async () => {
  renderTab();
  fireEvent.click(await screen.findByTestId("sanction-revoke-s1"));
  const box = screen.getByTestId("sanction-action-revoke-s1");
  expect(within(box).getByTestId("sanction-action-run-s1")).toBeDisabled();
  fireEvent.change(within(box).getByTestId("sanction-action-text-s1"), { target: { value: "Fall erneut geprüft, kein Verstoß." } });
  fireEvent.click(within(box).getByTestId("sanction-action-run-s1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/season-1/sanctions/s1/revoke", { reason: "Fall erneut geprüft, kein Verstoß." }));

  fireEvent.click(await screen.findByTestId("sanction-confirm-s4"));
  const confirm = screen.getByTestId("sanction-action-confirm-s4");
  fireEvent.change(within(confirm).getByTestId("sanction-confirm-s4-matches"), { target: { value: "3" } });
  fireEvent.click(within(confirm).getByTestId("sanction-action-run-s4"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/season-1/sanctions/s4/confirm", { matches: 3 }));
});

test("das Formular führt: Katalog füllt vor, der Knopf geht erst, wenn nichts fehlt", async () => {
  renderTab();
  fireEvent.click(await screen.findByTestId("sanction-add"));
  const form = screen.getByTestId("sanction-form");
  expect(within(form).getByTestId("sanction-submit")).toBeDisabled();
  expect(within(form).getByTestId("sanction-form-hint")).toHaveTextContent("Bitte das Co-Team wählen.");
  fireEvent.change(within(form).getByTestId("sanction-catalog"), { target: { value: "cheating" } });
  expect(within(form).getByTestId("sanction-kind")).toHaveValue("player_ban");
  expect(within(form).getByTestId("sanction-rule")).toHaveValue("Cheating (Anlage C.4)");
  fireEvent.change(within(form).getByTestId("sanction-staffel"), { target: { value: "t1" } });
  fireEvent.change(within(form).getByTestId("sanction-squad"), { target: { value: "r1" } });
  expect(within(form).getByTestId("sanction-form-hint")).toHaveTextContent("Bitte die Person wählen.");
  fireEvent.change(within(form).getByTestId("sanction-player"), { target: { value: "u1" } });
  fireEvent.change(within(form).getByTestId("sanction-reason"), { target: { value: "Clip zeigt den Einsatz eines Makros." } });
  fireEvent.click(within(form).getByTestId("sanction-provisional"));
  expect(within(form).queryByTestId("sanction-matches")).not.toBeInTheDocument();
  expect(within(form).queryByTestId("sanction-form-hint")).not.toBeInTheDocument();
  fireEvent.click(within(form).getByTestId("sanction-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/season-1/sanctions", {
    kind: "player_ban", target_type: "player", rule_ref: "Cheating (Anlage C.4)", reason: "Clip zeigt den Einsatz eines Makros.", state: "provisional",
    catalog_key: "cheating", registration_id: "r1", user_id: "u1" }));
  await waitFor(() => expect(screen.queryByTestId("sanction-form")).not.toBeInTheDocument());
});
