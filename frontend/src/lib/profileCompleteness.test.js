import { missingLabels } from "./profileCompleteness";

// Profilstatus (#592): Klartext statt Feldschlüssel; Unbekanntes fällt weg, die Reihenfolge bleibt.

test("offene Felder stehen in Klartext, unbekannte Schlüssel verschwinden", () => {
  expect(missingLabels(["avatar_url", "geheimes_feld", "birth_date", "twitch_handle"])).toEqual(["Profilbild", "Geburtsdatum", "Twitch"]);
  expect(missingLabels(undefined)).toEqual([]);
  expect(missingLabels(["main_platforms", "input_devices", "favorite_games", "discord_name"], 2)).toEqual(["Plattformen", "Eingabegeräte"]);
});
