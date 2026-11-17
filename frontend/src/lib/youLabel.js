// Etikett an der eigenen Stelle (#1316): „Du“ - hängt die Markierung an deinem Team (Anmeldung eines Teams), heißt es
// „Dein Team“, wie die Marke der Rangliste (StandingsTable `mineLabel`).
export function youLabel(registration) {
  return registration?.team_id || registration?.team?.id ? "Dein Team" : "Du";
}
