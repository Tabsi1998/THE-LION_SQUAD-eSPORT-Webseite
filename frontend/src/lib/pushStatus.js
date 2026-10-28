// Push-Tests (#2119 ML8): was der Push-Dienst (Expo) zurückmeldet, in Alltagssprache. „Ticket“ heißt: der Dienst hat
// die Nachricht angenommen; „Receipt“: Apple oder Google haben sie ans Handy weitergegeben.

const STATES = { ok: "ja", error: "Fehler" };

const ERRORS = [
  ["DeviceNotRegistered", "App gelöscht oder Push am Handy abgeschaltet"],
  ["MessageRateExceeded", "Zu viele Nachrichten in kurzer Zeit"],
  ["InvalidCredentials", "Zugang zum Push-Dienst stimmt nicht (Server-Einstellung)"],
  ["MessageTooBig", "Nachricht zu lang"],
  ["MismatchSenderId", "Zugang zum Push-Dienst stimmt nicht (Server-Einstellung)"],
];

export function pushStateLabel(value) {
  if (!value) return "–";
  return STATES[value] || value;
}

export function pushErrorLabel(value) {
  const text = String(value || "");
  if (!text) return "";
  const known = ERRORS.find(([code]) => text.startsWith(code));
  return known ? known[1] : text;
}
