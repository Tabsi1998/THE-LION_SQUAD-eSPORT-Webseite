// Reiter „Spielplan“ der Staffel-Seite (#2262, Entwurf 2.2, Paket B): die Spielwochen (`LeagueWeeks`) mit Fenster, Frist, Termin je
// Partie und woher er kommt; „Termin setzen“ mit „Spiele betreuen“ (wie `PATCH /matches`, Befangenheit wie überall). Vor dem Start
// stehen nur Vorschau-Spiele - dann „Vorschau neu mischen“ und „Spieltage neu auslosen“ (`DrawControls`) mit „Season konfigurieren“.
// Dazu CSV Matchplan und PDF Spiele. Den Termin-Rahmen (Wochentag, Uhrzeit, Sperrwochen) pflegt die Season (Reiter Termine).
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { API, api, formatRequestError } from "@/lib/api";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";
import { emergencyFields, updateMatchPlan } from "@/lib/schedulePlan";
import { seasonAnchorUrl } from "@/lib/seasonTabs";
import { matchRights } from "@/lib/tournamentRights";
import { DrawControls } from "@/pages/admin/tournament/DrawControls";
import { staffelBeforeStart } from "@/pages/admin/tournament/StaffelParts";
import { MatchEditor } from "@/pages/admin/tournament/matchplan/MatchPlanParts";
import { LeagueWeeks } from "@/pages/admin/tournament/matchplan/MatchPlanRemote";

const BUTTON = "tls-btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm px-4 text-xs font-bold uppercase tracking-wider";

function Downloads({ tournament }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <a href={`${API}/tournaments/${tournament.id}/match-plan.csv`} target="_blank" rel="noreferrer" data-testid="staffel-csv-matchplan" className={`${BUTTON} tls-btn--quiet`}>
        <FileDown className="h-4 w-4" aria-hidden="true" /> CSV Matchplan
      </a>
      <a href={`${API}/exports/tournaments/${tournament.id}/matches.pdf`} target="_blank" rel="noreferrer" data-testid="staffel-pdf-matches" className={`${BUTTON} tls-btn--quiet`}>
        <FileDown className="h-4 w-4" aria-hidden="true" /> PDF Spiele
      </a>
    </div>
  );
}

