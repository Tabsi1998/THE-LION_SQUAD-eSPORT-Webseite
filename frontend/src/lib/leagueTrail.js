// Liga-Weg einer Staffel (#2110, L-C2): Staffel- und Spielseite führen über „Liga · Season · Staffel“ zur Ligaseite
// statt über „Turniere“ - dort sind Staffeln ausgefiltert. Die Namen und Adressen kommen aus GET /api/leagues; der
// Server liefert nur Seasons, die die Person sehen darf. Ohne sichtbare Season bleibt es bei „Liga · Staffel A“.

/** Liga, Season und Staffel zu einem Turnier mit ``league_context`` - oder null. */
export function leagueTrail(leagues, tournament) {
  const context = tournament?.league_context;
  if (!context) return null;
  const league = (leagues || []).find((row) => row?.id === context.league_id);
  const season = (league?.seasons || []).find((row) => row?.id === context.season_id);
  if (!league?.slug || !season?.slug) return null;
  const seasonHref = `/liga/${league.slug}/${season.slug}`;
  return {
    leagueName: league.name || "Liga",
    seasonName: season.name || "Season",
    seasonHref,
    staffelHref: `${seasonHref}#staffel-${tournament.slug || tournament.id}`,
  };
}

export function staffelLabel(tournament) {
  const staffel = String(tournament?.league_context?.staffel || "").trim();
  return staffel ? `Staffel ${staffel}` : "Staffel";
}

/**
 * Brotkrumen für eine Staffel (``current`` leer) oder eine Seite darunter (``current`` = letzter Eintrag, etwa das
 * Spiel). ``tournamentUrl``: die Staffel als Turnier. Kein Liga-Turnier: null - die Seite nimmt ihre Brotkrumen.
 */
export function leagueCrumbs(tournament, trail, { tournamentUrl = "", current = null } = {}) {
  if (!tournament?.league_context) return null;
  const staffel = { label: staffelLabel(tournament), ...(current && tournamentUrl ? { to: tournamentUrl } : {}) };
  const head = trail
    ? [{ label: "Liga", to: "/liga" }, { label: `${trail.leagueName} ${trail.seasonName}`, to: trail.seasonHref }]
    : [{ label: "Liga" }];
  return [{ label: "Home", to: "/" }, ...head, staffel, ...(current ? [current] : [])];
}
