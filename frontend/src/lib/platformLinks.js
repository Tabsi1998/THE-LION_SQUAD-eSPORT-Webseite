// Plattform-Konten verknüpfen (#260): welches Profilfeld zu welcher Plattform gehört, und was
// ein Fehlercode aus dem Rückruf (?link_error=) in Worten heißt.

export const PLATFORM_BY_FIELD = { discord_name: "discord", twitch_handle: "twitch", steam_id: "steam" };

export const PLATFORM_LABELS = { discord: "Discord", twitch: "Twitch", steam: "Steam" };

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
