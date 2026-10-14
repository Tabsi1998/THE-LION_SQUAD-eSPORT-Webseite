import { api, formatRequestError } from "@/lib/api";
import { toast } from "sonner";
import { countOf, describeSchedulePlan } from "@/lib/schedulePlanText";

const STALE_TEXT = "Der Plan hat sich inzwischen geändert - bitte noch einmal Planen.";

/** Die Vorschau des Planers (#1552): Zeit und Station je Spiel, Warnungen, Fingerabdruck - geschrieben wird nichts. */
export async function requestSchedulePlan(tournamentId) {
  const { data } = await api.post(`/tournaments/${encodeURIComponent(tournamentId)}/schedule/plan`);
  return data;
}

/**
 * „Übernehmen“ zu genau der gezeigten Vorschau (Matchplan-Seite, #1557): Fingerabdruck und Anker gehen mit. Antwortet
 * der Server mit 409, hat sich der Plan inzwischen geändert oder die Vorschau ist zu alt - dann `stale: true`, und die
 * Seite plant neu, statt etwas anderes zu schreiben als gezeigt.
 */
export async function applySchedulePlan(tournamentId, plan) {
  try {
    const { data } = await api.post(`/tournaments/${encodeURIComponent(tournamentId)}/schedule/apply`,
      { fingerprint: plan.fingerprint, planned_at: plan.planned_at });
    return { ok: true, written: Number(data?.written) || 0 };
  } catch (error) {
    if (error?.response?.status === 409) return { ok: false, stale: true, message: error.response?.data?.detail || STALE_TEXT };
    return { ok: false, stale: false, message: formatRequestError(error, "Spielplan konnte nicht übernommen werden.") };
  }
}

/**
 * Ein Spiel auf eine Zeit und Station legen (Ziehen auf der Zeitleiste oder Tastatur, #1557) - über den bestehenden
 * Weg PATCH /matches/:id. Der Server macht daraus einen festen Termin (`manual`) und lehnt eine belegte Station mit 409
 * ab. `release: true` löst den festen Termin: ohne Zeit plant der Planer das Spiel beim nächsten Mal wieder.
 */
export async function moveMatch(matchId, { start, stationId, release = false } = {}) {
  const body = release
    ? { scheduled_at: null }
    : { scheduled_at: new Date(start).toISOString(), station_id: stationId && stationId !== "none" ? stationId : null };
  try {
    await api.patch(`/matches/${encodeURIComponent(matchId)}`, body);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: formatRequestError(error, "Das Spiel konnte nicht verschoben werden.") };
  }
}

/**
 * Ein Spiel von Hand ändern (Matchplan, ersetzt die alte „Matchplanung“ im Reiter „Spiele“): Start, Station und eigene
 * Dauer über PATCH /matches/:id. Ein Start macht den Termin fest (`manual`), leer gibt ihn an den Planer zurück.
 */
export async function updateMatchPlan(matchId, body) {
  try {
    await api.patch(`/matches/${encodeURIComponent(matchId)}`, body);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: formatRequestError(error, "Das Spiel konnte nicht gespeichert werden.") };
  }
}

/**
 * Feste Termine auf einmal lösen (Praxis 14.10.): „all“ alle von Hand gesetzten, „missing_stations“ nur die Spiele an
 * einer Station, die es nicht mehr gibt. Der Server löst nur Spiele, die noch nicht begonnen haben, und schreibt ins
 * Protokoll. Danach plant „Automatisch planen“ neu.
 */
export async function releaseSchedule(tournamentId, scope = "all") {
  try {
    const { data } = await api.post(`/tournaments/${encodeURIComponent(tournamentId)}/schedule/release`, { scope });
    return { ok: true, released: Number(data?.released) || 0 };
  } catch (error) {
    return { ok: false, message: formatRequestError(error, "Die Termine konnten nicht gelöst werden.") };
  }
}

// Spielplaner (#1552), ein Ablauf für Turnierseite und Stationsseite: „Planen“ holt die Vorschau, der Dialog zeigt
// Zeit und Station je Spiel samt Konflikten, und erst „Übernehmen“ schreibt - mit dem Fingerabdruck der gesehenen
// Vorschau, damit nie etwas anderes geschrieben wird als gezeigt. Gibt true zurück, wenn geschrieben wurde.
export async function planAndApplySchedule({ tournamentId, confirm }) {
  try {
    const { data: plan } = await api.post(`/tournaments/${encodeURIComponent(tournamentId)}/schedule/plan`);
    const changed = (plan.assignments || []).filter((item) => item.changed !== false);
    const warnings = plan.warnings || [];
    const errors = warnings.filter((item) => item.severity === "error");
    if (plan.mode === "none" || (!changed.length && !warnings.length)) {
      toast.message(plan.reason || "Nichts zu planen: alle Spiele stehen schon so im Plan.");
      return false;
    }
    const ok = await confirm({
      title: "Spielplan übernehmen?",
      description: describeSchedulePlan(plan, changed, warnings),
      confirmLabel: "Übernehmen",
      tone: errors.length ? "danger" : "info",
    });
    if (!ok) return false;
    const { data } = await api.post(`/tournaments/${encodeURIComponent(tournamentId)}/schedule/apply`,
      { fingerprint: plan.fingerprint, planned_at: plan.planned_at });
    toast.success(`${countOf(data.written, "Spiel", "Spiele")} geplant.`);
    return true;
  } catch (e) {
    if (e.response?.status === 409) {
      toast.error(e.response?.data?.detail || "Der Plan hat sich inzwischen geändert - bitte noch einmal Planen.");
      return false;
    }
    toast.error(formatRequestError(e, "Spielplan konnte nicht berechnet werden."));
    return false;
  }
}
