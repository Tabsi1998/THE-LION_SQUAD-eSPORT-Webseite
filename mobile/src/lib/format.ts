export function displayName(user?: { display_name?: string | null; username?: string } | null) {
  return user?.display_name || user?.username || "Spieler";
}

export function formatDate(value?: string | null) {
  if (!value) return "Noch offen";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatStatus(value?: string | null) {
  if (!value) return "offen";
  return value.replace(/_/g, " ");
}

