import { Alert } from "react-native";
import { FRIENDS_HINT_TEXT, offerFriendsHint } from "./friendsHint";

// Der einmalige Hinweis direkt nach der ersten Anmeldung (#1188 Teil 2): nur wenn der Server ihn fällig meldet, dann
// mit „Verstanden“ und „Ausschalten“; ein Fehler beim Fragen zeigt nichts.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("./api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));

type AlertButton = { text?: string; onPress?: () => void };
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => alertSpy.mockRestore());

test("nicht fällig oder Fehler: kein Hinweis", async () => {
  mockGet.mockResolvedValueOnce({ data: { due: false, sharing: true } });
  expect(await offerFriendsHint()).toBe(false);
  mockGet.mockRejectedValueOnce(new Error("offline"));
  expect(await offerFriendsHint()).toBe(false);
  expect(mockGet).toHaveBeenCalledWith("/users/me/friends-hint");
  expect(alertSpy).not.toHaveBeenCalled();
});

test("fällig: der Hinweis mit „Ausschalten“ und „Verstanden“", async () => {
  mockGet.mockResolvedValue({ data: { due: true, sharing: true } });
  mockPost.mockResolvedValue({ data: { sharing: false } });
  expect(await offerFriendsHint()).toBe(true);
  expect(alertSpy).toHaveBeenCalledTimes(1);
  const [, message, buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
  expect(message).toContain(FRIENDS_HINT_TEXT);
  expect(buttons.map((button) => button.text)).toEqual(["Ausschalten", "Verstanden"]);

  buttons[0].onPress?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockPost).toHaveBeenCalledWith("/users/me/friends-hint", { turn_off: true });
  buttons[1].onPress?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockPost).toHaveBeenLastCalledWith("/users/me/friends-hint", { turn_off: false });
});
