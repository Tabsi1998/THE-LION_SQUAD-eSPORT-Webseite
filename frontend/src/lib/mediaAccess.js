// Wer welche Bilder nimmt (#2230, #2266): Admin-Medien gehen über die Rolle (services/permissions.py ADMIN_MEDIA_ROLES), Zuständigkeiten
// und Freigaben öffnen sie nicht. Wer sie nicht hat, nimmt wie jedes Konto die eigenen Bilder - sonst wäre Hochladen für Zuständige
// immer ein 403. SVG geht nur mit Medienrolle (über die Logo-Route).
export const ADMIN_MEDIA_ROLES = ["admin", "tournament_admin", "club_admin", "superadmin"];

export function hasMediaRole(user) {
  return ADMIN_MEDIA_ROLES.includes(user?.role);
}

/** Die Felder für `ImageUpload`: mit Medienrolle die Vorgaben der Verwaltung, sonst eigener Upload und eigene Bibliothek. */
export function mediaPropsFor(user) {
  return hasMediaRole(user) ? {} : { mediaScope: "user", libraryEndpoint: "/media?type=images" };
}
