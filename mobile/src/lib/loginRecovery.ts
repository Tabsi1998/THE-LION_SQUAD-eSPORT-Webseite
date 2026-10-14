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
 * Die MFA-Abfrage gilt nicht mehr (abgelaufen, schon verwendet, zu viele Versuche oder ein anderes Gerät): dann hilft
 * kein weiterer Code, nur eine neue Anmeldung. Ein falscher Code lässt die Abfrage offen.
 */
export function mfaTicketGone(error: unknown): boolean {
  const { status, detail } = failure(error);
  return status === 401 && detail.startsWith("MFA-Anmeldung");
}
