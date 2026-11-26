import type { ApplicationTone, CarryOver } from "./leagueTeam";
import { viennaDateTime } from "./vienna";

// Startrechte für die nächste Season in der App (#1627, docs/LIGA.md „F.2a Startrechte für die nächste Season“): die Sätze für das
// eigene Co-Team unter dem Antrag - dieselben wie im Web (frontend/src/lib/leagueStartRights.js, StartRightBlock.jsx). Zustände,
// Fristen und die Nachrückerregel rechnet der Server; ob Zusagen oder Ablehnen geht, sagt er mit `can_accept` und `can_decline`.

/** `carry_over.start_right` in `GET /api/me/league-applications` - nur, wenn die Season Startrechte führt. */
export type StartRight = {
  state?: string | null;
  accept_until?: string | null;
  paused?: boolean;
  waits_for_lead?: boolean;
  accepted_at?: string | null;
  fills?: { from_label?: string | null; own_open?: boolean; rest_days?: number | null } | null;
  can_accept?: boolean;
  can_decline?: boolean;
};

export type StartRightCarry = CarryOver & { start_right?: StartRight | null };

/** `start_rights[]` in `GET /api/me/league-applications`: vor der Folge-Season die Prognose bzw. das bestätigte Startrecht. */
export type StartRightOutlook = {
  squad_id?: string;
  season_id?: string;
  title?: string;
  url?: string | null;
  state?: "forecast" | "confirmed" | string | null;
  movement?: string | null;
  division_label?: string | null;
  zone_label?: string | null;
  rank?: number | null;
};

const LONG: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const MOVEMENT_TEXT: Record<string, string> = { up: "Aufstieg", down: "Abstieg", stay: "bleibt" };

/** „15.12.2026, 18:00 Uhr“ in Wiener Zeit - leer ohne Frist. */
export function untilText(value?: string | null): string {
  return value ? `${viennaDateTime(value, LONG)} Uhr` : "";
}

/** Der Satz für das eigene Co-Team unter dem Antrag. Leer ohne Startrecht (Season ohne die Einstellung) und sobald es zugeteilt ist. */
export function rightLine(carry?: StartRightCarry | null): string {
  const right = carry?.start_right;
  if (!right) return "";
  const label = carry?.division_label;
  const back = right.fills?.from_label;
  if (right.state === "offered") {
    // Startdatum erreicht und Frist vorbei: Es verfällt nicht mehr von selbst - die Leitung entscheidet.
    if (right.waits_for_lead) return `Die Frist für die Zusage zu ${label} ist vorbei. Jetzt entscheidet die Liga-Leitung – meldet euch dort.`;
    // Pause: Der Endstand der Vorgänger-Season wird geprüft, die Frist steht still und ist danach um diese Zeit länger.
    if (right.paused && right.fills) return `Nachgerückt: In ${label} ist ein Platz frei geworden. Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird. Zusagen oder ablehnen geht trotzdem – ohne Antwort bleibt ihr in ${back}.`;
    if (right.paused) return `Startrecht für ${label}: Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird – danach läuft sie um diese Zeit länger. Zusagen geht trotzdem.`;
    // Die eigene Zusage ist noch offen: Ihre Frist ruht, solange das Angebot offen ist. Ablehnen gilt als Zusage für die eigene Liga.
    if (right.fills?.own_open) {
      const days = Number(right.fills.rest_days) || 0;
      const rest = days ? `, mindestens ${days} ${days === 1 ? "Tag" : "Tage"}` : "";
      return `Nachgerückt: In ${label} ist ein Platz frei geworden. Bitte bis ${untilText(right.accept_until)} zusagen oder ablehnen. Eure Frist für ${back} ruht so lange. Ablehnen gilt als Zusage für ${back}. Ohne Antwort bleibt ihr in ${back} und habt dort noch die restliche Frist${rest}.`;
    }
    if (right.fills) return `Nachgerückt: In ${label} ist ein Platz frei geworden. Bitte bis ${untilText(right.accept_until)} zusagen oder ablehnen – ohne Antwort bleibt ihr in ${back}.`;
    return `Startrecht für ${label}: bitte bis ${untilText(right.accept_until)} zusagen. Ohne Zusage verfällt es.`;
  }
  if (right.state === "confirmed" && right.fills) return `Nachgerückt in ${label}. Wer lieber in ${back} bleibt, lehnt bis zum Start ab.`;
  if (right.state === "accepted") return `Zugesagt für ${label}. Die Staffel teilt die Liga-Leitung noch zu.`;
  if (right.state === "expired") return "Das Startrecht ist verfallen: Die Frist für die Zusage ist vorbei.";
  return "";
}

