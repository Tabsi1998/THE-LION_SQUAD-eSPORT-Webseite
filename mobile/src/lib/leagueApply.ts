import { viennaDate } from "./vienna";

// Mit Co-Team anmelden in der App (#2542, docs/LIGA.md „B.4 Selbstanmeldung“, Web: pages/public/LeagueApplyPage.jsx und
// lib/leagueApplications.js, lib/leaguePlatform.js): vier Schritte ohne Vorwissen - Co-Team wählen, Prüfung im Klartext, Regeln und
// Datenschutz zustimmen, einreichen. Dieselben Regeln und Sätze wie im Web; geprüft wird beim Einreichen noch einmal auf dem Server.

export type ApplyRules = { version_id?: string | null; title?: string | null; label?: string | null; valid_from?: string | null; url?: string | null; pdf_url?: string | null };
export type ApplyPlatform = {
  field_label?: string | null;
  allowed?: string[] | null;
  crossplay?: boolean | null;
  input_device?: string | null;
  divisions?: Array<ApplyPlatform & { label?: string; differs?: boolean }> | null;
};
export type ApplySquad = {
  squad_id: string;
  team_id?: string | null;
  display_name?: string | null;
  member_count?: number | null;
  state?: string | null;
  can_apply?: boolean;
  problems?: string[] | null;
  warnings?: string[] | null;
  shortfall?: string | null;
  application?: { staffel?: string | null; staffel_left?: boolean } | null;
};
export type ApplyView = {
  application?: { state?: string | null; auto_accept?: boolean } | null;
  squads?: ApplySquad[] | null;
  season_problems?: string[] | null;
  hint?: string | null;
  rules?: ApplyRules | null;
  privacy?: { text?: string | null; url?: string | null } | null;
  platform?: ApplyPlatform | null;
};

export const APPLY_STEPS = ["Co-Team", "Prüfung", "Zustimmen", "Einreichen"] as const;
export const APPLY_TITLES = ["Welches Co-Team meldest du an?", "Passt alles?", "Regeln und Datenschutz", "Alles richtig?"] as const;

// Solange das Co-Team hier steht, läuft sein Antrag.
const RUNNING = new Set(["submitted", "in_review", "accepted", "waitlist"]);
const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;
const DEVICE_LABELS: Record<string, string> = { controller: "Controller", mouse_keyboard: "Maus und Tastatur", both: "Controller oder Maus und Tastatur" };

/** `/liga/<liga>/<season>/anmelden` - nur echte Namen, sonst null. */
export function applyParams(url?: string | null): { league: string; season: string } | null {
  const parts = String(url || "").split(/[?#]/)[0].split("/").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== "liga" || parts[3] !== "anmelden") return null;
  return SEGMENT.test(parts[1]) && SEGMENT.test(parts[2]) ? { league: parts[1], season: parts[2] } : null;
}

export function applyApiPath(league: string, season: string): string {
  return `/leagues/${encodeURIComponent(league)}/${encodeURIComponent(season)}/application`;
}

/** Ist dieses Co-Team im Assistenten wählbar? Ein laufender Antrag steht nur da. */
export function isSelectable(row?: Pick<ApplySquad, "can_apply" | "state"> | null): boolean {
  return Boolean(row?.can_apply) && !RUNNING.has(String(row?.state));
}

/** Der Knopf „Mit Co-Team anmelden“: Fenster offen, die Season ohne Probleme, mindestens ein freies Co-Team. */
export function canStartApplication(view?: ApplyView | null): boolean {
  if (view?.application?.state !== "open" || view?.season_problems?.length) return false;
  return (view?.squads || []).some((row) => isSelectable(row));
}

/** Darf es zum nächsten Schritt gehen? */
export function canGoOn(step: number, row: ApplySquad | null | undefined, view: ApplyView | null | undefined, acceptRules: boolean, acceptPrivacy: boolean): boolean {
  if (step === 0) return Boolean(row);
  if (step === 1) return Boolean(row) && !(view?.season_problems || []).length && !(row?.problems || []).length;
  if (step === 2) return acceptRules && acceptPrivacy && Boolean(view?.rules);
  return false;
}

/** Nach dem Einreichen: was jetzt gilt - mit „automatisch annehmen“ entscheidet die Season gleich (#2348). */
export function submittedText(status?: string | null): string {
  if (status === "accepted") return "Angemeldet. Ihr habt einen Startplatz.";
  if (status === "waitlist") return "Eingereicht. Ihr steht auf der Warteliste.";
  return "Anmeldung eingereicht. Die Liga-Leitung prüft sie jetzt.";
}

/** „PC“, „PC und Xbox“, „PC, PlayStation und Xbox“ - wie der Server. */
function platformWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
}

function allowedText(allowed?: string[] | null): string {
  return allowed?.length ? `nur ${platformWords(allowed.map(String))}` : "alle Plattformen";
}

/** Ein Satz je Angabe der Plattform (#2270). Ohne Angabe: nichts. */
export function platformLines(platform?: ApplyPlatform | null): string[] {
  if (!platform) return [];
  const lines: string[] = [];
  if (platform.allowed?.length) lines.push(`${platform.field_label || "Plattform"}: ${allowedText(platform.allowed)}.`);
  if (platform.crossplay === true) lines.push("Crossplay: an, plattformübergreifend.");
  if (platform.crossplay === false) lines.push("Crossplay: aus.");
  if (platform.input_device) lines.push(`Eingabegerät: ${DEVICE_LABELS[platform.input_device] || platform.input_device}.`);
  return lines;
}

/** Kurzfassung einer Liga N mit eigener Regel: „nur PC · Crossplay aus · Controller“. */
export function platformShort(view?: ApplyPlatform | null): string {
  if (!view) return "";
  const parts = [allowedText(view.allowed)];
  if (view.crossplay === true) parts.push("Crossplay an");
  if (view.crossplay === false) parts.push("Crossplay aus");
  if (view.input_device) parts.push(DEVICE_LABELS[view.input_device] || view.input_device);
  return parts.join(" · ");
}

/** Ein Tag wie „2026-11-01“ als „01.11.2026“ - ohne Uhrzeit nie über die Zeitzone verschoben. */
export function dayText(value?: string | null): string {
  const text = String(value || "");
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) return `${day[3]}.${day[2]}.${day[1]}`;
  return text ? viennaDate(text, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}
