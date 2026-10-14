import { api, formatRequestError } from "@/lib/api";
import { toast } from "sonner";
import { countOf, describeSchedulePlan } from "@/lib/schedulePlanText";

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
