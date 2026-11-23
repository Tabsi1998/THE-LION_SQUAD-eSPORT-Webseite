import { WEB_BASE_URL } from "./siteUrls";

// Kontakt mit Thema (#2131 KO9 und FI13, Nachzug #2173): wie die Links im Web (ErrorPages.jsx, InvoicesPanel.jsx). Die
// Kontaktseite liest `from` nur als Pfad und `version` nur als kurze Versionsnummer - hier geht nichts anderes hinein.

const enc = encodeURIComponent;

/** „Fehler melden“: Thema report_bug, der Bildschirm als `/app/<name>` (nur Buchstaben und Ziffern) und die App-Version. */
export function bugReportUrl(screen?: string | null, version?: string | null): string {
  const name = String(screen || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  const from = name ? `/app/${name}` : "/app";
  const wanted = String(version || "");
  const versionPart = /^[\w.+-]{1,40}$/.test(wanted) ? `&version=${enc(wanted)}` : "";
  return `${WEB_BASE_URL}/contact?topic=report_bug&subject=${enc("Fehler in der App")}&from=${enc(from)}${versionPart}`;
}

/** „Frage zu meiner Rechnung“ an den Kassier - Thema invoice wie im Web. */
export const INVOICE_QUESTION_URL = `${WEB_BASE_URL}/contact?topic=invoice&subject=${enc("Frage zu meiner Rechnung")}`;
