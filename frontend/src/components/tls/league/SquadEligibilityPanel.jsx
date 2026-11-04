import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Check, ChevronDown, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ELIGIBILITY_LABELS, TRANSFER_LABELS, ageLabel, rulesLines } from "@/lib/leagueEligibility";
import { viennaDateTime } from "@/lib/vienna";
import { LeagueRulesNote, rulesConsentState } from "./LeagueRulesNote";

// Spielberechtigung im Co-Team (#2204): was die Season verlangt, wer spielen darf und wer nicht, und der Weg zum Transfer. Für Teamleitung,
// Captain und Vertreter. Vom Alter steht hier nur „erfüllt“ oder „Geburtsdatum fehlt“, Spiel-IDs stehen nicht hier.

function untilText(value) {
  try {
    return value ? viennaDateTime(value, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  } catch {
    return "";
  }
}

function PlayerLine({ player }) {
  return (
    <li className="min-w-0 py-1.5" data-testid={`squad-eligibility-player-${player.id}`} data-state={player.state}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        {player.ok ? <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />}
        <span className="min-w-0 truncate font-semibold text-white">{player.name}</span>
        <span className={player.ok ? "text-xs text-white/50" : "text-xs text-warn"}>{ELIGIBILITY_LABELS[player.state] || player.state}{player.ok && ageLabel(player.age) ? ` · ${ageLabel(player.age)}` : ""}</span>
      </div>
      {!player.ok && player.reason ? <p className="mt-0.5 pl-5 text-xs text-white/60 [overflow-wrap:anywhere]">{player.reason}</p> : null}
    </li>
  );
}

function Transfers({ rows, teamId, squadId, canEdit, onChanged }) {
  if (!rows.length) return null;
  const withdraw = async (row) => {
    try {
      await api.delete(`/teams/${teamId}/squads/${squadId}/transfers/${row.id}`);
      toast.success("Antrag zurückgezogen.");
      await onChanged();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-white/55">Transfers</p>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2" data-testid={`squad-transfer-${row.id}`} data-status={row.status}>
            <span className="min-w-0 text-white/80 [overflow-wrap:anywhere]">{row.user_name}: {TRANSFER_LABELS[row.status] || row.status}{row.reason ? ` („${row.reason}“)` : ""}</span>
            {row.status === "pending" && canEdit ? (
              <button type="button" onClick={() => withdraw(row)} className="tls-btn tls-btn--quiet min-h-[40px] rounded-sm px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" data-testid={`squad-transfer-withdraw-${row.id}`}>
                Zurückziehen
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Candidates({ rows, rules, teamId, squadId, transfers, onChanged }) {
  const [busy, setBusy] = useState("");
  const open = new Set(transfers.filter((row) => row.status === "pending").map((row) => row.user_id));
  const movers = rows.filter((row) => row.needs_transfer);
  const blocked = rows.filter((row) => !row.needs_transfer && !row.can_add);
  if (!movers.length && !blocked.length) return null;
  const ask = async (row) => {
    setBusy(row.id);
    try {
      await api.post(`/teams/${teamId}/squads/${squadId}/transfers`, { user_id: row.id });
      toast.success(`Transfer für ${row.name} beantragt. Die Liga-Leitung entscheidet.`);
      await onChanged();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy("");
  };
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-white/55">Aus dem Team, noch nicht aufnehmbar</p>
      <ul className="mt-1 space-y-1.5 text-sm">
        {movers.map((row) => (
          <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2" data-testid={`squad-candidate-${row.id}`}>
            <span className="min-w-0 text-white/80 [overflow-wrap:anywhere]">{row.name}: {row.reason}</span>
            {open.has(row.id) ? <span className="text-xs text-white/50">Antrag läuft</span> : (
              <button type="button" disabled={!rules.transfer_open || busy === row.id} onClick={() => ask(row)} title={rules.transfer_open ? undefined : "Das Transferfenster ist gerade zu."}
                className="tls-btn tls-btn--secondary inline-flex min-h-[40px] items-center gap-1.5 rounded-sm px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid={`squad-transfer-ask-${row.id}`}>
                <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" /> Transfer beantragen
              </button>
            )}
          </li>
        ))}
        {blocked.map((row) => (
          <li key={row.id} className="min-w-0 text-white/70 [overflow-wrap:anywhere]" data-testid={`squad-candidate-${row.id}`}>{row.name}: {row.reason}</li>
        ))}
      </ul>
    </div>
  );
}

export function SquadEligibilityPanel({ teamId, squad }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/teams/${teamId}/squads/${squad.id}/eligibility`);
      setData(body);
    } catch {
      // Nur Teamleitung, Captain und Vertreter: Für alle anderen steht hier nichts.
      setData(null);
    }
  }, [teamId, squad.id]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["teams"]);
  const seasons = data?.seasons || [];
  if (!seasons.length) return null;
  const blocked = seasons.reduce((sum, season) => sum + season.players.filter((player) => !player.ok).length, 0);
  // Regelwerk (#2269): Verlangt eine neue Fassung die Zustimmung, bleibt das nicht hinter dem zugeklappten Bereich verborgen.
  const consentOpen = seasons.some((season) => rulesConsentState(season.rules_doc) === "open");
  return (
    <details className="group mt-3 rounded-sm border border-white/10 bg-white/[0.02]" data-testid={`squad-eligibility-${squad.id}`} open={blocked > 0 || consentOpen}>
      <summary className="tls-hit flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#29B6E8] [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          Spielberechtigung{blocked ? ` · ${blocked} ${blocked === 1 ? "Person darf" : "Personen dürfen"} nicht spielen` : ""}
          {consentOpen ? <span className="text-warn"> · Regelwerk: bitte zustimmen</span> : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-fast ease-tls group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-white/10 px-3 py-3">
        {seasons.map((season) => (
          <div key={season.season_id} className="space-y-3" data-testid={`squad-eligibility-season-${season.season_id}`}>
            {/* Regelwerk (#2269): gültige Fassung und der Stand der Zustimmung dieses Co-Teams. */}
            {season.rules_doc ? <LeagueRulesNote rules={season.rules_doc} testId={`squad-rules-${season.season_id}`} /> : null}
            <ul className="space-y-0.5 text-xs text-white/60">
              {rulesLines(season.rules).map((line) => <li key={line} className="[overflow-wrap:anywhere]">{line}</li>)}
            </ul>
            <ul className="divide-y divide-white/5">
              {season.players.map((player) => <PlayerLine key={player.id} player={player} />)}
            </ul>
            {season.players.some((player) => player.until) ? (
              <p className="text-xs text-white/50">Wartezeit endet: {season.players.filter((player) => player.until).map((player) => `${player.name} ${untilText(player.until)}`).join(", ")}</p>
            ) : null}
            <Candidates rows={season.candidates} rules={season.rules} teamId={teamId} squadId={squad.id} transfers={season.transfers} onChanged={load} />
            <Transfers rows={season.transfers} teamId={teamId} squadId={squad.id} canEdit={season.can_edit} onChanged={load} />
          </div>
        ))}
      </div>
    </details>
  );
}
