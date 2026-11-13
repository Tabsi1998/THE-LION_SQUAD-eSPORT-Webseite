// Reiter „Abschluss“ der Season-Seite (F.1, #1645, docs/LIGA.md „F.1 Saisonabschluss“): je Staffel die Checkliste mit allem, was dem
// Abschluss noch entgegensteht (mit Link dorthin), die Vorschau des Endstands, der Entscheid bei Gleichstand auf Platz 1, „Staffel
// abschließen“ mit Bestätigung, der Verlauf der Fassungen und „Wieder öffnen“ durch eine zweite Person. Was geht, sagt der Server -
// die Karte erklärt es statt eines toten Knopfs.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleAlert, Crown, Gift, History, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormSection } from "@/components/tls/AdminForm";
import { TextAreaField } from "@/components/tls/FormFields";
import { ConflictReasonField, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";
import { StandingsTable, ZoneLegend, standingKey } from "@/components/tls/tournament/StandingsTable";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatApiError } from "@/lib/api";
import { closeState, decisionLine, finalMoment, historyLine, methodOptions, reopenProblem, seasonSummary, staffelLabel, untilText } from "@/lib/leagueFinal";
import { byMaps, hidesDraws } from "@/lib/leagueTable";
import { OrderSheet } from "./SeasonTablePanel";
import "./seasonClose.css";

const BUTTON = "tls-btn inline-flex min-h-11 items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const CHIP = {
  closed: "border-[#29B6E8]/50 text-[#29B6E8]",
  ready: "border-ok/50 text-ok",
  blocked: "border-warn/50 text-warn",
};

function errorOf(failure, fallback) {
  return formatApiError(failure.response?.data?.detail) || fallback;
}

function Table({ rows, rules, championId, label }) {
  const leader = championId ? rows.find((item) => item.registration_id === championId) : null;
  return (
    <div className="tls-close-table">
      <StandingsTable rows={rows} kind="team_league" label={label} mineLabel="Dein Team" championKey={leader ? standingKey(leader) : null}
        hideDraws={hidesDraws(rules, rows)} mapPoints={byMaps(rules)} />
      <ZoneLegend rows={rows} />
    </div>
  );
}

// Gleichstände, die einen Entscheid brauchen (Nr. 156): um den Meistertitel und - seit F.2 (#1627) - an einer Grenze zu Auf- oder Abstieg.
const TIE_BLOCKERS = { champion_tie: { kind: "champion", label: "Meister entscheiden" }, zone_tie: { kind: "zone", label: "Platz entscheiden" } };

