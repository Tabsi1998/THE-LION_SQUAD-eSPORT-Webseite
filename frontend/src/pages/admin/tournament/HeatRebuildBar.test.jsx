import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Hinweisleiste „Läufe umbauen“ (#1550): der Vorschlag des Servers mit „Bestätigen“ und „Ablehnen“ - nur für die
// Turnierleitung mit Struktur-Recht, nur solange ein Vorschlag am Turnier liegt.

const apiMock = { post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { HeatRebuildBar } = await import("./HeatRebuildBar");

const PLAN = {
  id: "plan-1",
  summary: "Runde 1: Läufe C und D (2 + 2) werden zusammengelegt zu C mit 4. Halbfinale: Läufe E und F werden ausgeglichen (3 + 3 statt 4 + 2).",
  ops: [
    { kind: "merged", text: "Runde 1: Läufe C und D (2 + 2) werden zusammengelegt zu C mit 4." },
    { kind: "rebalanced", text: "Halbfinale: Läufe E und F werden ausgeglichen (3 + 3 statt 4 + 2)." },
  ],
  created_at: "2026-10-31T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
});

test("ohne Vorschlag oder ohne Struktur-Recht steht nichts da", () => {
  const { rerender } = render(<HeatRebuildBar tournament={{ id: "t1", can_manage_structure: true, heat_rebuild_plan: null }} />);
  expect(screen.queryByTestId("admin-tr-heat-rebuild")).not.toBeInTheDocument();
  rerender(<HeatRebuildBar tournament={{ id: "t1", can_manage_structure: false, heat_rebuild_plan: PLAN }} />);
  expect(screen.queryByTestId("admin-tr-heat-rebuild")).not.toBeInTheDocument();
});

test("zeigt jeden Umbau als Zeile und bestätigt mit der Kennung des Vorschlags", async () => {
  const user = userEvent.setup();
  const onDecided = vi.fn();
  render(<HeatRebuildBar tournament={{ id: "t1", can_manage_structure: true, heat_rebuild_plan: PLAN }} onDecided={onDecided} />);
  const bar = screen.getByTestId("admin-tr-heat-rebuild");
  expect(bar).toHaveTextContent("Vorschlag: Läufe umbauen");
  expect(screen.getAllByTestId("admin-tr-heat-rebuild-op")).toHaveLength(2);
  expect(bar).toHaveTextContent("Läufe C und D (2 + 2) werden zusammengelegt zu C mit 4.");
  await user.click(screen.getByTestId("admin-tr-heat-rebuild-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/heat-rebuild/confirm", { plan_id: "plan-1" }));
  expect(toastMock.success).toHaveBeenCalled();
  expect(onDecided).toHaveBeenCalled();
});

test("Ablehnen schickt die Kennung an die Ablehnen-Route", async () => {
  const user = userEvent.setup();
  render(<HeatRebuildBar tournament={{ id: "t1", can_manage_structure: true, heat_rebuild_plan: PLAN }} />);
  await user.click(screen.getByTestId("admin-tr-heat-rebuild-reject"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/heat-rebuild/reject", { plan_id: "plan-1" }));
});

test("ein veralteter Vorschlag (409) wird als Hinweis gezeigt, die Seite lädt neu", async () => {
  const user = userEvent.setup();
  const onDecided = vi.fn();
  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Der Vorschlag ist nicht mehr aktuell." } } });
  render(<HeatRebuildBar tournament={{ id: "t1", can_manage_structure: true, heat_rebuild_plan: PLAN }} onDecided={onDecided} />);
  await user.click(screen.getByTestId("admin-tr-heat-rebuild-confirm"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  expect(onDecided).toHaveBeenCalled();
  expect(screen.getByTestId("admin-tr-heat-rebuild-confirm")).not.toBeDisabled();
});

test("schlimmster Fall: viele Umbauten, sehr lange Sätze, fehlende Felder - alles bleibt lesbar und bedienbar", () => {
  const longText = "Halbfinale: Läufe " + Array.from({ length: 26 }, (_, index) => `Lauf-${String.fromCharCode(65 + index)}-Sonntag-Nachmittag-Mario-Kart-Grand-Prix`).join(", ") + " werden ausgeglichen.";
  const plan = {
    id: "plan-2",
    summary: "",
    ops: [
      { kind: "merged", text: longText },
      ...Array.from({ length: 12 }, (_, index) => ({ kind: "quota", text: `Runde ${index + 1}: Lauf X hat 3 Teilnehmer, 2 kommen weiter (statt 1).` })),
      { kind: "shortened" },
      { text: "Satz ohne Art." },
    ],
  };
  render(<HeatRebuildBar tournament={{ id: "t1", can_manage_structure: true, heat_rebuild_plan: plan }} />);
  const rows = screen.getAllByTestId("admin-tr-heat-rebuild-op");
  expect(rows).toHaveLength(15);
  expect(rows[0]).toHaveTextContent(longText);
  expect(rows[13]).toHaveTextContent("Abkürzen");
  expect(rows[14]).toHaveTextContent("Satz ohne Art.");
  // Lange Wörter dürfen die Leiste nicht sprengen; jede Zeile bricht um.
  for (const row of rows) expect(row.className).toContain("break-words");
  expect(screen.getByTestId("admin-tr-heat-rebuild-confirm")).toBeEnabled();
  expect(screen.getByTestId("admin-tr-heat-rebuild-reject")).toBeEnabled();
});

test("ohne Umbau-Liste zeigt die Leiste den Satz des Servers, ohne beides einen Standardsatz", () => {
  const { rerender } = render(<HeatRebuildBar tournament={{ id: "t1", can_manage_structure: true, heat_rebuild_plan: { id: "p", summary: "Nur der Satz." } }} />);
  expect(screen.getByTestId("admin-tr-heat-rebuild")).toHaveTextContent("Nur der Satz.");
  rerender(<HeatRebuildBar tournament={{ id: "t1", can_manage_structure: true, heat_rebuild_plan: { id: "p" } }} />);
  expect(screen.getByTestId("admin-tr-heat-rebuild")).toHaveTextContent("Die Läufe sollen umgebaut werden.");
});
