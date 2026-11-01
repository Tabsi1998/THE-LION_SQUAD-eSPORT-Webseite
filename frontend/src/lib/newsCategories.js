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
  video: "Video",
};

// Sichtbarkeit als Begriff statt Rohwert (#2122 NW4) - dieselben Begriffe wie /api/news-meta.
export const NEWS_VISIBILITY_LABELS = {
  public: "Öffentlich",
  community: "Nur registrierte Community",
  members: "Nur Vereinsmitglieder",
  internal: "Nur intern (Admins)",
};

export function newsVisibilityLabel(value) {
  const key = String(value || "public").trim().toLowerCase();
  return NEWS_VISIBILITY_LABELS[key] || key;
}

export function newsCategoryLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  return NEWS_CATEGORY_LABELS[key] || key.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}
