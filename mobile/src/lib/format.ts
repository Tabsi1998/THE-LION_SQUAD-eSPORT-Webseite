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
  if (!value) return "offen";
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

const STATUS_LABELS: Record<string, string> = {
  accepted: "Angenommen",
  active: "Aktiv",
  announced: "Angekuendigt",
  archived: "Archiviert",
  approved: "Bestaetigt",
  broken: "Defekt",
  busy: "Belegt",
  cancelled: "Abgesagt",
  check_in: "Check-in offen",
  checkin_open: "Check-in offen",
  checked_in: "Eingecheckt",
  closed: "Geschlossen",
  community: "Community",
  completed: "Beendet",
  confirmed: "Bestaetigt",
  countered: "Gegenvorschlag",
  declined: "Abgelehnt",
  draft: "Entwurf",
  escalated: "Turnierleitung noetig",
  finished: "Beendet",
  forfeit: "Wertung",
  free: "Frei",
  in_progress: "Laeuft",
  inactive: "Inaktiv",
  internal: "Intern",
  live: "Live",
  members: "Vereinsmitglieder",
  moderator: "Moderator",
  no_show: "Nicht erschienen",
  offline: "Offline",
  online: "Online",
  organizer: "Turnierleitung",
  paused: "Pausiert",
  pending: "Ausstehend",
  player: "Spieler",
  proposed: "Vorschlag offen",
  public: "Oeffentlich",
  ready: "Bereit",
  referee: "Schiedsrichter",
  registered: "Angemeldet",
  registration_closed: "Anmeldung geschlossen",
  registration_open: "Anmeldung offen",
  registration_pending: "Anmeldung geplant",
  rejected: "Abgelehnt",
  reported: "Gemeldet",
  reserved: "Reserviert",
  results_published: "Ergebnisse veroeffentlicht",
  scheduled: "Geplant",
  scorekeeper: "Ergebnis-Erfasser",
  station_manager: "Station-Crew",
  stream_operator: "Stream-Team",
  superadmin: "Superadmin",
  tournament_admin: "Turnier-Admin",
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
  player_proposal: "Termin: Vorschlaege",
};

function humanizeStatus(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

