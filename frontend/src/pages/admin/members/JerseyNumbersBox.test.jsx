import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Nummern im Admin (#2034): Liste mit Stand in Dolibarr, Anträge entscheiden, selbst vergeben, Neuwahl, Regeln.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, fallback) => e?.response?.data?.detail || fallback }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { JerseyNumbersBox } = await import("./JerseyNumbersBox");

const overview = {
  settings: { min: 0, max: 99, reserved: [13], dolibarr_field: "trikotnummer" },
  counts: { size: 100, reserved: 1, taken: 2, free: 97 },
  dolibarr: { state: "ok", text: "" },
  duplicates: [],
  rows: [
    { user_id: "u1", name: "Paula Beispiel mit einem wirklich sehr langen Namen, der umbrechen muss", username: "paula", number: 7, can_choose: false, set_by: "member",
      chosen_at: "2026-10-26T10:00:00+00:00", outside_rules: false,
      dolibarr: { state: "field_missing", text: "In Dolibarr fehlt beim Mitglied das ergänzende Attribut „trikotnummer“." },
      log: [{ at: "2026-10-26T10:00:00+00:00", action: "chosen", actor: "member", from: null, to: 7, note: "" }] },
    { user_id: "u2", name: "Max", username: "max", number: null, can_choose: true, set_by: null, chosen_at: null, outside_rules: false, dolibarr: null, log: [] },
  ],
  dolibarr_only: [{ number: 10, member_id: 13 }],
  requests: [{ id: "r1", user_id: "u1", name: "Paula", current: 7, wished: 9, reason: "Glückszahl", status: "received", status_label: "beim Vorstand",
    received_at: "2026-10-26T11:00:00+00:00", decided_at: null, decision_reason: "" }],
  open_requests: 1,
  status_labels: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url, config) => {
    if (url === "/admin/jersey-numbers/check") return { data: { number: Number(config.params.number), free: config.params.number !== "10", text: "Diese Nummer hat schon jemand." } };
    return { data: overview };
  });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.put.mockResolvedValue({ data: {} });
});

test("zeigt Zahlen, Stand in Dolibarr, Nummern nur in Dolibarr und Verlauf", async () => {
  const user = userEvent.setup();
  render(<JerseyNumbersBox />);
  expect(await screen.findByTestId("jersey-counts")).toHaveTextContent("2 vergeben · 97 frei · 1 reserviert · Bereich 0–99");
  const paula = screen.getByTestId("jersey-row-paula");
  expect(within(paula).getByTestId("jersey-row-number")).toHaveTextContent("7");
  expect(within(paula).getByTestId("jersey-row-sync")).toHaveTextContent("„trikotnummer“");
  expect(screen.getByTestId("jersey-row-max")).toHaveTextContent("wählt noch selbst");
  expect(screen.getByTestId("jersey-dolibarr-only")).toHaveTextContent("10 · Mitglied 13");
  expect(screen.getByTestId("jersey-sync-now")).toBeInTheDocument();
  await user.click(within(paula).getByRole("button", { name: /Verlauf/ }));
  expect(paula).toHaveTextContent("gewählt · – → 7");
});

test("Antrag freigeben, Neuwahl erlauben, selbst vergeben mit Prüfung", async () => {
  const user = userEvent.setup();
  render(<JerseyNumbersBox />);
  await user.click(await screen.findByTestId("jersey-approve-r1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/jersey-numbers/requests/r1/decision", { decision: "approve", reason: "" }));

  const max = screen.getByTestId("jersey-row-max");
  await user.click(within(max).getByTestId("jersey-row-edit"));
  await user.type(within(max).getByTestId("jersey-row-input"), "10");
  await waitFor(() => expect(max).toHaveTextContent("Diese Nummer hat schon jemand."));
  expect(within(max).getByTestId("jersey-row-save")).toBeDisabled();
  await user.clear(within(max).getByTestId("jersey-row-input"));
  await user.type(within(max).getByTestId("jersey-row-input"), "11");
  await waitFor(() => expect(within(max).getByTestId("jersey-row-save")).toBeEnabled());
  await user.click(within(max).getByTestId("jersey-row-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/jersey-numbers/members/u2", { number: 11 }));

  await user.click(within(screen.getByTestId("jersey-row-paula")).getByTestId("jersey-row-reopen"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("Die 7 wird sofort frei") }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/jersey-numbers/members/u1/reopen", {}));
});

test("Regeln speichern schickt Bereich, reservierte Nummern und Feldnamen", async () => {
  const user = userEvent.setup();
  render(<JerseyNumbersBox />);
  const field = await screen.findByTestId("jersey-settings-field");
  await user.clear(screen.getByTestId("jersey-settings-reserved"));
  await user.type(screen.getByTestId("jersey-settings-reserved"), "0, 13");
  await user.clear(field);
  await user.type(field, "rueckennummer");
  await user.click(screen.getByTestId("jersey-settings-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/jersey-numbers/settings", { min: "0", max: "99", reserved: "0, 13", dolibarr_field: "rueckennummer" }));
});

test("ohne Mitglieder steht ein freundlicher Satz da", async () => {
  apiMock.get.mockResolvedValue({ data: { ...overview, rows: [], requests: [], dolibarr_only: [], counts: { size: 100, reserved: 0, taken: 0, free: 100 } } });
  render(<JerseyNumbersBox />);
  expect(await screen.findByTestId("jersey-empty")).toBeInTheDocument();
  expect(screen.queryByTestId("jersey-open-requests")).toBeNull();
});
