import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Überblick (#2447): „auffällig“ zählt nur Offenes, ein Tipp auf die Kachel öffnet genau diese Einträge; offene
// Probleme lassen sich einzeln und alle auf einmal (mit Rückfrage in der Seite) quittieren; leer heißt „Alles erledigt“.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { error: vi.fn(), success: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (d) => String(d || "") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { OpsOverview } = await import("./OpsOverview");
const { ConfirmDialogProvider } = await import("@/components/tls/ConfirmDialog");

const CHECK = { id: "ep1", ack_id: "ep1", source: "checks", source_label: "Auto-Checks", href: "/admin/ops?tab=checks", severity: "warn", status: "warn",
  time: "2026-11-13T08:00:00Z", title: "Auto-Checks gelb", subtitle: "disk", detail: "", open: true, ackable: true };
const MAIL = { id: "m1", ack_id: "m1", source: "email", source_label: "E-Mail-Versand", href: "/admin/ops?tab=events&source=email", severity: "error", status: "failed",
  time: "2026-11-16T07:00:00Z", title: "password_reset", subtitle: "email · a***@x.at", detail: "550", open: true, ackable: true };
const OPEN = {
  items: [MAIL, CHECK],
  sources: [
    { key: "checks", label: "Auto-Checks", total: 10, problem_count: 1, latest_at: "2026-11-13T08:00:00Z" },
    { key: "email", label: "E-Mail-Versand", total: 40, problem_count: 4, latest_at: "2026-11-16T07:00:00Z" },
    { key: "audit", label: "Adminaktionen", total: 9, problem_count: 0, latest_at: "2026-11-16T07:00:00Z" },
  ],
};
const DONE = { items: [], sources: OPEN.sources.map((item) => ({ ...item, problem_count: 0 })) };

function renderOverview(onOpenSource = vi.fn()) {
  render(<ConfirmDialogProvider><MemoryRouter><OpsOverview onOpenSource={onOpenSource} /></MemoryRouter></ConfirmDialogProvider>);
  return onOpenSource;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: OPEN });
});

test("fragt nur offene Probleme ab und zählt je Quelle das Offene", async () => {
  renderOverview();
  expect(await screen.findByTestId("ops-event-email")).toHaveTextContent("password_reset");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/ops/events", { params: { severity: "problem", hours: 0, limit: 20, state: "open" } });
  expect(screen.getByTestId("ops-overview-source-email")).toHaveTextContent("4 auffällig");
  expect(screen.getByTestId("ops-overview-source-audit")).not.toHaveTextContent("auffällig");
  expect(screen.getByTestId("ops-overview-ack-all")).toHaveTextContent("Alle quittieren (5)");
  expect(screen.getByTestId("ops-overview-more")).toHaveTextContent("Alle 5 offenen ansehen");
});

test("ein Tipp auf eine auffällige Kachel öffnet genau deren offene Einträge", async () => {
  const user = userEvent.setup();
  const onOpenSource = renderOverview();
  await user.click(await screen.findByTestId("ops-overview-source-email"));
  expect(onOpenSource).toHaveBeenLastCalledWith("email", { state: "open" });
  await user.click(screen.getByTestId("ops-overview-source-audit"));
  expect(onOpenSource).toHaveBeenLastCalledWith("audit", {});
});

test("ein Eintrag lässt sich quittieren und verschwindet nach dem Neuladen", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { source: "email", count: 2 } });
  renderOverview();
  await screen.findByTestId("ops-event-email");
  apiMock.get.mockResolvedValue({ data: { ...OPEN, items: [CHECK] } });
  await user.click(screen.getByTestId("ops-event-ack-m1"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/events/ack", { source: "email", id: "m1" });
  await waitFor(() => expect(screen.queryByTestId("ops-event-email")).toBeNull());
  expect(toastMock.success).toHaveBeenCalledWith("Quittiert – dazu ein gleicher Eintrag.");
});

test("Alle quittieren fragt in der Seite nach, Abbrechen tut nichts, danach steht Alles erledigt", async () => {
  const user = userEvent.setup();
  const confirmSpy = vi.spyOn(window, "confirm");
  apiMock.post.mockResolvedValue({ data: { acknowledged: { email: 4, checks: 1 }, total: 5 } });
  renderOverview();
  await user.click(await screen.findByTestId("ops-overview-ack-all"));
  const dialog = await screen.findByTestId("confirm-dialog");
  expect(dialog).toHaveTextContent("5 Einträge quittieren?");
  await user.click(within(dialog).getByTestId("confirm-dialog-cancel"));
  expect(apiMock.post).not.toHaveBeenCalled();

  await user.click(screen.getByTestId("ops-overview-ack-all"));
  apiMock.get.mockResolvedValue({ data: DONE });
  await user.click(within(await screen.findByTestId("confirm-dialog")).getByTestId("confirm-dialog-confirm"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/events/ack-all", {});
  expect(await screen.findByTestId("ops-overview-done")).toHaveTextContent("Alles erledigt");
  expect(screen.queryByTestId("ops-overview-ack-all")).toBeNull();
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test("klappt das Quittieren nicht, steht der Grund in der Meldung", async () => {
  const user = userEvent.setup();
  apiMock.post.mockRejectedValue({ response: { data: { detail: "Dafür fehlen dir die Rechte." } } });
  renderOverview();
  await user.click(await screen.findByTestId("ops-event-ack-m1"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Dafür fehlen dir die Rechte."));
});
