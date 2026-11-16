import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

// Push-Geräte (#2467): oben die aktiven, die abgemeldeten grau und eingeklappt unter „Alte Geräte (n)“; rot nur bei einem
// Fehler an einem aktiven Gerät. „Alte Geräte entfernen“ fragt in der Seite nach.

const { apiMock, toastMock, confirmMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  toastMock: { success: vi.fn(), error: vi.fn() },
  confirmMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

import AdminMobilePushPage from "./AdminMobilePushPage";

const USER = { id: "u1", username: "tabsi98", display_name: "Tabsi98", token_count: 4, enabled_token_count: 1, disabled_token_count: 3, has_enabled_token: true, active_error: null,
  last_receipt_error: "DeviceNotRegistered", latest_updated_at: "2026-11-15T10:00:00+00:00" };

function status(overrides = {}) {
  return {
    user: { id: "u1", username: "tabsi98", display_name: "Tabsi98" },
    enabled_count: 1,
    disabled_count: 3,
    has_enabled_token: true,
    tokens: [
      { token_preview: "ExponentPushToken[aktiv...", platform: "android", enabled: true, last_ticket_status: "ok", last_receipt_status: "ok" },
      ...[1, 2, 3].map((n) => ({ token_preview: `ExponentPushToken[alt${n}...`, platform: "android", enabled: false, disabled_at: "2026-11-01T10:00:00+00:00",
        last_receipt_status: "error", last_receipt_error: "DeviceNotRegistered" })),
    ],
    ...overrides,
  };
}

function routeGet(statusData) {
  apiMock.get.mockImplementation((url) => {
    if (url.startsWith("/admin/mobile-push/users")) return Promise.resolve({ data: [USER] });
    if (url.startsWith("/admin/mobile-push/status/")) return Promise.resolve({ data: statusData });
    return Promise.reject(new Error(url));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeGet(status());
});

test("oben steht nur das aktive Gerät, die alten sind grau eingeklappt und zeigen keinen roten Fehler", async () => {
  const user = userEvent.setup();
  render(<AdminMobilePushPage />);

  const list = await screen.findByTestId("push-user-u1");
  expect(within(list).getByText(/1 Gerät aktiv/)).toBeInTheDocument();
  expect(within(list).getByText(/3 alte/)).toBeInTheDocument();
  expect(within(list).queryByText(/von 4 Geräten/)).toBeNull();
  // Der Fehler des zuletzt geänderten Geräts gehört zu einem abgemeldeten Handy - links steht deshalb nichts Rotes.
  expect(within(list).queryByText("App gelöscht oder Push am Handy abgeschaltet")).toBeNull();

  const toggle = await screen.findByTestId("push-old-devices-toggle");
  expect(toggle).toHaveTextContent("Alte Geräte (3)");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Eingeklappt verborgen, aber im DOM: aria-controls zeigt auf ein vorhandenes Ziel.
  expect(screen.getByTestId("push-old-devices-list")).not.toBeVisible();
  expect(screen.getByTestId("push-old-devices-list").id).toBe(toggle.getAttribute("aria-controls"));
  expect(screen.queryByText("App gelöscht oder Push am Handy abgeschaltet")).toBeNull();

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const old = screen.getByTestId("push-old-devices-list");
  expect(old).toBeVisible();
  expect(within(old).getAllByText("abgemeldet – App gelöscht oder neu installiert")).toHaveLength(3);
  expect(within(old).queryByText("App gelöscht oder Push am Handy abgeschaltet")).toBeNull();
});

test("ein Fehler an einem aktiven Gerät bleibt rot", async () => {
  apiMock.get.mockImplementation((url) => {
    if (url.startsWith("/admin/mobile-push/users")) return Promise.resolve({ data: [{ ...USER, active_error: "MessageRateExceeded" }] });
    return Promise.resolve({ data: status({ disabled_count: 0, tokens: [
      { token_preview: "ExponentPushToken[aktiv...", platform: "android", enabled: true, last_ticket_status: "error", last_ticket_error: "MessageRateExceeded" },
    ] }) });
  });
  render(<AdminMobilePushPage />);

  const list = await screen.findByTestId("push-user-u1");
  expect(within(list).getByText("Zu viele Nachrichten in kurzer Zeit")).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText("Zu viele Nachrichten in kurzer Zeit").length).toBeGreaterThan(1));
  expect(screen.queryByTestId("push-old-devices-toggle")).toBeNull();
});

test("Alte Geräte entfernen fragt nach und löscht erst nach dem Ja", async () => {
  const user = userEvent.setup();
  apiMock.delete.mockResolvedValue({ data: { ok: true, removed: 3 } });
  render(<AdminMobilePushPage />);

  const button = await screen.findByTestId("push-old-devices-remove");
  confirmMock.mockResolvedValueOnce(false);
  await user.click(button);
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Alte Geräte entfernen?", confirmLabel: "Entfernen" }));
  expect(apiMock.delete).not.toHaveBeenCalled();

  confirmMock.mockResolvedValueOnce(true);
  routeGet(status({ disabled_count: 0, tokens: status().tokens.slice(0, 1) }));
  await user.click(button);
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/mobile-push/old-devices/u1"));
  expect(toastMock.success).toHaveBeenCalledWith("3 alte Geräte entfernt.");
  await waitFor(() => expect(screen.queryByTestId("push-old-devices-toggle")).toBeNull());
});
