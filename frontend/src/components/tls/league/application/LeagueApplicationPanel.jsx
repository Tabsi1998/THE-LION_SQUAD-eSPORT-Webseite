// Ligaseite (docs/LIGA.md, B.4, #2205): Fenster und freie Plätze für alle, Status und Knopf „Mit Co-Team anmelden“ für die eigenen Co-Teams.
// Andere Teams und ihre Anträge stehen hier nie. Die Schritte selbst stehen auf /liga/<liga>/<season>/anmelden.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, LogIn } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useOptionalAuth } from "@/context/AuthContext";
import { APPLICATION_STATES, STATE_CLASS, canStartApplication, seatsLine, windowLine } from "@/lib/leagueApplications";

export function ApplicationStateBadge({ state, testId }) {
  const info = APPLICATION_STATES[state] || APPLICATION_STATES.none;
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${STATE_CLASS[info.tone]}`}>{info.label}</span>
  );
}

function OwnSquadRow({ row, onWithdraw }) {
  const application = row.application;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-white/10 py-3 first:border-t-0" data-testid={`league-application-row-${row.squad_id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</span>
          <ApplicationStateBadge state={row.state} />
        </div>
        {application?.staffel ? <p className="mt-1 text-sm text-white/75">{application.staffel_left ? `Nicht mehr in ${application.staffel}: Austritt oder Disqualifikation.` : `Spielt in ${application.staffel}.`}</p> : null}
        {row.state === "accepted" && !application?.staffel ? <p className="mt-1 text-sm text-white/75">Der Startplatz steht. Liga und Staffel teilt die Liga-Leitung noch zu.</p> : null}
        {row.state === "waitlist" ? <p className="mt-1 text-sm text-white/75">Wird ein Platz frei, entscheidet die Liga-Leitung. Es rückt niemand von selbst nach.</p> : null}
        {application?.decision_reason ? <p className="mt-1 text-sm text-white/75 [overflow-wrap:anywhere]">Grund: {application.decision_reason}</p> : null}
      </div>
      {application?.can_withdraw ? (
        <button type="button" onClick={() => onWithdraw(row)} data-testid={`league-application-withdraw-${row.squad_id}`}
          className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider">Zurückziehen</button>
      ) : null}
    </li>
  );
}

export function LeagueApplicationPanel({ leagueSlug, seasonSlug, block }) {
  const user = useOptionalAuth()?.user || null;
  const confirm = useConfirm();
  const [view, setView] = useState(null);
  const base = `/leagues/${leagueSlug}/${seasonSlug}`;
  const applyPath = `/liga/${leagueSlug}/${seasonSlug}/anmelden`;
  const signedIn = Boolean(user);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const { data } = await api.get(`${base}/application`);
      setView(data);
    } catch {
      setView(null); // Der öffentliche Teil bleibt stehen.
    }
  }, [base, signedIn]);
  useEffect(() => { load(); }, [load]);

  const withdraw = async (row) => {
    const sure = await confirm({ title: "Anmeldung zurückziehen?", description: `${row.display_name} ist dann nicht mehr angemeldet. Solange das Fenster offen ist, kannst du neu einreichen.`, confirmLabel: "Zurückziehen" });
    if (!sure) return;
    try {
      await api.post(`${base}/applications/${row.application.id}/withdraw`, {});
      toast.success("Anmeldung zurückgezogen.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    await load();
  };

  const current = view?.application || block;
  const seats = seatsLine(current);
  const rows = view?.squads || [];
  const problems = rows.some((row) => row.can_apply) ? view?.season_problems || [] : [];
  return (
    <section className="tls-league-application mt-10 rounded-sm border border-white/10 bg-[#121212] p-4 md:p-5" aria-labelledby="league-application-title" data-testid="league-application">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="league-application-title" className="inline-flex items-center gap-2 font-heading text-xl font-bold uppercase">
            <ClipboardCheck className="h-5 w-5 tls-league-accent" aria-hidden="true" /> Anmeldung
          </h2>
          <p className="mt-1 text-sm text-white/85" data-testid="league-application-window">{windowLine(current)}</p>
          {seats ? <p className="mt-0.5 text-sm text-white/70" data-testid="league-application-seats">{seats}</p> : null}
          {current.entry_policy === "members" ? <p className="mt-0.5 text-sm text-white/70" data-testid="league-application-policy">Nur für Vereinsmitglieder.</p> : null}
          {current.waitlist && current.waitlist_note ? <p className="mt-0.5 text-sm text-white/60 [overflow-wrap:anywhere]" data-testid="league-application-waitlist-note">{current.waitlist_note}</p> : null}
        </div>
        {canStartApplication(view) ? (
          <Link to={applyPath} data-testid="league-application-start"
            className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center rounded-sm px-4 py-2.5 text-xs font-bold uppercase tracking-wider">Mit Co-Team anmelden</Link>
        ) : null}
        {!signedIn && current.state === "open" ? (
          <Link to={`/login?next=${encodeURIComponent(applyPath)}`} data-testid="league-application-login"
            className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
            <LogIn className="h-4 w-4" aria-hidden="true" /> Zum Anmelden einloggen
          </Link>
        ) : null}
      </div>
      {problems.length ? (
        <ul className="mt-3 space-y-1 text-sm text-warn" data-testid="league-application-season-problems">
          {problems.map((text) => <li key={text} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>{text}</span></li>)}
        </ul>
      ) : null}
      {view?.hint ? <p className="mt-3 text-sm text-white/70" data-testid="league-application-hint">{view.hint}</p> : null}
      {rows.length ? (
        <ul className="mt-3" aria-label="Deine Co-Teams" data-testid="league-application-squads">
          {rows.map((row) => <OwnSquadRow key={row.squad_id} row={row} onWithdraw={withdraw} />)}
        </ul>
      ) : null}
    </section>
  );
}
