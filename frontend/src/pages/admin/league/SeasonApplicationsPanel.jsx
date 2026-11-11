// Eingang der Leitung (docs/LIGA.md, B.4, #2205): Anmeldungen der Season prüfen, annehmen, ablehnen mit Pflichtgrund, auf die Warteliste setzen und Liga N und Staffel zuteilen.
// Rückt jemand nach, entscheidet die Leitung, nichts geschieht von selbst. Der Weg „Co-Team zuteilen“ in der Turnierverwaltung bleibt als Sonderweg.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ApplicationStateBadge } from "@/components/tls/league/application/LeagueApplicationPanel";
import { APPLICATION_STATES, statsLine } from "@/lib/leagueApplications";
import { viennaDateTime } from "@/lib/vienna";

const WHEN = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const BUTTON = "inline-flex min-h-[40px] items-center rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";
const REASON_MIN = 5;
const OWN_TEAM = "Über dein eigenes Team entscheidet eine andere Person.";
const OPEN_GROUPS = [
  { key: "open", title: "Neu und in Prüfung", statuses: ["submitted", "in_review"] },
  { key: "waitlist", title: "Warteliste", statuses: ["waitlist"] },
  { key: "accepted", title: "Angenommen", statuses: ["accepted"] },
];

function when(value) {
  return value ? viennaDateTime(value, WHEN) : "";
}

function staffelOptions(divisions = []) {
  return divisions.flatMap((division) => (division.staffeln || []).map((staffel) => [
    staffel.tournament_id, `${division.label} · Staffel ${staffel.staffel} (${staffel.participant_count} von ${staffel.max_participants})`]));
}

