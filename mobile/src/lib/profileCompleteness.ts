// Profilstatus (#592): die offenen Angaben in Klartext - nie als Feldschlüssel wie „avatar_url“.
// Dieselben Texte wie auf der Website; unbekannte Schlüssel werden nicht angezeigt.

export const PROFILE_FIELD_LABELS: Record<string, string> = {
  avatar_url: "Profilbild",
  banner_url: "Banner",
  bio: "Über mich",
  country: "Land",
  city: "Ort",
  birth_date: "Geburtsdatum",
  main_platforms: "Plattformen",
  input_devices: "Eingabegeräte",
  favorite_games: "Lieblingsspiele",
  discord_name: "Discord",
  twitch_handle: "Twitch",
  privacy_public_profile: "Sichtbarkeit des Profils",
};

/** Die Beschriftungen der offenen Felder, in der Reihenfolge des Servers, höchstens `limit`. */
export function missingLabels(keys: readonly string[] | null | undefined, limit = 8): string[] {
  return (keys || [])
    .map((key) => PROFILE_FIELD_LABELS[key])
    .filter((label): label is string => Boolean(label))
    .slice(0, limit);
}
