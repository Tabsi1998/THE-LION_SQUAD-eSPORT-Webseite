import { pushErrorLabel, pushStateLabel } from "./pushStatus";

// Push-Tests (#2119 ML8): Rohwerte des Push-Dienstes (Ticket, Receipt, DeviceNotRegistered …) in Alltagssprache.

test("Stand: ok heißt ja, error heißt Fehler, leer heißt noch offen", () => {
  expect(pushStateLabel("ok")).toBe("ja");
  expect(pushStateLabel("error")).toBe("Fehler");
  expect(pushStateLabel("")).toBe("–");
  expect(pushStateLabel(undefined)).toBe("–");
  expect(pushStateLabel("pending")).toBe("pending");
});

test("bekannte Fehler auf Deutsch, unbekannte bleiben lesbar", () => {
  expect(pushErrorLabel("DeviceNotRegistered")).toBe("App gelöscht oder Push am Handy abgeschaltet");
  expect(pushErrorLabel("DeviceNotRegistered: \"ExponentPushToken[x]\" is not a registered push notification recipient")).toBe("App gelöscht oder Push am Handy abgeschaltet");
  expect(pushErrorLabel("MessageRateExceeded")).toBe("Zu viele Nachrichten in kurzer Zeit");
  expect(pushErrorLabel("InvalidCredentials")).toBe("Zugang zum Push-Dienst stimmt nicht (Server-Einstellung)");
  expect(pushErrorLabel("MessageTooBig")).toBe("Nachricht zu lang");
  expect(pushErrorLabel("irgendwas anderes")).toBe("irgendwas anderes");
  expect(pushErrorLabel("")).toBe("");
});
