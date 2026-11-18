// Staffel-Seite der Liga-Verwaltung (#2262, Entwurf Abschnitt 2): Reiter, Abschnitte, Adresse und die alten Reiter der
// Turnierverwaltung (`?tab=`). Muster wie lib/seasonTabs.js: Reiter und Abschnitte per Sprungmarke (`#teilnehmer`, `#zuteilen`).
// Jede Marke gehört zu genau einem Reiter - der Test prüft es.
//
// Die Seite entstand in Paketen neben der alten Bedienung (Entscheidung Nr. 189); seit Paket C stehen alle sieben Reiter auf ihr.

export const STAFFEL_TABS = [
  { key: "ueberblick", label: "Überblick" },
  { key: "teilnehmer", label: "Teilnehmer" },
  { key: "spielplan", label: "Spielplan" },
  { key: "spiele", label: "Spiele und Ergebnisse" },
  { key: "tabelle", label: "Tabelle" },
  { key: "protokoll", label: "Protokoll" },
  { key: "einstellungen", label: "Einstellungen" },
];

// Was auf der Seite steht: seit Paket C alle sieben Reiter (Paket A Überblick und Teilnehmer, B Spielplan, Spiele und Tabelle,
// C Protokoll und Einstellungen).
export const STAFFEL_TABS_READY = new Set(STAFFEL_TABS.map((tab) => tab.key));

// Abschnitte innerhalb der Reiter, per Sprungmarke erreichbar (Hinweise, Nachrichten des Servers, Handbuch).
export const STAFFEL_SECTIONS = {
  zuteilen: "teilnehmer",
  austritt: "teilnehmer",
  termine: "spielplan",
  ergebnisse: "spiele",
  gleichstand: "tabelle",
  darstellung: "einstellungen",
  vorgaben: "einstellungen",
  links: "einstellungen",
  helfer: "einstellungen",
  werkzeuge: "einstellungen",
};

// Unterreiter der Einstellungen (Fix-Runde Paket C, #2249/#2267: Reiter statt langer Seiten). Jeder ist zugleich eine Sprungmarke
// (`#vorgaben` öffnet „Aus der Season“), `manage`: nur mit „Liga verwalten“ zu sehen, sonst öffnet die Marke den ersten.
export const STAFFEL_SETTINGS_TABS = [
  { key: "darstellung", label: "Auftritt" },
  { key: "vorgaben", label: "Aus der Season" },
  { key: "links", label: "Links und Sponsor", manage: true },
  { key: "helfer", label: "TV und Helfer" },
  { key: "werkzeuge", label: "Werkzeuge" },
];

/** Der Unterreiter der Einstellungen zu einer Marke - leer oder unbekannt: der erste. */
export function staffelSettingsTab(section) {
  const key = String(section || "").replace(/^#/, "").trim().toLowerCase();
  return STAFFEL_SETTINGS_TABS.some((tab) => tab.key === key) ? key : STAFFEL_SETTINGS_TABS[0].key;
}

// Die Reiter der Turnierverwaltung (`/admin/tournaments/<id>?tab=…`) und wohin sie auf der Staffel-Seite führen - für die
// Weiterleitung alter Adressen (Paket D). Unbekannt oder leer: Überblick.
export const LEGACY_TAB_ANCHORS = {
  participants: "teilnehmer",
  matchplan: "spielplan",
  stages: "spiele",
  bracket: "tabelle",
  edit: "einstellungen",
  maps: "vorgaben",
  staff: "helfer",
  feedback: "ueberblick",
};

const FIRST = STAFFEL_TABS[0].key;
const clean = (value) => String(value || "").replace(/^#/, "").trim().toLowerCase();

/** Reiter und Abschnitt aus der Sprungmarke: `#teilnehmer` → Reiter, `#zuteilen` → Reiter „Teilnehmer“ samt Abschnitt. */
export function staffelTarget(hash) {
  const key = clean(hash);
  if (STAFFEL_TABS.some((tab) => tab.key === key)) return { tab: key, section: "" };
  if (STAFFEL_SECTIONS[key]) return { tab: STAFFEL_SECTIONS[key], section: key };
  return { tab: FIRST, section: "" };
}

/** Der Reiter, in dem eine Marke liegt (Reiter oder Abschnitt) - `""` für eine unbekannte Marke. */
export function staffelTabOf(anchor) {
  const key = clean(anchor);
  if (STAFFEL_TABS.some((tab) => tab.key === key)) return key;
  return STAFFEL_SECTIONS[key] || "";
}

/** Adresse der Staffel-Seite (`/admin/leagues/staffeln/<id>`), auf Wunsch mit Reiter oder Abschnitt. Gleiche Form wie die API
 * und wie `staffel_guard.staffel_admin_path` im Server. */
export function staffelAdminUrl(tournamentId, anchor = "") {
  const base = `/admin/leagues/staffeln/${encodeURIComponent(tournamentId || "")}`;
  const key = clean(anchor);
  return key && key !== FIRST ? `${base}#${key}` : base;
}

/** Sprungmarke einer Liga auf der Liga-Übersicht (`/admin/leagues#liga-<id>`) - für die Brotkrumen der Staffel-Seite (Paket D). */
export const leagueAnchorId = (leagueId) => `liga-${leagueId || ""}`;

/** Weg zu einer Liga in der Verwaltung: die Liga-Übersicht an der Stelle dieser Liga; ohne Kennung die Übersicht. */
export function leagueAdminUrl(leagueId) {
  return leagueId ? `/admin/leagues#${encodeURIComponent(leagueAnchorId(leagueId))}` : "/admin/leagues";
}

/** Die Marke auf der Staffel-Seite für einen alten Reiter der Turnierverwaltung (`?tab=matchplan` → `spielplan`). */
export function legacyTabAnchor(tab) {
  return LEGACY_TAB_ANCHORS[clean(tab)] || FIRST;
}

/**
 * Wohin ein Ziel zur Bedienung einer Staffel führt: an seinen Reiter bzw. Abschnitt auf der Staffel-Seite. ``legacyTab``: der alte
 * Reiter der Turnierverwaltung (leer = Überblick), ``anchor``: auf Wunsch ein genauerer Abschnitt. Seit Paket D (#2262) führt nichts
 * mehr in die Turnierverwaltung - eine unbekannte Marke öffnet den Überblick.
 */
export function staffelManageUrl(tournamentId, legacyTab = "", anchor = "") {
  const target = anchor || (legacyTab ? legacyTabAnchor(legacyTab) : FIRST);
  return staffelAdminUrl(tournamentId, staffelTabOf(target) ? target : FIRST);
}

/** Für „Was fehlt“ (`staffelNeeds`): Zuteilen führt zum Abschnitt „Co-Team zuteilen“, alles andere an seinen Reiter. */
export const staffelNeedsUrl = (tournamentId) => (tab) => staffelManageUrl(tournamentId, tab, tab === "participants" ? "zuteilen" : "");
