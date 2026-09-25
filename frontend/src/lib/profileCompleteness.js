// Profilstatus (#592): die offenen Angaben in Klartext - nie als Feldschlüssel wie „avatar_url“.
// Dieselben Texte wie in der App; unbekannte Schlüssel werden nicht angezeigt.

export const PROFILE_FIELD_LABELS = {
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
export function missingLabels(keys, limit = 8) {
  return (Array.isArray(keys) ? keys : [])
    .map((key) => PROFILE_FIELD_LABELS[key])
    .filter(Boolean)
    .slice(0, limit);
}
