export function displayName(user?: { display_name?: string | null; username?: string } | null) {
  return user?.display_name || user?.username || "Spieler";
}

export function formatDate(value?: string | null) {
  if (!value) return "Noch offen";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(value?: string | null) {
  if (!value) return "Noch offen";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatStatus(value?: string | null) {
  if (!value) return "Offen";
  const key = String(value).trim().toLowerCase();
  return STATUS_LABELS[key] || humanizeStatus(key);
}

export function formatEventMode(value?: string | null) {
  const key = String(value || "").trim().toLowerCase();
  return EVENT_MODE_LABELS[key] || "";
}

export function formatResultEntryMode(value?: string | null) {
  const key = String(value || "").trim().toLowerCase();
  return RESULT_ENTRY_MODE_LABELS[key] || "";
}

export function formatScheduleMode(value?: string | null) {
  const key = String(value || "").trim().toLowerCase();
  return SCHEDULE_MODE_LABELS[key] || "";
}

/**
 * Event-Typ als Begriff statt Rohwert. Ältere Einträge tragen Schreibweisen ohne
 * Unterstrich ("clubevening"); die werden auf den bekannten Schlüssel gelegt.
 * "general" ist der Standardtyp und sagt nichts - dafür kommt nichts zurück.
 */
export function formatEventType(value?: string | null) {
  const key = normalizeEventType(value);
  if (!key || key === "general") return "";
  return EVENT_TYPE_LABELS[key] || humanizeStatus(key);
}

export function normalizeEventType(value?: string | null) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  if (EVENT_TYPE_LABELS[key]) return key;
  const squeezed = key.replace(/[^a-z0-9]/g, "");
  return Object.keys(EVENT_TYPE_LABELS).find((known) => known.replace(/_/g, "") === squeezed) || key;
}

export function formatNewsCategory(value?: string | null) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  return NEWS_CATEGORY_LABELS[key] || humanizeStatus(key);
}

/** Ort und Stadt, ohne Wiederholung, wenn beide gleich sind ("Telfs · Telfs"). */
export function placeParts(...values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    parts.push(text);
  }
  return parts;
}

/** Zeit einer Chat-Nachricht: heute nur die Uhrzeit, gestern "Gestern", sonst Datum und Uhrzeit. */
export function formatChatTime(value?: string | null, now: Date = new Date()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = date.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const stamp = date.getTime();
  if (stamp >= dayStart && stamp < dayStart + DAY_MS) return time;
  if (stamp >= dayStart - DAY_MS && stamp < dayStart) return `Gestern, ${time}`;
  return `${formatDate(value)}, ${time}`;
}

type GroupableMessage = { user_id?: string | null; sender_id?: string | null; created_at?: string | null };

