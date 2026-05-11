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
  if (game.kind === "edition" && game.short_name && !label.includes(game.short_name)) {
    return `${label} (${game.short_name})`;
  }
  return label;
}
