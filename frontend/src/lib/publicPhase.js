// Die öffentliche Phase (#1881, #1888): der Server leitet sie aus Status und Zeiten ab (`public_phase`, services/
// public_phase.py). Öffentliche Anzeigen fragen sie statt des Rohstatus - ein stehen gebliebenes „live“ nach dem Ende ist
// dort schon „completed“. Ohne Phase (ältere Antworten) gilt der Rohstatus. Den Rohstatus selbst braucht nur die Verwaltung.

/** Der öffentliche Stand eines Turniers, Events oder einer Fast Lap - klein geschrieben, „“ ohne Angabe. */
export function publicState(item) {
  const phase = item?.public_phase;
  const state = typeof phase === "string" ? phase : phase?.state;
  return String(state || item?.event_phase?.state || item?.status || "").toLowerCase();
}

/** Läuft es öffentlich gerade? Nach dem Ende nicht mehr, auch wenn der Rohstatus noch auf „live“ steht. */
export function isPublicLive(item) {
  return publicState(item) === "live";
}
