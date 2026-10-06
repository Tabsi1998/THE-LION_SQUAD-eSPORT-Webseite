import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Sitzungsliste (#942): App-Sitzungen zeigen das Gerät vom Server („Pixel 9 / Android 16“), ältere nur „Mobile“;
// Browser-Sitzungen weiter Browser und System aus dem User-Agent; Abmelden einer Sitzung ruft den Server.

const apiMock = { get: vi.fn(), delete: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { SessionsPanel, parseSessionDevice } = await import("./SessionsPanel");

const ROWS = [
  { id: "s-web", client: "web", user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130", current: true, created_at: "2026-10-06T08:00:00+02:00", last_active: "2026-10-06T09:00:00+02:00", expires_at: "2027-01-04T09:00:00+01:00" },
  { id: "s-app", client: "mobile", user_agent: "okhttp/4.12.0", device: "Pixel 9 / Android 16", current: false, created_at: "2026-10-05T18:00:00+02:00", last_active: "2026-10-06T07:30:00+02:00", expires_at: "2027-01-04T07:30:00+01:00" },
  { id: "s-old", client: "mobile", user_agent: "okhttp/4.12.0", device: "", current: false, created_at: "2026-09-20T18:00:00+02:00", last_active: "2026-09-20T18:00:00+02:00", expires_at: "2026-12-19T18:00:00+01:00" },
];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.delete.mockReset();
  apiMock.get.mockResolvedValue({ data: ROWS });
  apiMock.delete.mockResolvedValue({ data: { ok: true, current: false } });
});

test("parseSessionDevice: App mit Gerät, App ohne Gerät, Browser", () => {
  expect(parseSessionDevice("okhttp/4.12.0", "mobile", "Pixel 9 / Android 16")).toEqual({ browser: "Lion Squad App", os: "Pixel 9 / Android 16", mobile: true });
  expect(parseSessionDevice("okhttp/4.12.0", "mobile")).toEqual({ browser: "Lion Squad App", os: "Mobile", mobile: true });
  expect(parseSessionDevice("Mozilla/5.0 (Windows NT 10.0) Chrome/130", "web")).toEqual({ browser: "Chrome", os: "Windows", mobile: false });
});

test("die Liste nennt das Gerät der App und meldet eine Sitzung auf Wunsch ab", async () => {
  render(<SessionsPanel />);
  await waitFor(() => expect(screen.getByTestId("session-row-s-app")).toBeInTheDocument());
  expect(screen.getByTestId("session-row-s-app")).toHaveTextContent("Lion Squad App · Pixel 9 / Android 16");
  expect(screen.getByTestId("session-row-s-old")).toHaveTextContent("Lion Squad App · Mobile");
  expect(screen.getByTestId("session-row-s-web")).toHaveTextContent("Chrome · Windows");
  expect(screen.getByTestId("session-row-s-web")).toHaveTextContent("Dieses Gerät");

  const appRow = screen.getByTestId("session-row-s-app");
  fireEvent.click(appRow.querySelector("button"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/auth/sessions/s-app"));
});
