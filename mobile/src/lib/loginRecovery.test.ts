import { api } from "./api";
import { PASSWORD_RULE_HINT } from "./passwordRules";
import { cancelMfaChallenge, mfaTicketGone, needsEmailVerification, requestPasswordReset, requestVerificationMail } from "./loginRecovery";

// Wege aus der Anmeldung (#996): dieselben Server-Wege wie die Website - Passwort-Link und Bestätigungs-Mail anfordern,
// ein abgelaufenes MFA-Ticket erkennen. Keine eigenen Endpunkte der App.

jest.mock("./api", () => ({ api: { post: jest.fn() } }));
const post = api.post as jest.Mock;

beforeEach(() => post.mockReset());

const failure = (status: number, detail: string, headers: Record<string, string> = {}) => ({ response: { status, headers, data: { detail } } });

test("Passwort vergessen: derselbe Weg wie die Website, E-Mail ohne Leerzeichen, Satz des Servers", async () => {
  post.mockResolvedValueOnce({ data: { ok: true, message: "Falls diese E-Mail registriert ist, wurde ein Link gesendet." } });
  await expect(requestPasswordReset("  paula@club-mail.at ")).resolves.toBe("Falls diese E-Mail registriert ist, wurde ein Link gesendet.");
  expect(post).toHaveBeenCalledWith("/auth/forgot-password", { email: "paula@club-mail.at" });
});

test("Bestätigungs-Mail: derselbe Weg wie die Website; ohne Satz vom Server ein eigener", async () => {
  post.mockResolvedValueOnce({ data: { ok: true } });
  await expect(requestVerificationMail("paula@club-mail.at")).resolves.toMatch(/Postfach/);
  expect(post).toHaveBeenCalledWith("/auth/resend-verification", { email: "paula@club-mail.at" });
});

test("E-Mail noch nicht bestätigt: am Kennzeichen des Servers erkannt, sonst nicht", () => {
  expect(needsEmailVerification(failure(403, "E-Mail-Adresse noch nicht bestätigt. Bitte …", { "x-auth-error": "email_verification_required" }))).toBe(true);
  // Wie im Web: auch am Anfang des Satzes, falls ein Proxy den Header schluckt.
  expect(needsEmailVerification(failure(403, "E-Mail-Adresse noch nicht bestätigt. Bitte fordere einen Link an."))).toBe(true);
  expect(needsEmailVerification(failure(403, "Account gesperrt"))).toBe(false);
  expect(needsEmailVerification(failure(401, "Ungültige Zugangsdaten"))).toBe(false);
  expect(needsEmailVerification(new Error("Netz"))).toBe(false);
  expect(needsEmailVerification(null)).toBe(false);
});

test("MFA-Ticket weg: am Kennzeichen des Servers erkannt, egal mit welchem Satz", () => {
  expect(mfaTicketGone(failure(401, "Bitte neu anmelden.", { "x-auth-error": "mfa_challenge_invalid" }))).toBe(true);
  expect(mfaTicketGone(failure(401, "Ungültiger MFA- oder Wiederherstellungscode."))).toBe(false);
  expect(mfaTicketGone(failure(401, "Bitte neu anmelden.", { "x-auth-error": "email_verification_required" }))).toBe(false);
});

test("MFA-Ticket weg bei älterem Server ohne Kennzeichen (abgelaufen, verbraucht, anderes Gerät): am Satz; ein falscher Code nicht", () => {
  expect(mfaTicketGone(failure(401, "MFA-Anmeldung ist ungültig oder abgelaufen."))).toBe(true);
  expect(mfaTicketGone(failure(401, "MFA-Anmeldung wurde bereits verwendet."))).toBe(true);
  expect(mfaTicketGone(failure(401, "MFA-Anmeldung gehört zu einem anderen Gerät."))).toBe(true);
  expect(mfaTicketGone(failure(401, "Ungültiger MFA- oder Wiederherstellungscode."))).toBe(false);
  expect(mfaTicketGone(failure(429, "Zu viele Versuche."))).toBe(false);
  expect(mfaTicketGone(new Error("Netz"))).toBe(false);
});

test("Passwort-Hinweis: derselbe Vertrag wie Server und Website (#1509)", () => {
  expect(PASSWORD_RULE_HINT).toBe("Mindestens 10 Zeichen, höchstens 72 Byte (Umlaute zählen doppelt, Emojis vierfach).");
});

test("MFA abbrechen: verwirft die Abfrage am Server; scheitert das, bleibt es still", async () => {
  post.mockResolvedValueOnce({ data: { ok: true } });
  await cancelMfaChallenge("ticket-1");
  expect(post).toHaveBeenCalledWith("/auth/mfa/cancel", { ticket: "ticket-1" });

  post.mockRejectedValueOnce(new Error("offline"));
  await expect(cancelMfaChallenge("ticket-2")).resolves.toBeUndefined();
  post.mockClear();
  await cancelMfaChallenge("");
  expect(post).not.toHaveBeenCalled();
});
