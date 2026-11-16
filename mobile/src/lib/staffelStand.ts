// Liga-Stand einer Staffel in der App (Folge #2453): Eine Liga-Staffel steht bis „Liga starten“ im Turnier-Status „Entwurf“.
// Das ist ihr einziger Stand vor dem Start (docs/LIGA.md, Abschnitt 6) und sagt nichts darüber, ob die Season zur Anmeldung offen
// ist. Wie im Web (frontend/src/lib/seasonTabs.js, `seasonPhases` und `staffelStand`) zeigt die App darum den Stand der Season.
// Die Season-Angaben (`league_season`) schickt `GET /api/tournaments/{id}` nur mit dem Liga-Recht. Ohne sie steht bei einer Staffel
// im Entwurf ein neutrales „Vor dem Start“ - nie „Entwurf“.
import { asInstant, viennaDateTime } from "./vienna";

export type LeagueSeasonStand = {
  id?: string | null;
  status?: string | null;
  visibility?: string | null;
  application_opens_at?: string | null;
  application_closes_at?: string | null;
  /** Das wirksame Ende der Anmeldung (Nachmeldefrist #2422) - kann vor dem Fensterende liegen. */
  application_effective_closes_at?: string | null;
  start_date?: string | null;
};

export type StaffelLike = {
  status?: string | null;
  participant_count?: number | null;
  league_context?: { season_id?: string | null } | null;
  league_links?: unknown;
  league_season?: LeagueSeasonStand | null;
};

export type StaffelStandKey = "vorbereitung" | "anmeldung" | "einteilung" | "spielbetrieb" | "abschluss";
export type StaffelStand = { key: StaffelStandKey; label: string; hidden: boolean; live: boolean };

const STARTED = new Set(["live", "paused", "completed", "results_published"]);
const FINISHED = new Set(["completed", "results_published", "archived", "cancelled"]);
// „Abgesagt“ und „Archiviert“ sind eigene Entscheidungen der Leitung und bleiben als Status stehen.
const OWN_STAFFEL_STATUS = new Set(["cancelled", "archived"]);
const BEFORE_START = new Set(["draft", "scheduled", "registration_open", "registration_closed", "check_in"]);
const PUBLISHED_VISIBILITY = new Set(["members", "public"]);
const ORDER: StaffelStandKey[] = ["vorbereitung", "anmeldung", "einteilung", "spielbetrieb", "abschluss"];
const STAND_LABEL: Record<StaffelStandKey, string> = {
  vorbereitung: "Vorbereitung", anmeldung: "Anmeldung offen", einteilung: "Einteilung", spielbetrieb: "Spielbetrieb", abschluss: "Abgeschlossen",
};
const WITH_TIME: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };

/** Neutral für Staffeln ohne Season-Angaben (kein Liga-Recht oder älterer Server). */
export const STAFFEL_BEFORE_START = "Vor dem Start";

const at = (value?: string | null) => {
  if (!value) return null;
  const time = asInstant(value).getTime();
  return Number.isNaN(time) ? null : time;
};

/** Das wirksame Ende der Anmeldung: vom Server, sonst das Fensterende. `staffel_guard.attach_season_stand` schickt
 * `application_effective_closes_at` immer mit; der Rückfall auf das rohe Fensterende (ohne Nachmeldefrist, anders als
 * `effectiveCloses` im Web) greift nur bei einem älteren Server. */
function applicationEnd(season: LeagueSeasonStand) {
  return at(season.application_effective_closes_at) ?? at(season.application_closes_at);
}

/** Bewusst etwas weiter als im Web (`league_context`): auch `league_links` genügt - die App-Antwort kann je nach
 * Endpunkt nur eines von beiden tragen. */
export function isLeagueStaffel(tournament: StaffelLike | null | undefined): boolean {
  return Boolean(tournament?.league_context || tournament?.league_links);
}

