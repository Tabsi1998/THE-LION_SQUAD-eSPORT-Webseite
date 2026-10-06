// Mehrtägige Events (#884): Karten und Listen zeigen statt des Beginns „3 Tage · Fr 16.10. – So 18.10.“ und,
// wenn das Event läuft oder zwischen zwei Tagen steht, den Satz zum Jetzt („Tag 2 beginnt morgen um 10:00“).
// Die Texte kommen fertig vom Server (`schedule`), damit Website, App und Discord dasselbe sagen.

export function scheduleLine(schedule, { withNow = true } = {}) {
  if (!schedule?.multi_day) return "";
  const now = withNow && ["running", "break"].includes(schedule.now?.state) ? schedule.now.text : "";
  return [schedule.label, now].filter(Boolean).join(" · ");
}

// Zum Sortieren: ein laufendes oder pausierendes mehrtägiges Event zählt mit seinem nächsten Tag, nicht mit Tag 1.
export function eventSortTime(item) {
  const when = item?.schedule?.multi_day && item.schedule.next_at ? item.schedule.next_at : item?.start_date;
  return when ? new Date(when).getTime() : Number.MAX_SAFE_INTEGER;
}
