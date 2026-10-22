import { dayNoon, viennaDate } from "./vienna";

// Gemeinsame Schreibweisen der Serien in der App (#1945, #1974): Zahlen mit Komma, ausgeblendete Namen, Tage in Wiener
// Zeit und das Kürzel eines Termins - wie im Web (frontend/src/lib/standingsTable.js, referenceSeriesTable.js,
// referenceCalendar.js, referenceSeriesStaff.js). Saison, Runde, Läufe und Sonderregeln nehmen sie von hier.

export const HIDDEN_NAME = "Name ausgeblendet";

/** Art einer Serie in Worten (lib/references.ts gibt sie weiter). */
export const KIND_LABELS: Record<string, string> = { series: "Turnierserie", racing: "Rennliga", team_league: "Team-Liga" };

export function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Zahl wie in den Tabellen des Webs: Komma statt Punkt, Bruchteile auf eine Stelle gerundet. */
export function formatNumber(value: unknown): string {
  const parsed = number(value);
  const shown = Number.isInteger(parsed) ? parsed : Math.round(parsed * 10) / 10;
  return String(shown).replace(".", ",");
}

/** Name einer Zeile - ausgeblendet oder leer als Hinweis. */
export function nameOf(row: { name?: string | null; name_hidden?: boolean | null } | null | undefined): string {
  return row?.name_hidden || !row?.name ? HIDDEN_NAME : row.name;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** „Do., 05.11.2026“ - leer ohne Tag. */
export function dayLabel(day: string | null | undefined): string {
  if (!day || !DAY_RE.test(day)) return "";
  return viennaDate(dayNoon(day), { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** „05.11.2026“ - leer ohne Tag (Anpassungen, Abbruch, Regeländerungen). */
export function shortDay(day: string | null | undefined): string {
  if (!day || !DAY_RE.test(day)) return "";
  return viennaDate(dayNoon(day), { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** „Do“ - der Wochentag ohne Punkt, leer ohne Tag. */
export function weekdayShort(day: string | null | undefined): string {
  if (!day || !DAY_RE.test(day)) return "";
  return viennaDate(dayNoon(day), { weekday: "short" }).replace(/\.$/, "");
}

/** Kurzname eines Termins: Kürzel, sonst „Termin 3“. */
export function roundLabel(round: { code?: string | null; position?: number | null } | null | undefined): string {
  return String(round?.code || "").trim() || `Termin ${round?.position || ""}`.trim();
}
