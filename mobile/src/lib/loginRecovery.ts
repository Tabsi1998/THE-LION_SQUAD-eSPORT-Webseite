import { api } from "./api";

// Wege aus der Anmeldung (#996): die App nutzt dieselben Server-Wege wie die Website - keine eigenen Endpunkte.
// Den Link zum Zurücksetzen bzw. Bestätigen schickt der Server per Mail; er öffnet die Website. Danach meldet man sich
// in der App wieder an. Die Antworten verraten nicht, ob es die Adresse gibt - die App zeigt den Satz des Servers.

type ServerError = { response?: { status?: number; headers?: Record<string, unknown>; data?: { detail?: unknown } } } | null;

function failure(error: unknown) {
  const response = (error as ServerError)?.response;
  const detail = response?.data?.detail;
  return { status: response?.status, headers: response?.headers || {}, detail: typeof detail === "string" ? detail : "" };
}

const PASSWORD_SENT = "Falls diese E-Mail registriert ist, wurde ein Link gesendet.";
const VERIFICATION_SENT = "Falls eine Bestätigung aussteht, wurde der Versand angefordert. Bitte prüfe in einigen Minuten dein Postfach und den Spam-Ordner.";

/** Link zum Zurücksetzen anfordern (derselbe Weg wie „Passwort vergessen?“ im Web). */
export async function requestPasswordReset(email: string): Promise<string> {
  const { data } = await api.post<{ message?: string }>("/auth/forgot-password", { email: email.trim() });
  return data?.message || PASSWORD_SENT;
}

/** Bestätigungs-Mail neu anfordern (derselbe Weg wie „Keine Bestätigungs-E-Mail erhalten?“ im Web). */
export async function requestVerificationMail(email: string): Promise<string> {
  const { data } = await api.post<{ message?: string }>("/auth/resend-verification", { email: email.trim() });
  return data?.message || VERIFICATION_SENT;
}

/** Die Anmeldung scheiterte nur, weil die E-Mail-Adresse noch nicht bestätigt ist - wie im Web am Kennzeichen erkannt. */
export function needsEmailVerification(error: unknown): boolean {
  const { status, headers, detail } = failure(error);
  if (status !== 403) return false;
  return String(headers["x-auth-error"] || "") === "email_verification_required" || /^E-Mail-Adresse noch nicht bestätigt\./.test(detail);
}

/**
 * Die MFA-Abfrage gilt nicht mehr (abgelaufen, schon verwendet, abgebrochen, abgelöst, zu viele Versuche oder ein
 * anderes Gerät): dann hilft kein weiterer Code, nur eine neue Anmeldung. Ein falscher Code lässt die Abfrage offen.
 * Der Server sagt das mit dem Kennzeichen `X-Auth-Error: mfa_challenge_invalid`.
 */
export function mfaTicketGone(error: unknown): boolean {
  const { status, headers, detail } = failure(error);
  if (status !== 401) return false;
  if (String(headers["x-auth-error"] || "") === "mfa_challenge_invalid") return true;
  // Rückfall für ältere Server ohne Kennzeichen: dort beginnen nur diese Sätze mit „MFA-Anmeldung“ - ein falscher Code
  // heißt „Ungültiger MFA- oder Wiederherstellungscode.“. Kann weg, wenn kein Server ohne Kennzeichen mehr läuft.
  return !headers["x-auth-error"] && detail.startsWith("MFA-Anmeldung");
}

/**
 * MFA-Abfrage abbrechen (#996): der Server verwirft sie, statt sie noch Minuten gelten zu lassen. Klappt das nicht
 * (offline), bleibt es still - die Abfrage läuft dann von selbst ab.
 */
export async function cancelMfaChallenge(ticket: string): Promise<void> {
  if (!ticket) return;
  try {
    await api.post("/auth/mfa/cancel", { ticket });
  } catch {
    // still: die Abfrage läuft von selbst ab
  }
}
