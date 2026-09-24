// Plattform-Konten verknüpfen (#260): welches Profilfeld zu welcher Plattform gehört, und was
// ein Fehlercode aus dem Rückruf (?link_error=) in Worten heißt.

export const PLATFORM_BY_FIELD = {
  discord_name: "discord", twitch_handle: "twitch", steam_id: "steam", battlenet_id: "battlenet", x_handle: "x",
  youtube_handle: "youtube", tiktok_handle: "tiktok", riot_id: "riot", xbox_id: "xbox", epic_id: "epic",
};

export const PLATFORM_LABELS = { discord: "Discord", twitch: "Twitch", steam: "Steam", battlenet: "Battle.net", x: "X", youtube: "YouTube", tiktok: "TikTok", riot: "Riot Games", xbox: "Xbox", epic: "Epic Games" };

// Was sich nicht verknüpfen lässt - und warum (steht als Hinweis am Feld).
export const NOT_LINKABLE = {
  psn_id: "PlayStation bietet keine Anmeldung für Websites – bleibt getippt.",
  nintendo_fc: "Nintendo bietet keine Anmeldung für Websites – bleibt getippt.",
  ea_id: "EA bietet keine Anmeldung für Websites – bleibt getippt.",
  instagram_handle: "Instagram verknüpft nur Business-Konten über eine geprüfte Meta-App – noch nicht angebunden.",
};

// Die Apps der Website je Plattform (Admin → Login & Konten): welche Felder, wo die Anleitung steht.
export const PLATFORM_APPS = [
  { key: "discord", label: "Discord", idField: "discord_client_id", secretField: "discord_client_secret", idPlaceholder: "Application ID aus dem Developer Portal", guideKey: "discord_app" },
  { key: "twitch", label: "Twitch", idField: "twitch_client_id", secretField: "twitch_client_secret", tab: "/admin/integrations/twitch", tabLabel: "Twitch", guideKey: "twitch" },
  { key: "steam", label: "Steam", secretField: "steam_api_key", secretLabel: "Steam Web-API-Schlüssel (optional)", secretPlaceholder: "nur für den Anzeigenamen; ohne bleibt die SteamID", guideKey: "steam", optional: true },
  { key: "battlenet", label: "Battle.net", idField: "battlenet_client_id", secretField: "battlenet_client_secret", guideKey: "battlenet", optional: true },
  { key: "x", label: "X", idField: "x_client_id", secretField: "x_client_secret", idLabel: "X Client ID (OAuth 2.0)", guideKey: "x", optional: true },
  { key: "youtube", label: "YouTube (Google)", idField: "youtube_client_id", secretField: "youtube_client_secret", idLabel: "Google Client ID", secretLabel: "Google Client Secret", guideKey: "youtube", optional: true },
  { key: "tiktok", label: "TikTok", idField: "tiktok_client_key", secretField: "tiktok_client_secret", idLabel: "TikTok Client Key", guideKey: "tiktok", optional: true, note: "TikTok schaltet die Anmeldung erst nach Prüfung der App frei." },
  { key: "riot", label: "Riot Games", idField: "riot_client_id", secretField: "riot_client_secret", guideKey: "riot", optional: true, note: "Riot Sign On gibt es nur nach Antrag bei Riot." },
  { key: "xbox", label: "Xbox (Microsoft)", idField: "xbox_client_id", secretField: "xbox_client_secret", idLabel: "Anwendungs-ID (Client-ID)", secretLabel: "Geheimer Clientschlüssel", guideKey: "xbox", optional: true },
  { key: "epic", label: "Epic Games", idField: "epic_client_id", secretField: "epic_client_secret", guideKey: "epic", optional: true, note: "Braucht die Markenprüfung von Epic für die Anwendung." },
];
export const PLATFORM_APP_FIELDS = PLATFORM_APPS.flatMap((app) => [app.idField, app.secretField].filter(Boolean));
export const PLATFORM_SECRET_FIELDS = PLATFORM_APPS.map((app) => app.secretField).filter(Boolean);

const ERROR_TEXTS = {
  denied: "Die Anmeldung bei der Plattform wurde abgebrochen – es wurde nichts verknüpft.",
  taken: "Dieses Konto ist schon mit einem anderen Profil verknüpft. Melde dich dort ab oder trenne es zuerst.",
  exchange_failed: "Die Plattform hat die Anmeldung nicht bestätigt. Bitte noch einmal versuchen.",
  platform_error: "Die Plattform hat die Anmeldung abgelehnt – meist fehlt die Rückrufadresse in der Entwickler-Konsole (Einstellungen → Login & Konten).",
  invalid: "Der Rückruf passte nicht zu deiner Sitzung (zu alt oder verfälscht). Bitte noch einmal starten.",
  not_configured: "Diese Plattform ist auf der Website noch nicht eingerichtet.",
  unknown: "Diese Plattform gibt es nicht.",
};

export function linkErrorText(code, detail = "") {
  const text = ERROR_TEXTS[code] || "Die Verknüpfung hat nicht geklappt. Bitte noch einmal versuchen.";
  return detail ? `${text} (${detail})` : text;
}

export function formatLinkedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

export function linkedText(platform) {
  return `${PLATFORM_LABELS[platform] || platform} ist verknüpft – dein Eintrag ist jetzt verifiziert.`;
}

/** Die Verknüpfung zu einem Profilfeld – oder null. */
export function linkForField(links, field) {
  const platform = PLATFORM_BY_FIELD[field];
  if (!platform) return null;
  return (links || []).find((link) => link.platform === platform) || null;
}
