import { render, screen, waitFor } from "@testing-library/react";

// Der leise Hinweis „Aufrufe sind aus – einschalten“ (#1208) führt mit #dieser-browser hierher: Die Karte holt sich in den
// Blick, sobald sie weiß, was sie sagt (abgelehnt: wie man es im Browser erlaubt). Ohne Anker bleibt die Seite, wo sie ist.

const statusMock = vi.fn(async () => "denied");
vi.mock("@/lib/webPush", async (importOriginal) => ({ ...(await importOriginal()), browserPushStatus: (...args) => statusMock(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { BROWSER_PUSH_ANCHOR, BrowserPushCard } = await import("./BrowserPushCard");

let scrolled;
beforeEach(() => {
  scrolled = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = scrolled;
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
  delete window.HTMLElement.prototype.scrollIntoView;
});

test("mit #dieser-browser: die Karte kommt in den Blick und erklärt, wie man es im Browser erlaubt", async () => {
  window.history.replaceState(null, "", `/profile?tab=notifications#${BROWSER_PUSH_ANCHOR}`);
  render(<BrowserPushCard user={{ id: "u1" }} config={{ enabled: true }} />);
  const card = screen.getByTestId("profile-browser-push");
  expect(card).toHaveAttribute("id", "dieser-browser");
  await waitFor(() => expect(card).toHaveAttribute("data-status", "denied"));
  expect(screen.getByTestId("profile-browser-push-text")).toHaveTextContent("Website-Einstellungen des Browsers");
  await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
});

test("ohne Anker kein Springen", async () => {
  window.history.replaceState(null, "", "/profile?tab=notifications");
  render(<BrowserPushCard user={{ id: "u1" }} config={{ enabled: true }} />);
  await waitFor(() => expect(screen.getByTestId("profile-browser-push")).toHaveAttribute("data-status", "denied"));
  expect(scrolled).not.toHaveBeenCalled();
});
