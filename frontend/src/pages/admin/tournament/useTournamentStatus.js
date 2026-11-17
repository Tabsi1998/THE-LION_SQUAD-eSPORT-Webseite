// Status eines Turniers setzen (#2120, #2452, #2460) - als Baustein für die Turnierverwaltung und die Staffel-Seite der
// Liga-Verwaltung (#2262): beide fragen mit denselben Sätzen nach (Entwurf, Beenden, Veröffentlichen, Absage mit Grund, Live
// mit Planungskonflikten) und zeigen dieselben Meldungen. Der Server prüft das Recht selbst (`tournament_lifecycle_routes.py`).
import { api, formatRequestError } from "@/lib/api";
import { toast } from "sonner";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";
import { SETTLE_WARNING_DURATION, settleFailureMessage } from "@/lib/settleFailure";
import { liveCheckWords, statusChangeNotice, statusDoneText } from "./shared";

/**
 * ``id``: Kennung des Turniers, ``t``: das geladene Turnier, ``regs``: seine Anmeldungen (für „Alle 5 Anmeldungen bekommen …“),
 * ``load``: lädt nach einer Änderung neu. Liefert `setTournStatus`, `runPlanningCheck` und `recheckResults`.
 */
export function useTournamentStatus({ id, tournament: t, registrations: regs = [], onChanged: load }) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const runPlanningCheck = async ({ silent = false } = {}) => {
    const { data } = await api.get(`/tournaments/${id}/planning-check`);
    const lines = [...(data.errors || []), ...(data.warnings || [])]
      .slice(0, 8)
      .map((item) => item.message)
      .join("\n");
    if (!silent) {
      if (data.ok && !data.warning_count) toast.success(`Planung in Ordnung: ${data.checked_matches === 1 ? "1 Spiel" : `${data.checked_matches} Spiele`} geprüft.`);
      else toast[data.ok ? "warning" : "error"](`${data.error_count} Konflikte, ${data.warning_count} Hinweise${lines ? `\n${lines}` : ""}`);
    }
    return data;
  };
  const setTournStatus = async (status) => {
    const staffel = Boolean(t?.league_context);
    let forceStart = false;
    let reason = null;
    // Status mit Folgen (#2120, TA24): Entwurf nimmt die Seite weg, Beendet und Veröffentlicht verschicken und
    // vergeben, Abgesagt benachrichtigt alle Angemeldeten - mit freiwilligem Grund.
    const notice = statusChangeNotice(status, t, {
      activeRegistrations: regs.filter((r) => ["pending", "approved", "checked_in", "waitlist"].includes(r.status)).length,
    });
    if (notice?.askReason) {
      const answer = await prompt({ ...notice, multiline: false });
      if (answer === false || answer === null || answer === undefined) return;
      reason = String(answer).trim() || null;
    } else if (notice && !await confirm(notice)) {
      return;
    }
    try {
      if (status === "live") {
        const report = await runPlanningCheck({ silent: true });
        if (!report.ok || report.warning_count > 0) {
          const lines = [...(report.errors || []), ...(report.warnings || [])]
            .slice(0, 10)
            .map((item) => item.message)
            .join("\n");
          // Eine Staffel startet bzw. setzt fort (#2262) - ein Turnier schaltet live.
          const ok = await confirm({
            ...liveCheckWords(report, t),
            description: `${report.error_count} Konflikte, ${report.warning_count} Hinweise.${lines ? `\n\n${lines}` : ""}`,
            tone: report.ok ? "info" : "danger",
          });
          if (!ok) return;
          forceStart = !report.ok;
        }
      }
      const { data } = await api.post(`/tournaments/${id}/status`, reason ? { status, force: forceStart, reason } : { status, force: forceStart });
      const done = statusDoneText(status, t);
      toast.success(status === "cancelled" && Number.isFinite(data?.notified)
        ? `${done} – ${data.notified === 1 ? "1 Person benachrichtigt" : `${data.notified} Personen benachrichtigt`}.`
        : done);
      // Punkte in einer abgeschlossenen Jahreswertung bleiben unverändert (#2123) - das sagt der Server dazu.
      if (data?.season_points_note) toast.info(data.season_points_note, { duration: 10000 });
      // Ein Abschluss-Schritt gescheitert (#2460): Warnung mit den Schritten und gleich „Abschluss nachholen“.
      const settleWarning = settleFailureMessage(data);
      if (settleWarning) {
        toast.warning(settleWarning, {
          duration: SETTLE_WARNING_DURATION,
          action: { label: "Abschluss nachholen", onClick: () => recheckResults(status) },
        });
      }
      load();
    } catch (e) {
      const statusDetail = e.response?.data?.detail;
      if (statusDetail?.code === "tournament_not_ready") {
        toast.error(statusDetail.message || (staffel ? "Die Staffel ist noch nicht startbereit." : "Turnier ist noch nicht startbereit."));
        return;
      }
      toast.error(formatRequestError(e, staffel ? "Der Status der Staffel konnte nicht gespeichert werden." : "Turnierstatus konnte nicht gespeichert werden."));
    }
  };
  // Abschluss nachholen (#2452): ein veröffentlichtes Turnier noch einmal auswerten - Auszeichnungen, Erfolge, Punkte und
  // Gewinne, die beim Veröffentlichen ausblieben, kommen genau einmal dazu. Kein Statuswechsel; wer etwas Neues bekommt,
  // erhält die übliche Meldung zu Erfolg bzw. Gewinn - kein „Turnier beendet“, nichts im Discord-Kanal.
  // ``status``: aus der Warnung direkt nach dem Veröffentlichen (#2460) - da ist ``t`` noch der alte Stand.
  const recheckResults = async (status = t.status) => {
    const ok = await confirm({
      title: "Abschluss nachholen?",
      description: "Das System prüft Auszeichnungen, Erfolge, Jahreswertung und Gewinne dieses Turniers noch einmal und vergibt, was fehlt – genau einmal. Ergebnisse und Status bleiben. Wer jetzt etwas Neues bekommt, erhält die übliche Meldung zu Erfolg bzw. Gewinn. Kein „Turnier beendet“, nichts im Discord-Kanal.",
      confirmLabel: "Nachholen",
      tone: "info",
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/tournaments/${id}/status`, { status, recheck: true });
      // Ist ein Schritt gescheitert, sagt der Server welcher - dann eine Warnung statt „nachgeholt“ (#2452).
      const failed = Array.isArray(data?.failed_labels) ? data.failed_labels : [];
      if (failed.length) toast.warning(`Nicht alles nachgeholt – gescheitert: ${failed.join(", ")}. Die übrigen Schritte sind gelaufen; bitte später noch einmal versuchen.`, { duration: 12000 });
      else toast.success(`Abschluss nachgeholt – ${data?.awards ?? 0} Auszeichnungen geprüft.`);
      if (data?.season_points_note) toast.info(data.season_points_note, { duration: 10000 });
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Der Abschluss konnte nicht nachgeholt werden."));
    }
  };
  return { setTournStatus, runPlanningCheck, recheckResults };
}
