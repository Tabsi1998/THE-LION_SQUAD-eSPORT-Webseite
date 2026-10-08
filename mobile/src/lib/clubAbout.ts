// Über uns in der App (#1024): ein paar Sätze, Zahlen, Vorstand, Werte und Kontakt - dieselben Inhalte wie im Web
// (/api/home/about, /api/board, Kontakt-Adresse aus den Einstellungen). Lange Seiten bleiben auf der Website.

export const NUMBER_LABELS: Record<string, string> = {
  members: "Mitglieder",
  tournaments: "Turniere",
  tournaments_completed: "Turniere gespielt",
  events: "Events",
  years_active: "Jahre aktiv",
  prizes: "Preise vergeben",
  participations: "Turnierteilnahmen",
};

export type AboutPayload = {
  texts?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  numbers?: Record<string, number>;
  numbers_shown?: string[];
};

/** Die ersten Sätze eines Textes - in der App nur kurz, der Rest steht auf der Website. */
export function firstParagraph(text?: unknown, max = 320): string {
  const value = String(text || "").split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()} …`;
}

/** Höchstens drei Zahlen, in der Reihenfolge, die der Verein im Admin gewählt hat; Nullen bleiben weg. */
export function aboutNumbers(about?: AboutPayload | null, limit = 3): Array<{ key: string; label: string; value: number }> {
  const shown = Array.isArray(about?.numbers_shown) && about?.numbers_shown?.length ? about.numbers_shown : ["members", "tournaments_completed", "events"];
  return shown
    .filter((key) => NUMBER_LABELS[key] && Number(about?.numbers?.[key] || 0) > 0)
    .slice(0, limit)
    .map((key) => ({ key, label: NUMBER_LABELS[key], value: Number(about?.numbers?.[key] || 0) }));
}

/** Die Säulen („Fairplay“, „Rudel“ …) als Liste - nur Texte. */
export function pillarList(about?: AboutPayload | null): string[] {
  const raw = about?.texts?.pillars;
  return Array.isArray(raw) ? raw.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6) : [];
}
