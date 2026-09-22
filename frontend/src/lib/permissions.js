// Rechte nach Bereichen (#287): Spiegel von backend/services/permissions.py.
// Der Server schickt die Bereiche mit (`user.areas`); fehlt das Feld (älterer
// Server, Tests), leiten wir sie aus der Rolle ab.

export const AREAS = ["tournaments", "content", "club", "finance", "system", "moderation"];
export const ADMIN_AREAS = ["tournaments", "content", "club", "finance", "system"];
export const GRANTABLE_AREAS = ["tournaments", "content", "club", "finance"];

export const AREA_LABELS = {
  tournaments: "Turnierleitung",
  content: "Redaktion",
  club: "Vereinsverwaltung",
  finance: "Finanzen",
  system: "System",
  moderation: "Moderation",
};

export const AREA_HINTS = {
  tournaments: "Turniere, Events, Stationen, Fast Lap, Saisons, Gewinne",
  content: "News, Galerie, Medien, Sponsoren, Partner, Referenzen, CMS, Sticker, Achievements",
  club: "Mitglieder, Anträge, Dokumente, Vorteile, Vorstand, Kontakt-Inbox, Benutzer",
  finance: "Kosten an Events und Turnieren, Rechnungsaufträge, Freigaben",
  system: "Einstellungen, Game-Server, Betrieb, Logs, Audit, App-Versionen",
  moderation: "Meldungen und Chats",
};

export const ROLE_AREAS = {
  superadmin: AREAS,
  club_admin: AREAS,
  tournament_admin: ["tournaments", "moderation"],
  moderator: ["moderation"],
  player: [],
};

export const ROLE_LABELS = {
  player: "Spieler",
  moderator: "Moderator",
  tournament_admin: "Turnierleitung",
  club_admin: "Club-Admin",
  superadmin: "Superadmin",
};

/** Die Bereiche einer Person – vom Server, sonst aus der Rolle. */
export function areasOf(user) {
  if (!user) return [];
  if (Array.isArray(user.areas)) return user.areas.filter((area) => AREAS.includes(area));
  const fromRole = ROLE_AREAS[user.role] || [];
  const granted = Array.isArray(user.granted_areas) ? user.granted_areas : [];
  return AREAS.filter((area) => fromRole.includes(area) || granted.includes(area));
}

export function hasArea(user, ...areas) {
  const held = areasOf(user);
  return areas.flat().some((area) => held.includes(area));
}

export function isAnyAdmin(user) {
  return hasArea(user, ...ADMIN_AREAS);
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "";
}

export function areaLabel(area) {
  return AREA_LABELS[area] || area;
}

/** „Turnierleitung“ oder „Redaktion“ – für Hinweise, wenn ein Bereich fehlt. */
export function areaList(areas) {
  return areas.flat().map((area) => `„${areaLabel(area)}“`).join(" oder ");
}
