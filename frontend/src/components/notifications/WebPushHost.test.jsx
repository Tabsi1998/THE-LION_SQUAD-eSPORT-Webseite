import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Die Frage nach Browser-Benachrichtigungen (#1163): erscheint auf Zuruf (nach einer Anmeldung), wartet, solange der
// Abo-Hinweis offen ist, und merkt sich ein „Nicht jetzt“. „Benachrichtigen“ holt erst dann die Frage des Browsers.

const authState = { user: { id: "u1" } };
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => authState }));
const enableMock = vi.fn();
const syncMock = vi.fn(async () => "skipped");
vi.mock("@/lib/webPush", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, enableWebPush: (...args) => enableMock(...args), syncWebPush: (...args) => syncMock(...args) };
});
vi.mock("@/lib/api", () => ({ api: { get: vi.fn(async () => ({ data: { enabled: false } })), post: vi.fn() } }));

const { WebPushHost } = await import("./WebPushHost");
const { WEB_PUSH_EVENT } = await import("@/lib/webPush");
const { CALENDAR_HINT_CLOSED_EVENT, CALENDAR_HINT_EVENT } = await import("@/lib/calendarHint");

const CONFIG = { enabled: true, public_key: "BQQ" };
const ask = (mode = "ask") => act(() => { window.dispatchEvent(new CustomEvent(WEB_PUSH_EVENT, { detail: { mode, config: CONFIG } })); });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  enableMock.mockReset();
  authState.user = { id: "u1" };
});

test("erscheint erst auf Zuruf und ruft den Browser nur nach einem Klick", async () => {
  enableMock.mockResolvedValue({ ok: true });
  render(<WebPushHost />);
  expect(screen.queryByTestId("web-push-hint")).toBeNull();
  ask();
  const hint = screen.getByTestId("web-push-hint");
  expect(hint).toHaveTextContent("Bescheid sagen, wenn es losgeht?");
  expect(hint.className).toContain("tls-push-hint");
  expect(enableMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByTestId("web-push-hint-allow"));
  expect(enableMock).toHaveBeenCalledWith({ id: "u1" }, CONFIG);
  expect(screen.queryByTestId("web-push-hint")).toBeNull();
});

test("„Nicht jetzt“ merkt sich die Seite", async () => {
  render(<WebPushHost />);
  ask();
  await userEvent.click(screen.getByTestId("web-push-hint-later"));
  expect(screen.queryByTestId("web-push-hint")).toBeNull();
  expect(window.localStorage.getItem("tls-web-push-ask")).toBe("declined");
});

test("wartet, solange der Abo-Hinweis offen ist", () => {
  render(<WebPushHost />);
  act(() => { window.dispatchEvent(new CustomEvent(CALENDAR_HINT_EVENT)); });
  ask();
  expect(screen.queryByTestId("web-push-hint")).toBeNull();
  act(() => { window.dispatchEvent(new CustomEvent(CALENDAR_HINT_CLOSED_EVENT)); });
  expect(screen.getByTestId("web-push-hint")).toBeInTheDocument();
});

test("am iPhone ohne Home-Bildschirm steht, wie es geht - ohne Frage des Browsers", async () => {
  render(<WebPushHost />);
  ask("ios-hint");
  expect(screen.getByTestId("web-push-hint")).toHaveTextContent("Zum Home-Bildschirm");
  expect(screen.queryByTestId("web-push-hint-allow")).toBeNull();
  await userEvent.click(screen.getByTestId("web-push-hint-ok"));
  expect(window.localStorage.getItem("tls-web-push-ask")).toBe("asked");
});

test("ohne Konto keine Frage", () => {
  authState.user = null;
  render(<WebPushHost />);
  ask();
  expect(screen.queryByTestId("web-push-hint")).toBeNull();
});