/** Die Checkliste: jeder Sperrgrund mit seinen Fällen und dem Weg dorthin. */
function Checklist({ row, canResults, superadmin, onDecide }) {
  if (!row.blockers.length) {
    return (
      <p className="flex items-start gap-2 text-sm text-ok" data-testid={`close-ready-${row.tournament_id}`}>
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Alle Spiele sind entschieden, kein Vorfall, Verfahren oder Einspruch ist offen und keine Frist läuft mehr.</span>
      </p>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Was noch fehlt" data-testid={`close-blockers-${row.tournament_id}`}>
      {row.blockers.map((blocker) => (
        <li key={blocker.code} className="rounded-sm border border-warn/30 bg-warn/5 p-3" data-testid={`close-blocker-${row.tournament_id}-${blocker.code}`}>
          <p className="flex items-start gap-2 text-sm font-semibold text-white">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <span>{blocker.label}{blocker.count > 1 ? ` (${blocker.count})` : ""}</span>
          </p>
          <p className="mt-1 text-xs text-white/65">{blocker.text}</p>
          {blocker.items.length ? (
            <ul className="mt-2 space-y-1">
              {blocker.items.map((item, index) => (
                <li key={`${item.url}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {TIE_BLOCKERS[blocker.code]
                    ? <span className="min-w-0 break-words text-white/85">{item.text}</span>
                    : <Link to={item.url} className="inline-flex min-h-11 min-w-0 items-center break-words text-[#29B6E8] hover:underline">{item.text}</Link>}
                  {untilText(item) ? <span className="text-xs tabular-nums text-white/55">{untilText(item)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {blocker.count > blocker.items.length ? <p className="mt-1 text-xs text-white/50">und {blocker.count - blocker.items.length} weitere</p> : null}
          {TIE_BLOCKERS[blocker.code] ? (
            <div className="mt-2 space-y-2">
              {!row.can_decide ? (
                <p className="text-xs text-white/65">
                  In dieser Season entscheidet die Leitung keinen Gleichstand. Nimm im Reiter{" "}
                  <Link to="#gleichstand" className="text-[#29B6E8] hover:underline">Tabelle</Link> „Entscheid der Leitung“ als letztes Kriterium auf und übertrage die Vorgaben.
                </p>
              ) : !canResults ? (
                <p className="text-xs text-white/65">Den Entscheid trifft, wer in dieser Liga „Ergebnisse korrigieren“ darf.</p>
              ) : row.ties.filter((tie) => (tie.kind || "champion") === TIE_BLOCKERS[blocker.code].kind).map((tie) => (tie.own_team && !superadmin
                ? <OwnTeamNote key={tie.rank} testId={`close-tie-own-${row.tournament_id}`} />
                : (
                  <button key={tie.rank} type="button" onClick={() => onDecide(tie)} className={`${BUTTON} tls-btn--secondary`}
                    data-testid={tie.kind === "zone" ? `close-decide-zone-${row.tournament_id}-${tie.rank}` : `close-decide-${row.tournament_id}`}>
                    {TIE_BLOCKERS[blocker.code].label}
                  </button>
                )))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CloseSheet({ row, superadmin, onClose, onDone }) {
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const override = Boolean(row.own_team) && superadmin;
  const submit = async (event) => {
    event.preventDefault();
    if (overrideMissing(override, conflictReason)) {
      toast.error("Bitte den Grund für die Notausnahme mit mindestens 5 Zeichen angeben.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/admin/leagues/staffeln/${row.tournament_id}/close`, { confirm: true, ...overridePayload(override, conflictReason) });
      toast.success("Staffel abgeschlossen. Der Endstand steht.");
      onDone();
    } catch (failure) {
      // Inzwischen kann etwas dazugekommen sein (ein Protest, ein zweiter Abschluss): Karte neu laden, die Checkliste sagt es.
      toast.error(errorOf(failure, "Abschließen hat nicht geklappt."));
      onDone();
    }
  };
  return (
    <AdminSheet title="Staffel abschließen" eyebrow={staffelLabel(row)} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel="Jetzt abschließen" savingLabel="Schließe ab …" submitTestId="close-confirm" testId="close-sheet">
      <div className="space-y-3 text-sm text-white/75">
        <p>Der Endstand wird festgehalten: Plätze, Punkte, Maps, Entscheide und der Regelstand von jetzt. Website, TV und PDF zeigen ab dann diesen Endstand.</p>
        <ul className="list-disc space-y-1 pl-5 text-white/65">
          <li>Ergebnisse und die Tabelle lassen sich danach nicht mehr ändern.</li>
          <li>Eine spätere Regeländerung ändert den Endstand nicht.</li>
          <li>Die Captains bekommen eine Nachricht.</li>
          <li>Korrigieren geht nur über „Wieder öffnen“ – das macht eine zweite Person, mit Grund.</li>
        </ul>
        {row.champion_place ? (
          <p className="flex items-center gap-2 rounded-sm border border-honor/40 bg-honor/5 px-3 py-2 text-white" data-testid="close-sheet-champion">
            <Crown className="h-4 w-4 shrink-0 text-honor" aria-hidden="true" /> Meister: <strong className="min-w-0 break-words">{row.champion?.display_name || "–"}</strong>
          </p>
        ) : <p className="text-white/55">In dieser Liga N gibt es keinen Meistertitel.</p>}
        {row.zones_label ? <p className="text-white/65" data-testid="close-sheet-zones">Auf- und Abstieg: {row.zones_label}. Er ergibt sich aus diesem Endstand und gilt für die nächste Season.</p> : null}
      </div>
      {override ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="close-conflict-reason" /></div> : null}
    </AdminSheet>
  );
}

function ReopenSheet({ row, superadmin, successor, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const needsEmergency = Boolean(row.closed_by_me) && superadmin;
  const needsConflict = Boolean(row.own_team) && superadmin;
  const submit = async (event) => {
    event.preventDefault();
    const problem = reopenProblem({ reason, needsEmergency, emergencyReason, needsConflict, conflictReason });
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/admin/leagues/staffeln/${row.tournament_id}/reopen`, {
        reason: reason.trim(), ...(needsEmergency ? { emergency_reason: emergencyReason.trim() } : {}), ...overridePayload(needsConflict, conflictReason) });
      toast.success("Staffel wieder geöffnet. Die alte Fassung bleibt im Verlauf.");
      onDone();
    } catch (failure) {
      toast.error(errorOf(failure, "Wieder öffnen hat nicht geklappt."));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Staffel wieder öffnen" eyebrow={staffelLabel(row)} onClose={onClose} onSubmit={submit} saving={saving} noValidate
      submitLabel="Wieder öffnen" savingLabel="Öffne …" submitTestId="reopen-confirm" testId="reopen-sheet">
      {/* Neue Season schon angelegt (F.2, Nr. 162): Sie folgt dem neuen Endstand nicht von selbst. */}
      {successor ? (
        <p className="mb-3 flex items-start gap-2 rounded-sm border border-warn/50 bg-warn/10 p-3 text-sm font-semibold text-white" role="note" data-testid="reopen-successor">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <span>Es gibt schon die neue Season {successor.name}. Nach dem neuen Abschluss die Übernahme dort neu berechnen.</span>
        </p>
      ) : null}
      {row.incomplete ? (
        <p className="text-sm text-white/75">
          Der Abschluss wurde nicht fertig geschrieben – die Staffel ist gesperrt, einen Endstand gibt es nicht. Wieder öffnen gibt sie frei, danach schließt du
          neu ab. Die Captains haben vom Abschluss nichts erfahren und bekommen keine Nachricht.
        </p>
      ) : (
        <p className="text-sm text-white/75">
          Die Tabelle wird wieder gerechnet, Ergebnisse lassen sich korrigieren. Fassung {row.final?.version} bleibt im Verlauf sichtbar, der Meister-Eintrag ruht,
          bis neu abgeschlossen ist. Die Captains bekommen eine Nachricht – ohne deinen Grund.
        </p>
      )}
      <div className="mt-4">
        <TextAreaField label="Grund" rows={3} value={reason} onChange={setReason} required placeholder="z. B. Ergebnis von Spieltag 5 war vertauscht eingetragen"
          hint="Pflicht. Steht im Verlauf und im Protokoll." testId="reopen-reason" />
      </div>
      {needsEmergency ? (
        <div className="mt-4 space-y-2 rounded-sm border border-warn/40 p-3">
          <p className="text-xs font-semibold text-white/80">Du hast diese Staffel selbst abgeschlossen. Wieder öffnen soll eine zweite Person.</p>
          <TextAreaField label="Grund für die Notausnahme" rows={2} value={emergencyReason} onChange={setEmergencyReason} required
            hint="Als Superadmin geht es trotzdem, mit mindestens fünf Zeichen. Der Grund steht im Protokoll." testId="reopen-emergency-reason" />
        </div>
      ) : null}
      {needsConflict ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="reopen-conflict-reason" /></div> : null}
    </AdminSheet>
  );
}

function VersionSheet({ row, entry, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/staffeln/${row.tournament_id}/final-tables/${entry.version}`)
      .then(({ data: body }) => alive && setData(body))
      .catch((failure) => alive && setError(errorOf(failure, "Die Fassung konnte nicht geladen werden.")));
    return () => { alive = false; };
  }, [row.tournament_id, entry.version]);
  return (
    <AdminSheet title={`Fassung ${entry.version}`} eyebrow={staffelLabel(row)} size="lg" onClose={onClose} cancelLabel="Schließen" testId="version-sheet">
      <p className="text-sm text-white/65">{historyLine(entry)}{entry.rules_label ? ` · Regelwerk ${entry.rules_label}` : ""}</p>
      {entry.reopened_at ? (
        <p className="mt-1 text-sm text-white/65">Wieder geöffnet am {finalMoment(entry.reopened_at)} von {entry.reopened_by_name}: „{entry.reopen_reason}“</p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-warn" role="alert">{error}</p> : null}
      {!data && !error ? <p className="mt-4 text-sm text-white/45" aria-busy="true">Lade Fassung …</p> : null}
      {data ? (
        <div className="mt-4 space-y-2">
          <Table rows={data.standings || []} rules={data.table_rules} championId={null} label={`Endstand Fassung ${entry.version}`} />
          {(data.decisions || []).map((decision) => <p key={decisionLine(decision)} className="text-xs text-white/60">Entscheid: {decisionLine(decision)}</p>)}
        </div>
      ) : null}
    </AdminSheet>
  );
}

function StaffelCard({ row, data, canResults, onSheet }) {
  const state = closeState(row);
  const label = staffelLabel(row);
  const championId = row.closed ? row.final?.champion?.registration_id : row.champion?.registration_id;
  return (
    <section className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3 sm:p-4" aria-label={label} data-testid={`close-staffel-${row.tournament_id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-lg font-black uppercase text-white">{label}</h3>
        <span className={`rounded-sm border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${CHIP[state.key]}`} data-testid={`close-state-${row.tournament_id}`}>{state.label}</span>
      </div>

      {row.closed ? (
        <div className="mt-3 space-y-1 text-sm text-white/75" data-testid={`close-final-${row.tournament_id}`}>
          <p className="flex items-start gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
            <span>Abgeschlossen am {finalMoment(row.final.closed_at)} von {row.final.closed_by_name} · Fassung {row.final.version}
              {row.final.rules_label ? ` · Regelwerk ${row.final.rules_label}` : ""}</span></p>
          {row.final.champion ? (
            <p className="flex items-center gap-2 text-white"><Crown className="h-4 w-4 shrink-0 text-honor" aria-hidden="true" /> Meister: <strong className="min-w-0 break-words">{row.final.champion.display_name}</strong></p>
          ) : null}
          {(row.final.decisions || []).map((decision) => <p key={decisionLine(decision)} className="text-xs text-white/60">Entscheid: {decisionLine(decision)}</p>)}
          {/* Belohnungen (F.4, #2214): mit dem Abschluss vergeben - Einzelheiten im Reiter „Belohnungen“. */}
          {row.rewards ? (
            <p className="flex items-center gap-2 text-xs text-white/70" data-testid={`close-rewards-${row.tournament_id}`}>
              <Gift className="h-3.5 w-3.5 shrink-0 text-[#29B6E8]" aria-hidden="true" />
              {row.rewards === 1 ? "1 Belohnung vergeben" : `${row.rewards} Belohnungen vergeben`} · <Link to="#belohnungen" className="text-[#29B6E8] hover:underline">Belohnungen</Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3">
          <Checklist row={row} canResults={canResults} superadmin={data.superadmin} onDecide={(tie) => onSheet({ kind: "decide", row, tie })} />
        </div>
      )}

      <div className="mt-4">
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">{row.closed ? "Endstand" : "Vorschau des Endstands"}</h4>
        {row.zones_label ? <p className="mb-2 text-xs text-white/55" data-testid={`close-zones-${row.tournament_id}`}>Auf- und Abstieg: {row.zones_label}</p> : null}
        <Table rows={row.standings || []} rules={row.table_rules} championId={championId} label={`${row.closed ? "Endstand" : "Vorschau"} ${label}`} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!row.closed && data.can_act && row.own_team && !data.superadmin ? <OwnTeamNote testId={`close-own-${row.tournament_id}`} /> : null}
        {!row.closed && !row.incomplete && data.can_act && !(row.own_team && !data.superadmin) ? (
          <button type="button" disabled={!row.can_close} onClick={() => onSheet({ kind: "close", row })} className={`${BUTTON} tls-btn--primary`} data-testid={`close-button-${row.tournament_id}`}>
            <Lock className="h-4 w-4" aria-hidden="true" /> Staffel abschließen
          </button>
        ) : null}
        {!row.closed && !row.incomplete && data.can_act && !row.can_close && row.blockers.length ? <span className="text-xs text-white/55">Geht, sobald die Punkte oben erledigt sind.</span> : null}
        {(row.closed || row.incomplete) && row.can_reopen ? (
          <button type="button" onClick={() => onSheet({ kind: "reopen", row })} className={`${BUTTON} tls-btn--secondary`} data-testid={`reopen-button-${row.tournament_id}`}>
            <LockOpen className="h-4 w-4" aria-hidden="true" /> Wieder öffnen
          </button>
        ) : null}
        {row.closed && data.can_act && !row.can_reopen ? (
          <p className="text-xs font-semibold text-white/80" data-testid={`reopen-note-${row.tournament_id}`}>
            {row.closed_by_me ? "Du hast abgeschlossen. Wieder öffnen muss eine zweite Person." : "Über dein eigenes Team entscheidet eine andere Person."}
          </p>
        ) : null}
        {!data.can_act ? <span className="text-xs text-white/55" data-testid={`close-readonly-${row.tournament_id}`}>Abschließen und wieder öffnen darf, wer {data.responsible} hat.</span> : null}
      </div>

      {row.history.length ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-white/50"><History className="h-3.5 w-3.5" aria-hidden="true" /> Verlauf</h4>
          <ul className="space-y-1.5" data-testid={`close-history-${row.tournament_id}`}>
            {row.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70">
                <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${entry.active ? "border-[#29B6E8]/50 text-[#29B6E8]" : "border-white/15 text-white/50"}`}>
                  {entry.active ? "Gilt" : "Ersetzt"}
                </span>
                <span className="text-white">{historyLine(entry)}</span>
                {entry.champion ? <span>Meister: {entry.champion}</span> : null}
                {entry.reopened_at ? <span className="min-w-0 break-words">wieder geöffnet von {entry.reopened_by_name}: „{entry.reopen_reason}“</span> : null}
                <button type="button" onClick={() => onSheet({ kind: "version", row, entry })} className="tls-btn tls-btn--quiet ml-auto min-h-11 rounded-sm px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
                  data-testid={`close-version-${row.tournament_id}-${entry.version}`}>Tabelle ansehen</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function SeasonCloseTab({ seasonId, canResults = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/closing`);
      setData(body);
      setError("");
    } catch (failure) {
      setError(errorOf(failure, "Der Abschluss konnte nicht geladen werden."));
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments", "matches"]);
  const done = () => {
    setSheet(null);
    load();
  };

  if (error && !data) return <p className="text-sm text-warn" role="alert">{error}</p>;
  if (!data) return <p className="text-sm text-white/45" aria-busy="true">Lade Abschluss …</p>;
  return (
    <FormSection title="Saisonabschluss" testId="season-close"
      hint="Abgeschlossen wird je Staffel. Der Abschluss hält den Endstand fest – eine spätere Regeländerung ändert ihn nicht mehr.">
      <p className="text-sm text-white/80" data-testid="season-close-summary">{seasonSummary(data)}</p>
      <div className="mt-4 space-y-4">
        {data.staffeln.map((row) => <StaffelCard key={row.tournament_id} row={row} data={data} canResults={canResults} onSheet={setSheet} />)}
      </div>
      <p className="mt-4 text-[11px] text-white/45">
        Auf- und Abstieg ergeben sich aus dem Endstand (Zonen je Liga im Reiter „Ligen und Staffeln“). Ist alles abgeschlossen, legt „Neue Season aus …“ oben die nächste Season an.
      </p>
      {sheet?.kind === "close" ? <CloseSheet row={sheet.row} superadmin={data.superadmin} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === "reopen" ? <ReopenSheet row={sheet.row} superadmin={data.superadmin} successor={data.successor} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === "version" ? <VersionSheet row={sheet.row} entry={sheet.entry} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "decide" ? (
        <OrderSheet staffel={{ tournament_id: sheet.row.tournament_id, label: staffelLabel(sheet.row) }} tie={sheet.tie} override={Boolean(sheet.tie.own_team)}
          methods={methodOptions(data.methods)} methodRequired onClose={() => setSheet(null)} onSaved={() => done()} />
      ) : null}
    </FormSection>
  );
}
