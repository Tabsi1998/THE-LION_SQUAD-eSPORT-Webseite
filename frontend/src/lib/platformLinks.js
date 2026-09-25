// Plattform-Konten verknüpfen (#260): welches Profilfeld zu welcher Plattform gehört, und was
// ein Fehlercode aus dem Rückruf (?link_error=) in Worten heißt.

export const PLATFORM_BY_FIELD = {
  discord_name: "discord", twitch_handle: "twitch", steam_id: "steam", battlenet_id: "battlenet", x_handle: "x",
  youtube_handle: "youtube", tiktok_handle: "tiktok", riot_id: "riot", xbox_id: "xbox", epic_id: "epic",
  faceit_handle: "faceit", startgg_handle: "startgg", roblox_handle: "roblox", osu_handle: "osu", lichess_handle: "lichess", github_handle: "github", kick_handle: "kick", reddit_handle: "reddit", spotify_handle: "spotify",
  threads_handle: "threads", facebook_handle: "facebook", linkedin_handle: "linkedin", snapchat_handle: "snapchat", pinterest_handle: "pinterest", telegram_handle: "telegram", wargaming_handle: "wargaming", bungie_handle: "bungie",
};

export const PLATFORM_LABELS = { discord: "Discord", twitch: "Twitch", steam: "Steam", battlenet: "Battle.net", x: "X", youtube: "YouTube", tiktok: "TikTok", riot: "Riot Games", xbox: "Xbox", epic: "Epic Games", faceit: "FACEIT", startgg: "start.gg", roblox: "Roblox", osu: "osu!", lichess: "Lichess", github: "GitHub", kick: "Kick", reddit: "Reddit", spotify: "Spotify", threads: "Threads", facebook: "Facebook", linkedin: "LinkedIn", snapchat: "Snapchat", pinterest: "Pinterest", telegram: "Telegram", wargaming: "Wargaming.net", bungie: "Bungie.net" };

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
  // Konten verknüpfen III, Welle 1 (#547).
  { key: "faceit", label: "FACEIT", idField: "faceit_client_id", secretField: "faceit_client_secret", guideKey: "faceit", optional: true },
  { key: "startgg", label: "start.gg", idField: "startgg_client_id", secretField: "startgg_client_secret", guideKey: "startgg", optional: true },
  { key: "roblox", label: "Roblox", idField: "roblox_client_id", secretField: "roblox_client_secret", guideKey: "roblox", optional: true, note: "Bis zur Prüfung durch Roblox dürfen nur eingetragene Tester verknüpfen." },
  { key: "osu", label: "osu!", idField: "osu_client_id", secretField: "osu_client_secret", guideKey: "osu", optional: true },
  { key: "lichess", label: "Lichess", guideKey: "lichess", optional: true, note: "Lichess braucht keine App – die Verknüpfung läuft als öffentlicher Client." },
  { key: "github", label: "GitHub", idField: "github_client_id", secretField: "github_client_secret", guideKey: "github", optional: true },
  { key: "kick", label: "Kick", idField: "kick_client_id", secretField: "kick_client_secret", guideKey: "kick", optional: true },
  { key: "reddit", label: "Reddit", idField: "reddit_client_id", secretField: "reddit_client_secret", guideKey: "reddit", optional: true },
  { key: "spotify", label: "Spotify", idField: "spotify_client_id", secretField: "spotify_client_secret", guideKey: "spotify", optional: true, note: "Im Development Mode dürfen nur eingetragene Nutzer verknüpfen." },
  // Welle 2 (#547): Meta, LinkedIn, Snap und Pinterest verlangen ein App-Review, bevor fremde Konten sich anmelden dürfen.
  { key: "threads", label: "Threads", idField: "threads_client_id", secretField: "threads_client_secret", idLabel: "Threads App ID", secretLabel: "Threads App Secret", guideKey: "threads", optional: true, note: "Ohne App-Review von Meta dürfen nur eingetragene Tester verknüpfen." },
  { key: "facebook", label: "Facebook", idField: "facebook_client_id", secretField: "facebook_client_secret", idLabel: "Facebook App-ID", secretLabel: "Facebook App-Geheimcode", guideKey: "facebook", optional: true, note: "Ohne App-Review von Meta dürfen nur eingetragene Tester verknüpfen." },
  { key: "linkedin", label: "LinkedIn", idField: "linkedin_client_id", secretField: "linkedin_client_secret", guideKey: "linkedin", optional: true },
  { key: "snapchat", label: "Snapchat", idField: "snapchat_client_id", secretField: "snapchat_client_secret", idLabel: "OAuth2 Client ID", guideKey: "snapchat", optional: true, note: "Ohne Review von Snap dürfen nur eingetragene Tester verknüpfen." },
  { key: "pinterest", label: "Pinterest", idField: "pinterest_client_id", secretField: "pinterest_client_secret", idLabel: "Pinterest App ID", guideKey: "pinterest", optional: true },
  { key: "telegram", label: "Telegram", idField: "telegram_client_id", secretField: "telegram_client_secret", idLabel: "Client ID (BotFather)", secretLabel: "Client Secret (BotFather)", guideKey: "telegram", optional: true },
  { key: "wargaming", label: "Wargaming.net", idField: "wargaming_application_id", idLabel: "Application ID", idPlaceholder: "aus dem Developer Room", guideKey: "wargaming", optional: true, note: "Wargaming braucht kein Secret – nur die Application ID." },
  { key: "bungie", label: "Bungie.net", idField: "bungie_client_id", secretField: "bungie_client_secret", extraField: "bungie_api_key", extraLabel: "API Key", guideKey: "bungie", optional: true, note: "Zusätzlich zur OAuth-Client-ID braucht Bungie den API Key der Anwendung." },
];
export const PLATFORM_APP_FIELDS = PLATFORM_APPS.flatMap((app) => [app.idField, app.secretField, app.extraField].filter(Boolean));
export const PLATFORM_SECRET_FIELDS = PLATFORM_APPS.flatMap((app) => [app.secretField, app.extraField].filter(Boolean));

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
