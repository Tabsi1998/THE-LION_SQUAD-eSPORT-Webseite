// Staffel-Seite der Liga-Verwaltung (#2262, Entwurf Abschnitt 2): Reiter, Abschnitte, Adresse und die alten Reiter der
// Turnierverwaltung (`?tab=`). Muster wie lib/seasonTabs.js: Reiter und Abschnitte per Sprungmarke (`#teilnehmer`, `#zuteilen`).
// Jede Marke gehört zu genau einem Reiter - der Test prüft es.
//
// Die Seite entsteht in Paketen neben der alten Bedienung (Entscheidung Nr. 189): Alle sieben Reiter stehen hier, auf der Seite
// erscheinen aber nur die fertigen (`STAFFEL_TABS_READY`). Ein Ziel, das es noch nicht gibt, führt in die Turnierverwaltung.

export const STAFFEL_TABS = [
  { key: "ueberblick", label: "Überblick" },
  { key: "teilnehmer", label: "Teilnehmer" },
  { key: "spielplan", label: "Spielplan" },
  { key: "spiele", label: "Spiele und Ergebnisse" },
  { key: "tabelle", label: "Tabelle" },
  { key: "protokoll", label: "Protokoll" },
  { key: "einstellungen", label: "Einstellungen" },
];

// Was schon auf der Seite steht: Paket A Überblick und Teilnehmer, Paket B Spielplan, Spiele und Tabelle. Protokoll und Einstellungen
// kommen mit Paket C.
export const STAFFEL_TABS_READY = new Set(["ueberblick", "teilnehmer", "spielplan", "spiele", "tabelle"]);

// Abschnitte innerhalb der Reiter, per Sprungmarke erreichbar (Hinweise, Nachrichten des Servers, Handbuch).
export const STAFFEL_SECTIONS = {
  zuteilen: "teilnehmer",
  austritt: "teilnehmer",
  termine: "spielplan",
  ergebnisse: "spiele",
  gleichstand: "tabelle",
  darstellung: "einstellungen",
  helfer: "einstellungen",
};

// Die Reiter der Turnierverwaltung (`/admin/tournaments/<id>?tab=…`) und wohin sie auf der Staffel-Seite führen - für die
// Weiterleitung alter Adressen (Paket D). Unbekannt oder leer: Überblick.
export const LEGACY_TAB_ANCHORS = {
  participants: "teilnehmer",
  matchplan: "spielplan",
  stages: "spiele",
  bracket: "tabelle",
  edit: "einstellungen",
  maps: "einstellungen",
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

/** Die Marke auf der Staffel-Seite für einen alten Reiter der Turnierverwaltung (`?tab=matchplan` → `spielplan`). */
export function legacyTabAnchor(tab) {
  return LEGACY_TAB_ANCHORS[clean(tab)] || FIRST;
}

/**
 * Wohin ein Ziel zur Bedienung einer Staffel führt, solange die Seite in Paketen wächst: Steht der Reiter schon auf der
 * Staffel-Seite, dorthin - sonst noch in die Turnierverwaltung mit ihrem alten Reiter. ``legacyTab``: der Reiter der
 * Turnierverwaltung (leer = Überblick), ``anchor``: auf Wunsch ein genauerer Abschnitt der Staffel-Seite.
 */
export function staffelManageUrl(tournamentId, legacyTab = "", anchor = "") {
  const target = anchor || (legacyTab ? legacyTabAnchor(legacyTab) : FIRST);
  if (STAFFEL_TABS_READY.has(staffelTabOf(target))) return staffelAdminUrl(tournamentId, target);
  const old = `/admin/tournaments/${encodeURIComponent(tournamentId || "")}`;
  return legacyTab ? `${old}?tab=${encodeURIComponent(legacyTab)}` : old;
}