/** Vor dem Start: Vorschau neu mischen und - solange Spieltag 1 nicht begonnen hat - die Spieltage neu auslosen. Nur mit „Season konfigurieren“. */
function BeforeStartTools({ tournament, matches, onReload }) {
  const confirm = useConfirm();
  const [stages, setStages] = useState(null);
  const [busy, setBusy] = useState(false);
  const loadStages = useCallback(() => api.get(`/tournaments/${tournament.id}/stages`)
    .then(({ data }) => setStages(Array.isArray(data) ? data : []))
    .catch(() => setStages([])), [tournament.id]);
  useEffect(() => { loadStages(); }, [loadStages]);
  const preview = matches.filter((match) => match?.is_preview).length;
  const remix = async () => {
    const ok = await confirm({
      title: "Vorschau neu mischen?",
      description: "Neu gemischt wird, wer in welcher Woche gegen wen spielt. Fest wird der Spielplan erst mit „Liga starten“ – bis dahin ändert sich für die Teams nichts.",
      confirmLabel: "Neu mischen",
      tone: "info",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/tournaments/${tournament.id}/bracket/from-format?preview=true&force=true`);
      toast.success(`Vorschau mit ${data?.match_count ?? 0} Spielen neu gemischt.`);
      await onReload?.();
      loadStages();
    } catch (failure) {
      toast.error(formatRequestError(failure, "Die Vorschau ließ sich nicht neu mischen."));
    } finally {
      setBusy(false);
    }
  };
  const league = (stages || []).find((stage) => stage.stage_type === "league");
  return (
    <section className="space-y-3 rounded-sm border border-white/10 bg-[#121212] p-4" aria-labelledby="staffel-preview-title" data-testid="staffel-preview-tools">
      <h3 id="staffel-preview-title" className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">Vorschau</h3>
      <p className="text-sm text-white/70">
        {preview ? `Die Vorschau hat ${preview} Spiele.` : "Noch keine Vorschau – sie entsteht mit den zugeteilten Teams."} Spielwochen, Fristen und Termine stehen mit „Liga starten“ fest.
      </p>
      {preview ? (
        <button type="button" onClick={remix} disabled={busy} data-testid="staffel-remix" className={`${BUTTON} tls-btn--secondary w-full sm:w-auto`}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Vorschau neu mischen
        </button>
      ) : null}
      {league ? <DrawControls tournamentId={tournament.id} stage={league} matches={matches} touch onChanged={() => { onReload?.(); loadStages(); }} /> : null}
    </section>
  );
}

export function StaffelScheduleTab({ tournament, registrations = [], matches = [], onReload }) {
  const askReason = usePrompt();
  const before = staffelBeforeStart(tournament);
  const [matchdays, setMatchdays] = useState(null);
  const [error, setError] = useState("");
  const loadWeeks = useCallback(() => api.get(`/tournaments/${tournament.id}/matchdays`)
    .then(({ data }) => { setMatchdays(data); setError(""); })
    .catch((failure) => setError(formatRequestError(failure, "Der Server antwortet gerade nicht."))), [tournament.id]);
  useEffect(() => { if (!before) loadWeeks(); }, [before, loadWeeks]);

  const byId = new Map(matches.map((match) => [match.id, match]));
  // Termin je Spiel wie der Server (`PATCH /matches`): „Spiele betreuen“, im eigenen Spiel nur der Superadmin mit Grund.
  const canEdit = (match) => Boolean(match) && matchRights(tournament, match).plan;
  const save = async (item, body) => {
    const emergency = await emergencyFields(byId.get(item.id), askReason);
    if (!emergency) return { ok: false, message: "Abgebrochen – ohne Grund bleibt der Termin." };
    const result = await updateMatchPlan(item.id, { ...body, ...emergency });
    if (result.ok) {
      toast.success(`${item.key} gespeichert.`);
      await onReload?.();
      loadWeeks();
    }
    return result;
  };
  const editor = (match, close) => (
    <MatchEditor item={{ id: match.id, key: match.match_key || "Spiel" }} match={byId.get(match.id) || match} stations={[]} stage={null}
      tournament={tournament} game={null} onSave={save} onClose={close} withStation={false} />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-sm border border-white/10 bg-[#121212] p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="font-heading text-xl font-black uppercase">Spielplan</h2>
          <p className="mt-1 text-sm text-white/60">
            Wochentag, Uhrzeit und Sperrwochen gibt die Season vor.{" "}
            <Link to={seasonAnchorUrl(tournament.league_context?.season_id, "termine")} className="inline-flex min-h-[44px] items-center gap-1 font-bold text-[#29B6E8] hover:text-white"
              data-testid="staffel-season-dates">
              Termine der Season <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </p>
        </div>
        <Downloads tournament={tournament} />
      </div>

      {before ? (
        tournament.can_manage_structure
          ? <BeforeStartTools tournament={tournament} matches={matches} onReload={onReload} />
          : <p className="rounded-sm border border-white/10 bg-[#121212] p-4 text-sm text-white/70" data-testid="staffel-preview-note">Spielwochen, Fristen und Termine stehen mit „Liga starten“ fest. Die Vorschau mischt, wer in dieser Liga „Season konfigurieren“ hat.</p>
      ) : (
        <div id="termine" className="scroll-mt-24 min-w-0">
          <LeagueWeeks tournament={tournament} matches={matches} registrations={registrations} matchdays={matchdays} error={error}
            canEdit={canEdit} editor={editor} variant="staffel" />
          {matches.some((match) => match.viewer_involved) ? (
            <p className="mt-3 text-xs text-white/60" data-testid="staffel-own-matches">
              An einem Spiel bist du selbst beteiligt: Den Termin setzt dort eine zweite Person. Als Captain oder Vertreter nutzt du Vorschlag und Zustimmung auf der Matchseite.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