/** Die Rückfrage vor „Nachrücken ablehnen“: Mit offener eigener Zusage gilt das Ablehnen zugleich als Zusage für die eigene Liga. */
export function declineText(carry?: StartRightCarry | null): string {
  const back = carry?.start_right?.fills?.from_label || "eurer Liga";
  const own = carry?.start_right?.fills?.own_open ? ` – das gilt zugleich als eure Zusage für ${back}` : "";
  return `Ihr bleibt in ${back}${own}. Der Platz in ${carry?.division_label} geht an das nächste Team, zurück geht das nicht.`;
}

/** Die Meldung nach „Startrecht annehmen“ bzw. „Nachrücken ablehnen“. */
export function startRightToast(action: "accept" | "decline", carry?: StartRightCarry | null): string {
  const right = carry?.start_right;
  if (action === "accept") return `Zugesagt für ${carry?.division_label}. Die Staffel teilt die Liga-Leitung noch zu.`;
  return `Abgelehnt. Ihr bleibt in ${right?.fills?.from_label || "eurer Liga"}${right?.fills?.own_open ? " – das gilt als eure Zusage dort" : ""}.`;
}

/** Das Abzeichen am Antrag des eigenen Teams - leer heißt: wie bisher (`teamStateLabel`). */
export function teamBadge(row?: { carry_over?: StartRightCarry | null } | null): string {
  const right = row?.carry_over?.start_right;
  if (right?.state === "offered" && right.waits_for_lead) return "Startrecht – Leitung entscheidet";
  if (right?.state === "offered") return "Startrecht – Zusage offen";
  if (right?.state === "accepted") return "Zugesagt – Zuteilung folgt";
  if (right?.state === "expired") return "Startrecht verfallen";
  return "";
}

/** Die Farbe dazu: offen fällt auf, verfallen ist gedämpft - `null` heißt: die Farbe des Antrags. */
export function teamBadgeTone(row?: { carry_over?: StartRightCarry | null } | null): ApplicationTone | null {
  const state = row?.carry_over?.start_right?.state;
  if (state === "offered") return "warn";
  return state === "expired" ? "quiet" : null;
}

/** Vor der Folge-Season: Prognose aus der laufenden Tabelle bzw. bestätigtes Startrecht aus dem Endstand. */
export function outlookLine(item?: StartRightOutlook | null): string {
  if (!item) return "";
  const move = item.movement === "stay" ? "bleibt in der Liga" : MOVEMENT_TEXT[String(item.movement)] || "";
  if (item.state === "forecast") {
    const place = item.rank ? ` (Platz ${item.rank})` : "";
    return `Prognose nach der laufenden Tabelle: ${move}${place}. Fest ist das erst, wenn die Season abgeschlossen ist.`;
  }
  const way = item.movement === "stay" ? "" : ` (${move})`;
  return `Bestätigt: Startrecht für ${item.division_label} in der nächsten Season${way}. Zusagen geht, sobald die neue Season angelegt ist.`;
}

/** Das Abzeichen am Ausblick: bestätigt grün, die Prognose still. */
export function outlookBadge(item?: StartRightOutlook | null): { label: string; tone: ApplicationTone } {
  return item?.state === "confirmed" ? { label: "Startrecht bestätigt", tone: "ok" } : { label: "Prognose", tone: "quiet" };
}
