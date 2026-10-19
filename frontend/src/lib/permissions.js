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

// Zwei-Faktor (#291, #1028): jeder Bereich außer Moderation gilt erst mit bestätigter Zwei-Faktor-Anmeldung -
// wie `MFA_AREAS` und `needs_mfa` im Server. Helfer-Einsätze je Turnier brauchen sie nicht.
export const MFA_AREAS = new Set(ADMIN_AREAS);

export function needsSecondFactor(user) {
  return !(user?.mfa_enabled && user?.auth_mfa_verified);
}

/** Darf die Person einen der Bereiche jetzt benutzen? Derselbe Vertrag wie `area_refusal`/`require_area` im Server
 * (#1479): einer der Bereiche vorhanden, und sobald die Liste einen Bereich mit Zwei-Faktor enthält, ist sie bestätigt -
 * auch wenn die Person aus der Liste nur Moderation hat. */
export function canUseArea(user, ...areas) {
  const wanted = areas.flat();
  if (!user || !hasArea(user, ...wanted)) return false;
  return !(wanted.some((area) => MFA_AREAS.has(area)) && needsSecondFactor(user));
}

/** Turnierleitung über alle Turniere (Rolle oder Freigabe), aber noch ohne bestätigte Zwei-Faktor-Anmeldung. */
export function leadWithoutSecondFactor(user) {
  return hasArea(user, "tournaments") && needsSecondFactor(user);
}

/** Irgendein Adminbereich, aber noch ohne bestätigte Zwei-Faktor-Anmeldung: statt der Verwaltung „2FA einrichten“. */
export function adminWithoutSecondFactor(user) {
  return isAnyAdmin(user) && needsSecondFactor(user);
}

/** Ein Helfer-Einsatz in einem Turnier oder einer Fast Lap (#1352) - gilt ohne Zwei-Faktor, wie im Server. */
export function hasHelperAssignment(user) {
  return Boolean(user?.has_staff_assignment);
}

/** Captain einer externen Serie (#1749) - der Server setzt `has_series_captain`, solange ein Recht heute gilt. Öffnet
 * „Mein Dienst“ mit „Meine Serien“ und die Seite der Saison; die Seiten selbst verlangen Zwei-Faktor, die Routen prüfen
 * jede Serie einzeln. */
export function hasSeriesCaptain(user) {
  return Boolean(user?.has_series_captain);
}

/** Wohin /admin führt (#1352, #1353):
 * - „dashboard“: ein Verwaltungsbereich mit bestätigter Zwei-Faktor-Anmeldung (auch Finanzen, #992) - wie
 *   `require_dashboard` im Server;
 * - „duty“: „Mein Dienst“ für Helfer mit Einsatz und Captains externer Serien (#1749) - auch ein Admin, der die
 *   Zwei-Faktor-Anmeldung noch nicht hat;
 * - „mfa“: Verwaltungsbereich ohne Zwei-Faktor und ohne Einsatz - erst einrichten;
 * - „moderation“: nur Moderation - direkt zu den Meldungen;
 * - „none“: kein Dienst - „Kein Zugriff“ mit dem freundlichen Satz statt der Bereichsliste;
 * - „login“: nicht angemeldet. */
export function adminHome(user) {
  if (!user) return "login";
  if (canUseArea(user, ...ADMIN_AREAS)) return "dashboard";
  if (hasHelperAssignment(user) || hasSeriesCaptain(user)) return "duty";
  if (isAnyAdmin(user)) return "mfa";
  if (canUseArea(user, "moderation")) return "moderation";
  return "none";
}

/** „Mein Dienst“ statt „Admin“ im Benutzermenü (#1352): kein nutzbarer Verwaltungsbereich, aber Moderation oder ein
 * Helfer-Einsatz. Beide Einträge führen nach /admin. */
export function showsDutyEntry(user) {
  return ["duty", "moderation"].includes(adminHome(user));
}

/** Zwei-Faktor wohnt unter Profil → Sicherheit (#258); `mfa=required` erklärt dort, warum (#348). */
export function mfaSetupPath(next = "") {
  const params = new URLSearchParams({ tab: "security", mfa: "required" });
  if (next) params.set("next", next);
  return `/profile?${params.toString()}`;
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
