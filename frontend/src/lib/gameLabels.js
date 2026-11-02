export function gameLabel(game) {
  if (!game) return "";
  if (game.display_name) return game.display_name;
  const parentName = game.parent_game?.display_name || game.parent_game?.name;
  const name = game.name || "";
  if ((game.kind === "edition" || game.parent_game_id) && parentName && name) {
    const lowerName = name.toLowerCase();
    const lowerParent = parentName.toLowerCase();
    if (lowerName !== lowerParent && !lowerName.startsWith(`${lowerParent}:`)) {
      return `${parentName}: ${name}`;
    }
  }
  return name;
}

export function gameOptionLabel(game) {
  const label = gameLabel(game);
  const archived = isArchivedGame(game) ? " – archiviert" : "";
  if (game.kind === "edition" && game.short_name && !label.includes(game.short_name)) {
    return `${label} (${game.short_name})${archived}`;
  }
  return `${label}${archived}`;
}

/** Archiviert (#2129): beim Anlegen nicht mehr zur Wahl, alles Bestehende zeigt das Spiel weiter. Fehlt `status`: aktiv. */
export function isArchivedGame(game) {
  return game?.status === "archived";
}

/** Die Spiele für eine Auswahl: ohne archivierte - das schon gewählte bleibt drin, damit es lesbar und speicherbar ist. */
export function selectableGames(games, currentId) {
  return (Array.isArray(games) ? games : []).filter((game) => !isArchivedGame(game) || (currentId && game.id === currentId));
}