/** Folgt eine Nachricht kurz auf eine vom selben Absender, braucht sie keinen eigenen Kopf. */
export function continuesMessageGroup(previous: GroupableMessage | null | undefined, message: GroupableMessage, maxGapMs = 5 * 60 * 1000) {
  if (!previous) return false;
  const previousAuthor = previous.user_id || previous.sender_id;
  const author = message.user_id || message.sender_id;
  if (!previousAuthor || previousAuthor !== author) return false;
  const before = Date.parse(previous.created_at || "");
  const after = Date.parse(message.created_at || "");
  if (Number.isNaN(before) || Number.isNaN(after)) return false;
  return after >= before && after - before <= maxGapMs;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_LABELS: Record<string, string> = {
  accepted: "Angenommen",
  active: "Aktiv",
  announced: "Angekündigt",
  archived: "Archiviert",
  approved: "Bestätigt",
  auto_confirmed: "Automatisch bestätigt",
  awaiting_confirmation: "Wartet auf Bestätigung",
  awaiting_opponent: "Wartet auf Gegner",
  awaiting_result: "Wartet auf Ergebnis",
  broken: "Defekt",
  busy: "Belegt",
  cancelled: "Abgesagt",
  check_in: "Check-in offen",
  checkin_open: "Check-in offen",
  checked_in: "Eingecheckt",
  closed: "Geschlossen",
  community: "Community",
  completed: "Beendet",
  confirmed: "Bestätigt",
  conflict: "Klärung nötig",
  countered: "Gegenvorschlag",
  declined: "Abgelehnt",
  deleted: "Gelöscht",
  disputed: "Klärung nötig",
  draft: "Entwurf",
  escalated: "Turnierleitung nötig",
  finished: "Beendet",
  forfeit: "Wertung",
  free: "Frei",
  in_progress: "Läuft",
  inactive: "Inaktiv",
  internal: "Intern",
  live: "Live",
  locked: "Gesperrt",
  members: "Vereinsmitglieder",
  moderator: "Moderator",
  needs_review: "Prüfung nötig",
  no_show: "Nicht erschienen",
  offline: "Offline",
  online: "Online",
  organizer: "Turnierleitung",
  paused: "Pausiert",
  pending: "Ausstehend",
  player: "Spieler",
  player_confirmed: "Beide melden",
  player_reported: "Von Spieler gemeldet",
  proposed: "Vorschlag offen",
  public: "Öffentlich",
  ready: "Bereit",
  referee: "Schiedsrichter",
  registered: "Angemeldet",
  registration_closed: "Anmeldung geschlossen",
  registration_open: "Anmeldung offen",
  registration_pending: "Anmeldung geplant",
  rejected: "Abgelehnt",
  reported: "Gemeldet",
  reported_by_me: "Von dir gemeldet",
  reported_by_opponent: "Vom Gegner gemeldet",
  requires_admin: "Admin-Prüfung nötig",
  requires_staff: "Turnierleitung nötig",
  reserved: "Reserviert",
  result_conflict: "Ergebnis in Klärung",
  result_pending: "Ergebnis offen",
  result_reported: "Ergebnis gemeldet",
  results_published: "Ergebnisse veröffentlicht",
  scheduled: "Geplant",
  scorekeeper: "Ergebnis-Erfasser",
  staff_only: "Nur Turnierleitung",
  station_manager: "Station-Crew",
  stream_operator: "Stream-Team",
  superadmin: "Superadmin",
  tournament_admin: "Turnier-Admin",
  unpublished: "Unveröffentlicht",
  waitlist: "Warteliste",
  waiting_result: "Wartet auf Ergebnis",
};

const EVENT_MODE_LABELS: Record<string, string> = {
  hybrid: "Hybrid",
  local: "Vor Ort",
  online: "Online",
};

const RESULT_ENTRY_MODE_LABELS: Record<string, string> = {
  hybrid: "Ergebnisse: Hybrid",
  player_confirmed: "Ergebnisse: beide melden",
  staff_only: "Ergebnisse: Turnierleitung",
};

const SCHEDULE_MODE_LABELS: Record<string, string> = {
  fixed_by_staff: "Termin: festgelegt",
  hybrid: "Termin: Hybrid",
  player_proposal: "Termin: Vorschläge",
};

// Wie /api/events/meta im Backend - dieselben Begriffe wie auf der Webseite.
const EVENT_TYPE_LABELS: Record<string, string> = {
  general: "Allgemein",
  public_event: "Public Event",
  club_evening: "Vereinsabend",
  lan_party: "LAN-Party",
  online_event: "Online Event",
  expo: "Messe / Expo",
  community_evening: "Community-Abend",
  grill_evening: "Grillabend",
  mario_kart_event: "Mario Kart Event",
  f1_event: "F1 Event",
  internal: "Interner Termin",
  sponsor_action: "Sponsorenaktion",
  tournament_finals: "Turnier-Finals",
};

// Wie /api/news/meta im Backend.
const NEWS_CATEGORY_LABELS: Record<string, string> = {
  club: "Verein",
  tournaments: "Turniere",
  events: "Events",
  community: "Community",
  sponsors: "Sponsoren",
  members: "Mitglieder",
  teams: "Teams",
  announcement: "Ankündigung",
  recap: "Rückblick",
  video: "Video",
  maintenance: "Wartung",
};

function humanizeStatus(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

// Turnierformate wie in frontend/src/lib/tournamentLabels.js. Der Schlüssel
// wird ohne Unterstriche und Großbuchstaben verglichen, weil ältere Turniere
// "ffacustombracket" oder "singleelim" tragen und so roh auf der Karte
// standen (#246).
const TOURNAMENT_FORMAT_LABELS: Record<string, string> = {
  single_elim: "Single Elimination",
  single_elimination: "Single Elimination",
  double_elim: "Double Elimination",
  double_elimination: "Double Elimination",
  round_robin: "Jeder gegen jeden",
  round_robin_groups: "Jeder-gegen-jeden-Gruppen",
  swiss: "Schweizer System",
  groups: "Gruppenphase",
  ffa: "Mehrspieler frei",
  battle_royale: "Überlebensmodus",
  league: "Liga",
  ffa_league: "Mehrspieler-Liga",
  time_trial: "Zeitfahren",
  grand_prix: "Rennserie",
  custom_bracket: "Freier Turnierbaum",
  ffa_custom_bracket: "Mehrspieler freier Turnierbaum",
  ffa_single_elimination: "FFA Single Elimination",
  simple: "Einzelrunde",
};

const TOURNAMENT_FORMAT_BY_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(TOURNAMENT_FORMAT_LABELS).map(([key, label]) => [normalizeKey(key), label]),
);

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function formatTournamentFormat(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return TOURNAMENT_FORMAT_BY_KEY[normalizeKey(raw)] || humanizeStatus(raw);
}

// Nutzerarten aus dem Backend (models.UserType) und Rollen, wie sie in
// Spielerlisten stehen. "community_user" stand vorher roh unter dem Namen.
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  club_member: "Vereinsmitglied",
  community_user: "Community",
  guest: "Gast",
  member: "Vereinsmitglied",
  moderator: "Moderator",
  organizer: "Turnierleitung",
  player: "Spieler",
  staff: "Staff",
  superadmin: "Superadmin",
};

export function formatRole(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return ROLE_LABELS[raw.toLowerCase()] || formatStatus(raw);
}

// Mitgliedsarten und -status der Vereinsmitgliedschaft (membership_routes).
const MEMBERSHIP_TYPE_LABELS: Record<string, string> = {
  ordinary: "Ordentliches Mitglied",
  supporting: "Förderndes Mitglied",
  honorary: "Ehrenmitglied",
  youth: "Jugendmitglied",
  family: "Familienmitglied",
};

const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  active: "Aktiv",
  honorary: "Ehrenmitglied",
  pending: "Beantragt",
  paused: "Ruhend",
  inactive: "Inaktiv",
  ended: "Beendet",
};

export function formatMembershipType(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return MEMBERSHIP_TYPE_LABELS[raw.toLowerCase()] || humanizeStatus(raw);
}

export function formatMembershipStatus(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return MEMBERSHIP_STATUS_LABELS[raw.toLowerCase()] || formatStatus(raw);
}

