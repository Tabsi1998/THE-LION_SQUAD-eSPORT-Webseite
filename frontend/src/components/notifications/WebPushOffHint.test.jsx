import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der leise Hinweis (#1208): nur mit Konto, nur wenn der Server Web-Push anbietet und der Browser abgelehnt hat. Er führt
// zu Einstellungen → Benachrichtigungen; kommt man mit erlaubtem Browser zurück, ist er weg.

const authState = { user: { id: "u1" } };
const configMock = vi.fn(async () => ({ enabled: true, public_key: "BQQ" }));
const blockedMock = vi.fn(() => true);
vi.mock("@/lib/webPush", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadWebPushConfig: () => configMock(), webPushBlocked: () => blockedMock() };
});

const { WEB_PUSH_OFF_ACTION, WEB_PUSH_OFF_TEXT, WebPushOffHint, resetWebPushOffHintCache } = await import("./WebPushOffHint");

async function show(props = {}) {
  render(<MemoryRouter><WebPushOffHint user={authState.user} {...props} /></MemoryRouter>);
  await act(async () => {});
}

beforeEach(() => {
  resetWebPushOffHintCache();
  authState.user = { id: "u1" };
  configMock.mockReset();
  configMock.mockResolvedValue({ enabled: true, public_key: "BQQ" });
  blockedMock.mockReset();
  blockedMock.mockReturnValue(true);
});

test("Browser hat abgelehnt: die leise Zeile führt zu den Einstellungen", async () => {
  await show();
  const hint = screen.getByTestId("web-push-off");
  expect(hint).toHaveTextContent(`${WEB_PUSH_OFF_TEXT} – ${WEB_PUSH_OFF_ACTION}`);
  expect(hint).toHaveTextContent("Aufrufe sind aus – einschalten");
  // Direkt zur Karte „Dieser Browser“, die erklärt, wie man es im Browser erlaubt.
  expect(hint).toHaveAttribute("href", "/profile?tab=notifications#dieser-browser");
  expect(hint.className).toContain("min-h-[44px]");
});

test("nicht abgelehnt: keine Zeile und keine Frage an den Server", async () => {
  blockedMock.mockReturnValue(false);
  await show();
  expect(screen.queryByTestId("web-push-off")).toBeNull();
  expect(configMock).not.toHaveBeenCalled();
});

test("ohne Web-Push am Server, ohne Konto oder nach dem Ende: keine Zeile", async () => {
  configMock.mockResolvedValue({ enabled: false });
  await show();
  resetWebPushOffHintCache();
  expect(screen.queryByTestId("web-push-off")).toBeNull();

  configMock.mockResolvedValue({ enabled: true, public_key: "BQQ" });
  authState.user = null;
  await show({ testId: "ohne-konto" });
  expect(screen.queryByTestId("ohne-konto")).toBeNull();

  authState.user = { id: "u1" };
  await show({ show: false, testId: "vorbei" });
  expect(screen.queryByTestId("vorbei")).toBeNull();
});

test("zurück mit erlaubtem Browser: die Zeile ist weg", async () => {
  await show();
  expect(screen.getByTestId("web-push-off")).toBeInTheDocument();
  blockedMock.mockReturnValue(false);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(screen.queryByTestId("web-push-off")).toBeNull();
});

test("die Einstellung des Servers kommt einmal je Sitzung, nicht bei jedem Fokuswechsel", async () => {
  await show();
  expect(screen.getByTestId("web-push-off")).toBeInTheDocument();
  for (let i = 0; i < 3; i += 1) await act(async () => { window.dispatchEvent(new Event("focus")); });
  await show({ testId: "zweite-seite" });
  expect(screen.getByTestId("zweite-seite")).toBeInTheDocument();
  expect(configMock).toHaveBeenCalledTimes(1);
});