function Notes({ row }) {
  return (
    <>
      {row.problems?.length ? (
        <ul className="mt-2 space-y-1 text-sm text-warn" data-testid={`application-problems-${row.id}`}>
          {row.problems.map((text) => <li key={text} className="flex gap-2 [overflow-wrap:anywhere]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>{text}</span></li>)}
        </ul>
      ) : null}
      {/* Offene Punkte (#2313): fehlende Angaben halten nichts auf - Zulassen geht, gesperrt wird beim Check-in. */}
      {row.warnings?.length || row.shortfall ? (
        <div className="mt-2 rounded-sm border border-white/10 bg-white/[0.03] p-2" data-testid={`application-open-points-${row.id}`}>
          <p className="text-xs font-bold uppercase tracking-wider text-white/70">
            Offene Punkte{row.warnings?.length ? ` · ${row.warnings.length} Spieler` : ""}
          </p>
          {row.shortfall ? <p className="mt-1 text-sm text-white/85 [overflow-wrap:anywhere]">{row.shortfall}</p> : null}
          {row.warnings?.length ? <ul className="mt-1 space-y-0.5 text-xs text-white/65">{row.warnings.map((text) => <li key={text} className="[overflow-wrap:anywhere]">{text}</li>)}</ul> : null}
          <p className="mt-1 text-xs text-white/50">Zulassen geht trotzdem. Wer etwas offen hat, kann nicht einchecken und nicht aufgestellt werden; das Team wird erinnert.</p>
        </div>
      ) : null}
      {row.shared_with?.length ? <p className="mt-2 text-xs text-white/60 [overflow-wrap:anywhere]">Gleiche Spieler stehen auch im Antrag von: {row.shared_with.join(", ")}.</p> : null}
    </>
  );
}

// Befangenheit (#2245, Entscheidung Nr. 73): Über das eigene Team entscheidet eine zweite Person. Der Server prüft dieselbe Regel, hier nur die Anzeige.
function OwnTeamNote({ row }) {
  return <p className="text-sm font-semibold text-white/80" data-testid={`application-own-team-${row.id}`}>{OWN_TEAM}</p>;
}

function RowActions({ row, options, busy, act, superadmin }) {
  const [staffel, setStaffel] = useState("");
  // Welcher Grund gerade offen ist: Ablehnen, oder Warteliste bei einer automatisch angenommenen Anmeldung (#2348).
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const unassigned = row.status === "accepted" && !row.assignment;
  // Eine automatische Zuteilung (#2348) nehmen Ablehnen und Warteliste wieder aus der Staffel; jede andere bleibt der Teilnehmerliste.
  const autoSeated = row.status === "accepted" && Boolean(row.assignment?.auto) && !row.assignment?.left;
  const deciding = ["submitted", "in_review", "waitlist"].includes(row.status);
  if (!deciding && !unassigned && !autoSeated) return null;
  if (row.own_team && !superadmin) return <div className="mt-3"><OwnTeamNote row={row} /></div>;
  // Nur der Superadmin darf beim eigenen Team, als Notausnahme: Jeder Knopf schickt den Grund mit und geht erst mit fünf Zeichen.
  const override = row.own_team ? conflictReason.trim() : "";
  const blocked = busy || (row.own_team && override.length < REASON_MIN);
  const send = (action, body) => act(row, action, override ? { ...body, conflict_reason: override } : body);
  // Angenommen (automatisch oder von Hand): Zurückstufen nur mit Grund, das Team liest ihn wie beim Ablehnen (#2348).
  const waitlistWithReason = row.status === "accepted";
  const toggle = (next) => setMode((current) => (current === next ? null : next));
  return (
    <div className="mt-3 space-y-3">
      {row.own_team ? (
        <div className="max-w-xl space-y-2 rounded-sm border border-warn/40 p-3">
          <OwnTeamNote row={row} />
          <TextField label="Grund für die Notausnahme" required value={conflictReason} onChange={setConflictReason} maxLength={500} testId={`application-conflict-reason-${row.id}`}
            hint="Als Superadmin geht es trotzdem, mit mindestens fünf Zeichen. Der Grund steht im Verlauf und im Protokoll." />
        </div>
      ) : null}
      {autoSeated ? (
        <p className="text-xs text-white/55" data-testid={`application-auto-seat-${row.id}`}>Ablehnen oder Warteliste nehmen das Co-Team wieder aus der Staffel, solange der Spielplan nicht steht.</p>
      ) : options.length ? (
        <SelectField label={unassigned ? "Staffel" : "Staffel (geht auch später)"} value={staffel} onChange={setStaffel} testId={`application-staffel-${row.id}`} className="max-w-md"
          options={[["", "Staffel wählen …"], ...options]} />
      ) : <p className="text-xs text-white/55">Noch keine Staffel angelegt. Annehmen geht, zuteilen später.</p>}
      <div className="flex flex-wrap gap-2">
        {deciding ? (
          <button type="button" disabled={blocked} onClick={() => send("accept", staffel ? { tournament_id: staffel } : {})} className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid={`application-accept-${row.id}`}>Annehmen</button>
        ) : unassigned ? (
          <button type="button" disabled={blocked || !staffel} onClick={() => send("assign", { tournament_id: staffel })} className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid={`application-assign-${row.id}`}>Zuteilen</button>
        ) : null}
        {row.status === "submitted" ? <button type="button" disabled={blocked} onClick={() => send("review", {})} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid={`application-review-${row.id}`}>In Prüfung nehmen</button> : null}
        {row.status !== "waitlist" && waitlistWithReason ? (
          <button type="button" disabled={busy} onClick={() => toggle("waitlist")} aria-expanded={mode === "waitlist"} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid={`application-waitlist-open-${row.id}`}>Warteliste</button>
        ) : null}
        {row.status !== "waitlist" && !waitlistWithReason ? <button type="button" disabled={blocked} onClick={() => send("waitlist", {})} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid={`application-waitlist-${row.id}`}>Warteliste</button> : null}
        <button type="button" disabled={busy} onClick={() => toggle("reject")} aria-expanded={mode === "reject"} className={`tls-btn tls-btn--danger ${BUTTON}`} data-testid={`application-reject-open-${row.id}`}>Ablehnen</button>
      </div>
      {mode ? (
        <div className="max-w-xl space-y-2">
          <TextAreaField label="Grund (Pflicht, das Team liest ihn)" rows={2} value={reason} onChange={setReason} testId={`application-reason-${row.id}`} />
          {mode === "reject" ? (
            <button type="button" disabled={blocked || reason.trim().length < REASON_MIN} onClick={() => send("reject", { reason: reason.trim() })} className={`tls-btn tls-btn--danger ${BUTTON}`} data-testid={`application-reject-send-${row.id}`}>Ablehnung senden</button>
          ) : (
            <button type="button" disabled={blocked || reason.trim().length < REASON_MIN} onClick={() => send("waitlist", { reason: reason.trim() })} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid={`application-waitlist-send-${row.id}`}>Auf die Warteliste</button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function historyLine(step) {
  return `${when(step.at)}: ${APPLICATION_STATES[step.status]?.label || step.status}, ${step.by_name}${step.reason ? `, ${step.reason}` : ""}${step.conflict_reason ? ` (Notausnahme: ${step.conflict_reason})` : ""}`;
}

function ApplicationRow({ row, options, busy, act, superadmin }) {
  return (
    <li className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`application-${row.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</span>
        <ApplicationStateBadge state={row.status} />
      </div>
      <p className="mt-1 text-xs text-white/60 [overflow-wrap:anywhere]">
        Eingereicht {when(row.submitted_at)} von {row.applied_by_name} · {row.member_count} Spieler · Captain {row.captain_name || "fehlt"}{row.vice_name ? ` · Vertreter ${row.vice_name}` : ""}
      </p>
      <p className="text-xs text-white/60">
        {row.rules_version ? `Regeln Version ${row.rules_version} zugestimmt ${when(row.rules_at)}` : "Keine Zustimmung zu den Regeln"} · {row.privacy_at ? "Datenschutz zugestimmt" : "Keine Zustimmung zum Datenschutz"}
      </p>
      {row.assignment ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/85">
          {row.assignment.label}{row.assignment.left ? " (nicht mehr dabei, der Platz ist frei)" : ""}
          <Link to={`/admin/tournaments/${row.assignment.tournament_id}`} data-testid={`application-open-staffel-${row.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-[#29B6E8] hover:text-white">Turnierverwaltung <ExternalLink className="h-3 w-3" aria-hidden="true" /></Link>
        </p>
      ) : null}
      {row.auto_accepted ? <p className="mt-1 text-xs text-white/60" data-testid={`application-auto-${row.id}`}>Automatisch angenommen{row.decided_at ? ` ${when(row.decided_at)}` : ""}.</p> : null}
      {/* Warum die Season nicht annehmen bzw. zuteilen konnte (#2348): Staffel voll oder gesperrt, Geschwister-Co-Team, Fehler. */}
      {row.auto_problem ? (
        <p className="mt-1 text-xs text-warn [overflow-wrap:anywhere]" data-testid={`application-auto-problem-${row.id}`}>
          {row.status === "accepted" ? "Nicht automatisch zugeteilt" : "Nicht automatisch angenommen"}: {row.auto_problem}
        </p>
      ) : null}
      {/* Befangenheit (#2348, Nr. 73): Beim Team einer Person der Liga-Leitung hat niemand entschieden - die anderen Zuständigen sehen es. */}
      {row.lead_team_auto ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-warn" data-testid={`application-lead-team-${row.id}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Team der Leitung – automatisch angenommen
        </p>
      ) : null}
      {row.decision_reason ? <p className="mt-1 text-sm text-white/75 [overflow-wrap:anywhere]">Grund: {row.decision_reason}{row.decided_by_name ? ` (${row.decided_by_name})` : ""}</p> : null}
      <Notes row={row} />
      <RowActions row={row} options={options} busy={busy} act={act} superadmin={superadmin} />
      {row.history?.length > 1 ? (
        <details className="mt-2 text-xs text-white/55">
          <summary className="cursor-pointer">Verlauf</summary>
          <ul className="mt-1 space-y-0.5">{row.history.map((step, index) => <li key={index} className="[overflow-wrap:anywhere]">{historyLine(step)}</li>)}</ul>
        </details>
      ) : null}
    </li>
  );
}

// ``version``: ändert sich mit den Einstellungen der Season. Wer das Fenster gerade gesetzt hat, sieht den Eingang gleich.
export function SeasonApplicationsPanel({ seasonId, version }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const scrolled = useRef(false);
  const url = `/admin/leagues/seasons/${seasonId}/applications`;

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(url);
      setData(body);
    } catch {
      setData(null);
    }
  }, [url]);
  useEffect(() => { load(); }, [load, version]);
  useApiInvalidation(load, ["leagues"]);

  const visible = Boolean(data && (data.configured || data.items?.length));
  // Der Link aus der Nachricht zeigt auf #anmeldungen: Das Ziel entsteht erst, wenn die Daten da sind.
  useEffect(() => {
    if (!visible || scrolled.current || window.location.hash !== "#anmeldungen") return;
    scrolled.current = true;
    document.getElementById("anmeldungen")?.scrollIntoView?.();
  }, [visible]);

  const act = async (row, action, body) => {
    setBusy(true);
    try {
      await api.post(`${url}/${row.id}/${action}`, body);
      toast.success("Gespeichert. Das Team bekommt eine Nachricht.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    await load();
    setBusy(false);
  };

  if (!visible) return null;
  const options = staffelOptions(data.divisions);
  const items = data.items || [];
  const closed = items.filter((row) => ["rejected", "withdrawn"].includes(row.status));
  return (
    <div id="anmeldungen" className="scroll-mt-24">
      <FormSection title="Anmeldungen" testId="season-applications" hint="Was Captains und Vertreter eingereicht haben. Annehmen und Zuteilen prüfen den Kader noch einmal. Wird ein Platz frei, entscheidest du, wer nachrückt.">
        <p className="text-sm text-white/80" data-testid="season-applications-stats">{statsLine(data.stats)}</p>
        {!items.length ? <p className="text-sm text-white/55">Noch keine Anmeldung.</p> : null}
        {OPEN_GROUPS.map((group) => {
          const rows = items.filter((row) => group.statuses.includes(row.status));
          if (!rows.length) return null;
          return (
            <div key={group.key} className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/60">{group.title} ({rows.length})</h3>
              <ul className="space-y-2">{rows.map((row) => <ApplicationRow key={row.id} row={row} options={options} busy={busy} act={act} superadmin={Boolean(data.superadmin)} />)}</ul>
            </div>
          );
        })}
        {closed.length ? (
          <details data-testid="season-applications-closed">
            <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-white/60">Abgeschlossen ({closed.length})</summary>
            <ul className="mt-2 space-y-2">{closed.map((row) => <ApplicationRow key={row.id} row={row} options={options} busy={busy} act={act} />)}</ul>
          </details>
        ) : null}
      </FormSection>
    </div>
  );
}
