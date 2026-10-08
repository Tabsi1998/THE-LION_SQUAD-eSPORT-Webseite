// Turnierleitung am Handy (#1156): wie die Liste der offenen Spiele filtert und was in jeder Zeile steht. Dieselben
// Wörter in der App (mobile/src/lib/tournamentLead.ts).

const RUNNING = new Set(["in_progress", "running", "waiting_result"]);

/** Filter „Alle offenen“, „Läuft“ und „Ergebnis fehlt“. */
export function leadFilter(item, filter) {
  if (filter === "running") return RUNNING.has(String(item?.status)) || item?.timing?.running_minutes != null;
  if (filter === "missing") return Boolean(item?.timing?.missing);
  return true;
}

/** „NeonFalke gegen PixelPanther“ - bei Durchgängen die Zahl der Teilnehmer. */
export function leadNames(item) {
  const names = (item?.participants || []).map((row) => row.name || "Teilnehmer");
  if (item?.kind === "duel" && names.length === 2) return `${names[0]} gegen ${names[1]}`;
  return `${names.length} Teilnehmer`;
}

/** Die Zeitzeile: was fehlt, wie lange es läuft oder wann es geplant ist. `formatWhen` macht aus der Zeit Klartext. */
export function leadLine(item, formatWhen = (value) => value) {
  const timing = item?.timing || {};
  if (item?.status === "disputed") return "In Klärung – Dispute offen";
  if (timing.missing) return `Ergebnis fehlt · ${timing.overdue_minutes ?? 0} Min. über der Zeit`;
  if (timing.running_minutes != null) return `läuft ${timing.running_minutes} Min.${timing.overdue_minutes ? ` · ${timing.overdue_minutes} Min. über der Zeit` : ""}`;
  if (timing.overdue_minutes) return `${timing.overdue_minutes} Min. über der Zeit`;
  if (item?.scheduled_at) return `geplant ${formatWhen(item.scheduled_at)}`;
  return "ohne feste Zeit";
}
