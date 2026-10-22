// Logo je Spur und optional je Saison (#2014). Der Server liefert an der Saison schon das wirksame Logo (eigenes, sonst
// das der Spur) und an der Spur ihr eigenes; hier wird nur gewählt, was eine Stelle zeigt. Ohne Logo bleibt es beim
// bisherigen Rückfall (Spiel-Logo bzw. Partner-Abzeichen). Gezeigt wird es wie hochgeladen, nie eingefärbt (#1321).

/** Das Logo einer Saison bzw. Spur: zuerst das der Saison, sonst das der Spur; ohne beides "". */
export function seriesLogo(lineage, season) {
  return season?.logo_url || lineage?.logo_url || "";
}

/** Das Zeichen für eine Karte mit Spiel-Logo: das Logo der Serie geht vor, sonst bleibt das Spiel wie bisher. */
export function markWithLogo(game, logo) {
  if (!logo) return game;
  return { ...(game || {}), logo_url: logo };
}

/** Hinweis für das Saison-Logo in der Verwaltung: ohne eigenes gilt das der Spur. */
export function inheritedLogoHint(lineage) {
  return lineage?.logo_url
    ? "Ohne eigenes Logo zeigt die Saison das Logo der Spur."
    : "Ohne eigenes Logo zeigt die Saison das Spiel-Logo bzw. das Partner-Abzeichen.";
}