/** Die aktuelle Phase der Season - dieselbe Regel wie `seasonPhases` im Web, nur mit dieser einen Staffel. */
function currentPhase(season: LeagueSeasonStand, staffelStatus: string, participants: number, now: Date): StaffelStandKey {
  const time = now.getTime();
  const opens = at(season.application_opens_at);
  const closes = season.application_closes_at ? applicationEnd(season) : null;
  const start = at(season.start_date);
  const started = STARTED.has(staffelStatus) || (season.status === "active" && start != null && time >= start);
  const finished = ["completed", "archived"].includes(String(season.status || "")) || (started && FINISHED.has(staffelStatus));
  const published = PUBLISHED_VISIBILITY.has(String(season.visibility || ""));
  const hasWindow = opens != null && closes != null;
  let current: number;
  if (finished) current = 4;
  else if (started) current = 3;
  else if (hasWindow) current = time < (opens as number) ? 0 : time < (closes as number) ? 1 : 2;
  else current = published || participants > 0 ? 2 : 0;
  return ORDER[current];
}

/**
 * Der Stand einer Staffel aus ihrer Season (`league_season` vom Server): `{key, label, hidden, live}` oder `null` - dann gilt der
 * Turnier-Status (gewöhnliches Turnier, abgesagt, archiviert, ohne Season-Angaben). Wörter wie im Web: „Anmeldung offen bis 20.11.,
 * 18:00“, „Einteilung · Start fehlt“, „Spielbetrieb · pausiert“, „… · Season verborgen“.
 */
export function staffelStand(staffel: StaffelLike | null | undefined, { now = new Date() }: { now?: Date } = {}): StaffelStand | null {
  const status = String(staffel?.status || "draft");
  const season = staffel?.league_season;
  if (!isLeagueStaffel(staffel) || !season || OWN_STAFFEL_STATUS.has(status)) return null;
  const step = currentPhase(season, status, Number(staffel?.participant_count) || 0, now);
  // Die Season läuft schon (eine andere Staffel hat begonnen), diese hier noch nicht: höchstens Einteilung, mit dem fehlenden Start.
  const waiting = BEFORE_START.has(status) && step === "spielbetrieb";
  const key: StaffelStandKey = waiting ? "einteilung" : step;
  let label = waiting ? `${STAND_LABEL.einteilung} · Start fehlt` : STAND_LABEL[key];
  // Offen, aber nicht veröffentlicht: Teams sehen die Ligaseite nicht und können sich nicht anmelden.
  const hidden = key === "anmeldung" && !PUBLISHED_VISIBILITY.has(String(season.visibility || ""));
  if (key === "anmeldung") {
    const end = applicationEnd(season);
    if (end != null) label = `${label} bis ${viennaDateTime(end, WITH_TIME)}`;
  }
  if (hidden) label = `${label} · Season verborgen`;
  if (key === "spielbetrieb" && status === "paused") label = `${label} · pausiert`;
  return { key, label, hidden, live: key === "spielbetrieb" && status === "live" };
}

// Die Tönung des Abzeichens über die Phasen-Tabelle (lib/phaseTone): Grau wartet oder ist vorbei, Grün offen, Cyan Einteilung,
// Rot nur, wenn gerade gespielt wird.
const STAND_TONE_STATE: Record<StaffelStandKey, string> = {
  vorbereitung: "draft", anmeldung: "registration_open", einteilung: "announced", spielbetrieb: "completed", abschluss: "completed",
};

/**
 * Was das Abzeichen im Kopf der Turnierseite zeigt: bei Liga-Staffeln den Liga-Stand (mit Liga-Recht) oder vor dem Start neutral
 * „Vor dem Start“; sonst `null` - dann bleibt die öffentliche Phase vom Server.
 */
export function staffelBadgePhase(staffel: StaffelLike | null | undefined, { now = new Date() }: { now?: Date } = {}): { state: string; label: string } | null {
  if (!isLeagueStaffel(staffel)) return null;
  const stand = staffelStand(staffel, { now });
  if (stand) {
    const state = stand.live ? "live" : stand.hidden ? "paused" : STAND_TONE_STATE[stand.key];
    return { state, label: stand.label };
  }
  if (String(staffel?.status || "draft") === "draft") return { state: "draft", label: STAFFEL_BEFORE_START };
  return null;
}
