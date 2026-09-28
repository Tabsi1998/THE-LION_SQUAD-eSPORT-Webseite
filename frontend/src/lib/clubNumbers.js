// Der Verein in Zahlen (#621): welche Zähler es gibt, wie sie heißen (Einzahl, wenn es genau eins ist)
// und in welcher Reihenfolge der Betreiber sie zeigt. „Vergebene Auszeichnungen“ sind seit #621 keine
// Wahl mehr - die Zahl sagt nichts über den Verein; Preise, gespielte Turniere, Mitglieder und Jahre schon.

export const NUMBER_LABELS = {
  prizes: ["Preise vergeben", "Preis vergeben"],
  tournaments_completed: ["Turniere gespielt", "Turnier gespielt"],
  members: ["Mitglieder", "Mitglied"],
  years_active: ["Jahre aktiv", "Jahr aktiv"],
  tournaments: ["Veranstaltete Turniere", "Veranstaltetes Turnier"],
  events: ["Veranstaltete Events", "Veranstaltetes Event"],
  participations: ["Turnierteilnahmen", "Turnierteilnahme"],
};

export const NUMBER_KEYS = Object.keys(NUMBER_LABELS);
export const DEFAULT_SHOWN = ["prizes", "tournaments_completed", "members", "years_active"];

/** Die Kacheln in der gewählten Reihenfolge - nur Zähler über null. */
export function numberItems(numbers, shown) {
  const order = Array.isArray(shown) && shown.length ? shown.filter((key) => NUMBER_LABELS[key]) : DEFAULT_SHOWN;
  return order
    .map((key) => {
      const value = Number(numbers?.[key] || 0);
      const [plural, single] = NUMBER_LABELS[key];
      return { key, label: value === 1 ? single : plural, value };
    })
    .filter((item) => item.value > 0);
}

/** Schaltet einen Zähler ein oder aus, ohne die Reihenfolge der anderen zu verlieren. */
export function toggleShown(shown, key) {
  const list = Array.isArray(shown) ? shown : [];
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}

/** Verschiebt einen Zähler um eine Stelle nach oben (-1) oder unten (+1). */
export function moveShown(shown, key, direction) {
  const list = Array.isArray(shown) ? [...shown] : [];
  const index = list.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target], list[index]];
  return list;
}
