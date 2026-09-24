// Sichtbarkeit der Profilfelder in Gruppen (#257). Vorher standen 20 einzelne
// Auswahlfelder untereinander; jetzt hat jede Gruppe eine Schnellwahl, die
// alle ihre Felder auf eine Stufe setzt. Reine Logik ohne React, damit sie
// sich ohne Oberfläche testen lässt.

export const DEFAULT_VISIBILITY = "public";

// Stufen als Begriff mit einem Satz - der Auswahltext allein sagte nicht, wer
// „Community“ ist.
export const VISIBILITY_LEVELS = [
  { k: "public", l: "Öffentlich", d: "Jeder, auch ohne Anmeldung." },
  { k: "community", l: "Community", d: "Nur eingeloggte Community-Spieler und Mitglieder." },
  { k: "members", l: "Verein", d: "Nur eingeloggte Vereinsmitglieder." },
  { k: "admins", l: "Nur Admins", d: "Nur das Admin-Team des Vereins." },
  { k: "private", l: "Privat", d: "Nur du selbst." },
];

// Die vier Stufen der Schnellwahl; „Nur Admins“ bleibt in den Einzelfeldern
// wählbar, ist als Gruppenwert aber ungewöhnlich.
export const QUICK_VISIBILITY = VISIBILITY_LEVELS.filter((level) => level.k !== "admins");

export const VISIBILITY_GROUPS = [
  {
    k: "contact",
    l: "Kontakt",
    fields: [
      { k: "email", l: "E-Mail" },
      { k: "discord", l: "Discord" },
      { k: "city", l: "Wohnort" },
      { k: "country", l: "Land" },
    ],
  },
  {
    k: "personal",
    l: "Persönliches",
    fields: [{ k: "birth_date", l: "Geburtsdatum" }],
  },
  {
    k: "gaming",
    l: "Gaming-IDs",
    fields: [
      { k: "steam", l: "Steam" },
      { k: "psn", l: "PSN" },
      { k: "xbox", l: "Xbox" },
      { k: "epic", l: "Epic" },
      { k: "nintendo", l: "Nintendo Friend Code" },
      { k: "ea", l: "EA ID" },
      { k: "riot", l: "Riot ID" },
      { k: "battlenet", l: "Battle.net" },
      { k: "faceit", l: "FACEIT" },
      { k: "startgg", l: "start.gg" },
      { k: "roblox", l: "Roblox" },
      { k: "osu", l: "osu!" },
      { k: "lichess", l: "Lichess" },
    ],
  },
  {
    k: "social",
    l: "Social",
    fields: [
      { k: "twitch", l: "Twitch" },
      { k: "youtube", l: "YouTube" },
      { k: "instagram", l: "Instagram" },
      { k: "x", l: "X / Twitter" },
      { k: "github", l: "GitHub" },
      { k: "kick", l: "Kick" },
      { k: "reddit", l: "Reddit" },
      { k: "spotify", l: "Spotify" },
    ],
  },
  {
    k: "other",
    l: "Sonstiges",
    fields: [
      { k: "main_platforms", l: "Plattformen" },
      { k: "input_devices", l: "Eingabegeräte" },
      { k: "favorite_games", l: "Lieblingsspiele" },
    ],
  },
];

export const VISIBILITY_FIELDS = VISIBILITY_GROUPS.flatMap((group) => group.fields);

export function visibilityLabel(level) {
  return VISIBILITY_LEVELS.find((item) => item.k === level)?.l || level;
}

export function fieldLevel(visibility, key) {
  return (visibility && visibility[key]) || DEFAULT_VISIBILITY;
}

// Eine Stufe, wenn alle Felder der Gruppe sie teilen, sonst "mixed".
export function groupLevel(visibility, group) {
  const levels = new Set(group.fields.map((field) => fieldLevel(visibility, field.k)));
  return levels.size === 1 ? [...levels][0] : "mixed";
}

// Setzt alle Felder einer Gruppe auf eine Stufe; andere Gruppen bleiben.
export function applyGroupLevel(visibility, group, level) {
  const next = { ...(visibility || {}) };
  for (const field of group.fields) next[field.k] = level;
  return next;
}
