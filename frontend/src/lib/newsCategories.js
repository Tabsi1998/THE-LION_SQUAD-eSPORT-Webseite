// News-Kategorien als Begriff statt Rohwert ("events", "announcement").
// Dieselben Begriffe wie /api/news/meta im Backend und wie in der App.

export const NEWS_CATEGORY_LABELS = {
  club: "Verein",
  tournaments: "Turniere",
  events: "Events",
  community: "Community",
  sponsors: "Sponsoren",
  members: "Mitglieder",
  teams: "Teams",
  announcement: "Ankündigung",
  recap: "Rückblick",
  maintenance: "Wartung",
};

export function newsCategoryLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  return NEWS_CATEGORY_LABELS[key] || key.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}
