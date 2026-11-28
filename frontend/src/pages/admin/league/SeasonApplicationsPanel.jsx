// Eingang der Leitung (docs/LIGA.md, B.4, #2205): Anmeldungen der Season prüfen, annehmen, ablehnen mit Pflichtgrund, auf die Warteliste setzen und Liga N und Staffel zuteilen.
// Rückt jemand nach, entscheidet die Leitung, nichts geschieht von selbst. Der Weg „Co-Team zuteilen“ auf der Staffel-Seite bleibt als Sonderweg.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ApplicationStateBadge } from "@/components/tls/league/application/LeagueApplicationPanel";
import { stateLabel, untilText } from "@/lib/leagueStartRights";
import { carryLine } from "@/lib/leagueSuccessor";
import { APPLICATION_STATES, statsLine } from "@/lib/leagueApplications";
import { formatWhen } from "@/lib/datetime";
import { staffelAdminUrl } from "@/lib/staffelTabs";
import { GuestBadge } from "@/components/tls/league/GuestBadge";
import { GuestTeamControl } from "./GuestTeamControl";

const BUTTON = "inline-flex min-h-[40px] items-center rounded-sm px-3 py-1.5 tls-type-label disabled:opacity-50";
const REASON_MIN = 5;
const OWN_TEAM = "Über dein eigenes Team entscheidet eine andere Person.";
// Solo-Liga (#1629, P2): Anmeldungen von Spielern (``kind: "solo"``) - dieselben Knöpfe, die Sätze sprechen vom Spieler.
const OWN_ENTRY = "Über deine eigene Anmeldung entscheidet eine andere Person.";
const isPerson = (row) => row?.kind === "solo";
const OPEN_GROUPS = [
  { key: "open", title: "Neu und in Prüfung", statuses: ["submitted", "in_review"] },
  { key: "waitlist", title: "Warteliste", statuses: ["waitlist"] },
  { key: "accepted", title: "Angenommen", statuses: ["accepted"] },
];

function when(value) {
  return value ? formatWhen(value) : "";
}

const OTHER_DIVISION = " – andere Liga, nur mit Grund";
const HIGHER_DIVISION = " – höhere Liga, nur mit Grund";

export function staffelOptions(divisions = [], row = null) {
  // Zuerst die Staffeln der Liga N, in die das Co-Team gehört; die anderen nur mit Grund (der Server prüft es). Übernommen aus der
  // Vorgänger-Season (F.2, #1627): seine neue Liga N. Neu (#1623): die unterste Liga, wenn die Season es so einstellt
  // (``target_division_id`` vom Server, sonst leer).
  const label = (division, staffel) => `${division.label} · Staffel ${staffel.staffel} (${staffel.participant_count} von ${staffel.max_participants})`;
  const target = row?.carry_over?.division_id || row?.target_division_id;
  const suffix = row?.carry_over?.division_id ? OTHER_DIVISION : HIGHER_DIVISION;
  return divisions.flatMap((division) => (division.staffeln || []).map((staffel) => {
    const other = Boolean(target) && division.id !== target;
    return [staffel.tournament_id, `${label(division, staffel)}${other ? suffix : ""}`, other];
  })).sort((left, right) => Number(left[2]) - Number(right[2]));
}

function Notes({ row }) {
  return (
    <>
      {row.problems?.length ? (
        <ul className="mt-2 space-y-1 tls-type-small text-warn" data-testid={`application-problems-${row.id}`}>
          {row.problems.map((text) => <li key={text} className="flex gap-2 [overflow-wrap:anywhere]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>{text}</span></li>)}
        </ul>
      ) : null}
      {/* Offene Punkte (#2313): fehlende Angaben halten nichts auf - Zulassen geht, gesperrt wird beim Check-in. */}
      {row.warnings?.length || row.shortfall ? (
        <div className="mt-2 rounded-sm border border-white/10 bg-white/[0.03] p-2" data-testid={`application-open-points-${row.id}`}>
          <p className="tls-type-label text-white/70">
            Offene Punkte{row.warnings?.length ? ` · ${row.warnings.length} Spieler` : ""}
          </p>
          {row.shortfall ? <p className="mt-1 tls-type-small text-white/85 [overflow-wrap:anywhere]">{row.shortfall}</p> : null}
          {row.warnings?.length ? <ul className="mt-1 space-y-0.5 tls-type-small text-white/65">{row.warnings.map((text) => <li key={text} className="[overflow-wrap:anywhere]">{text}</li>)}</ul> : null}
          <p className="mt-1 tls-type-small text-white/50">{isPerson(row) ? "Zulassen geht trotzdem. Solange etwas offen ist, kann der Spieler nicht einchecken; er wird erinnert." : "Zulassen geht trotzdem. Wer etwas offen hat, kann nicht einchecken und nicht aufgestellt werden; das Team wird erinnert."}</p>
        </div>
      ) : null}
      {row.shared_with?.length ? <p className="mt-2 tls-type-small text-white/60 [overflow-wrap:anywhere]">Gleiche Spieler stehen auch im Antrag von: {row.shared_with.join(", ")}.</p> : null}
    </>
  );
}

// Befangenheit (#2245, Entscheidung Nr. 73): Über das eigene Team entscheidet eine zweite Person. Der Server prüft dieselbe Regel, hier nur die Anzeige.
function OwnTeamNote({ row }) {
  return <p className="tls-type-small font-semibold text-white/80" data-testid={`application-own-team-${row.id}`}>{isPerson(row) ? OWN_ENTRY : OWN_TEAM}</p>;
}

// Offene Anmeldungen (Entscheidung B, #1665): Nur hier steht das Kennzeichen „Gast“ - abgelehnt oder zurückgezogen gibt kein Recht daran.
const OPEN_STATUSES = ["submitted", "in_review", "waitlist", "accepted"];

/** Hat die Anmeldung noch Knöpfe der Entscheidung? Prüfen, annehmen, zuteilen oder eine automatische Zuteilung zurücknehmen. */
export function hasRowActions(row) {
  const unassigned = row.status === "accepted" && !row.assignment;
  const autoSeated = row.status === "accepted" && Boolean(row.assignment?.auto) && !row.assignment?.left;
  return ["submitted", "in_review", "waitlist"].includes(row.status) || unassigned || autoSeated;
}

function RowActions({ row, options, busy, act, superadmin, conflictReason = "", setConflictReason = () => {} }) {
  const [staffel, setStaffel] = useState("");
  // Welcher Grund gerade offen ist: Ablehnen, oder Warteliste bei einer automatisch angenommenen Anmeldung (#2348).
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState("");
  const [deviation, setDeviation] = useState("");
  const unassigned = row.status === "accepted" && !row.assignment;
  // Eine automatische Zuteilung (#2348) nehmen Ablehnen und Warteliste wieder aus der Staffel; jede andere bleibt der Teilnehmerliste.
  const autoSeated = row.status === "accepted" && Boolean(row.assignment?.auto) && !row.assignment?.left;
  const deciding = ["submitted", "in_review", "waitlist"].includes(row.status);
  if (!hasRowActions(row)) return null;
  if (row.own_team && !superadmin) return <div className="mt-3"><OwnTeamNote row={row} /></div>;
  // Nur der Superadmin darf beim eigenen Team, als Notausnahme: Jeder Knopf schickt den Grund mit und geht erst mit fünf Zeichen.
  const override = row.own_team ? conflictReason.trim() : "";
  const blocked = busy || (row.own_team && override.length < REASON_MIN);
  const send = (action, body) => act(row, action, override ? { ...body, conflict_reason: override } : body);
  // Angenommen (automatisch oder von Hand): Zurückstufen nur mit Grund, das Team liest ihn wie beim Ablehnen (#2348).
  const waitlistWithReason = row.status === "accepted";
  const otherDivision = Boolean(options.find(([value]) => value === staffel)?.[2]);
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
        <p className="tls-type-small text-white/55" data-testid={`application-auto-seat-${row.id}`}>Ablehnen oder Warteliste nehmen {isPerson(row) ? "den Spieler" : "das Co-Team"} wieder aus der Staffel, solange der Spielplan nicht steht.</p>
      ) : options.length ? (
        <SelectField label={unassigned ? "Staffel" : "Staffel (geht auch später)"} value={staffel} onChange={setStaffel} testId={`application-staffel-${row.id}`} className="max-w-md"
          options={[["", "Staffel wählen …"], ...options.map(([value, text]) => [value, text])]} />
      ) : <p className="tls-type-small text-white/55">Noch keine Staffel angelegt. Annehmen geht, zuteilen später.</p>}
      {otherDivision ? (
        <TextField label="Grund für die andere Liga" required value={deviation} onChange={setDeviation} maxLength={500} className="max-w-md"
          hint={row.carry_over ? "Das Co-Team ist in eine andere Liga übernommen. Der Grund steht im Verlauf und im Protokoll."
            : isPerson(row) ? "Neue Spieler starten in der untersten Liga. Der Grund steht im Verlauf und im Protokoll."
              : "Neue Co-Teams starten in der untersten Liga. Der Grund steht im Verlauf und im Protokoll."} testId={`application-deviation-${row.id}`} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {deciding ? (
          <button type="button" disabled={blocked || (otherDivision && deviation.trim().length < REASON_MIN)}
            onClick={() => send("accept", staffel ? { tournament_id: staffel, ...(otherDivision ? { deviation_reason: deviation.trim() } : {}) } : {})}
            className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid={`application-accept-${row.id}`}>Annehmen</button>
        ) : unassigned ? (
          <button type="button" disabled={blocked || !staffel || (otherDivision && deviation.trim().length < REASON_MIN)}
            onClick={() => send("assign", { tournament_id: staffel, ...(otherDivision ? { deviation_reason: deviation.trim() } : {}) })}
            className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid={`application-assign-${row.id}`}>Zuteilen</button>
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
          <TextAreaField label={isPerson(row) ? "Grund (Pflicht, der Spieler liest ihn)" : "Grund (Pflicht, das Team liest ihn)"} rows={2} value={reason} onChange={setReason} testId={`application-reason-${row.id}`} />
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

function ApplicationRow({ row, options, busy, act, superadmin, seasonId = null, reload = null, seasonClosed = false }) {
  // Ein Grund für die Notausnahme je Anmeldung (#1665): Er gilt für die Entscheidung und fürs Kennzeichen - ein Feld, nicht zwei.
  const [conflictReason, setConflictReason] = useState("");
  // Beendete oder archivierte Season: kein Recht mehr am Kennzeichen (Entscheidung B) - der Kasten fällt weg, statt mit 403 zu antworten.
  // Auch der Bereich Ligen setzt es dann über eine laufende Season des Teams.
  const guestControl = Boolean(seasonId) && !seasonClosed && OPEN_STATUSES.includes(row.status) && !isPerson(row);
  return (
    <li className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`application-${row.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</span>
        <ApplicationStateBadge state={row.status} />
        {row.guest_badge ? <GuestBadge badge={row.guest_badge} testId={`application-guest-mark-${row.id}`} /> : null}
      </div>
      {/* Gastteam (#1665): Angabe der Teamleitung und Kennzeichen - nur bei offenen Anmeldungen zum Bestätigen. */}
      {guestControl ? (
        <GuestTeamControl row={row} seasonId={seasonId} superadmin={superadmin} onChanged={reload} conflictReason={conflictReason}
          onConflictReason={hasRowActions(row) ? null : setConflictReason} />
      ) : null}
      {row.carry_over ? (
        <p className="mt-1 tls-type-small text-white/85 [overflow-wrap:anywhere]" data-testid={`application-carry-${row.id}`}>{carryLine(row.carry_over)}</p>
      ) : null}
      {/* Startrecht (#1627, F.2a): Zugeteilt wird erst nach der Zusage - der Stand steht hier, die Übersicht unter „Startrechte“. */}
      {row.carry_over?.start_right && row.status === "accepted" && !row.assignment ? (
        <p className={`mt-1 tls-type-small font-semibold ${row.carry_over.start_right.state === "offered" ? "text-warn" : "text-white/70"}`} data-testid={`application-start-right-${row.id}`}>
          Startrecht: {stateLabel(row.carry_over.start_right.state)}
          {row.carry_over.start_right.state === "offered" ? ` bis ${untilText(row.carry_over.start_right.accept_until)} – zuteilen geht nach der Zusage` : ""}
        </p>
      ) : null}
      <p className="mt-1 tls-type-small text-white/60 [overflow-wrap:anywhere]">
        {isPerson(row) ? `Eingereicht ${when(row.submitted_at)} · meldet sich selbst als Spieler an`
          : <>{row.carry_over ? "Übernommen" : "Eingereicht"} {when(row.submitted_at)} {row.carry_over ? "" : `von ${row.applied_by_name} `}· {row.member_count} Spieler · Captain {row.captain_name || "fehlt"}{row.vice_name ? ` · Vertreter ${row.vice_name}` : ""}</>}
      </p>
      <p className="tls-type-small text-white/60">
        {row.carry_over && !row.rules_version ? "Zustimmung zum Regelwerk folgt vor dem ersten Spiel (Captain im Regelwerk)"
          : row.rules_version ? `Regeln Version ${row.rules_version} zugestimmt ${when(row.rules_at)}` : "Keine Zustimmung zu den Regeln"}
        {row.carry_over ? "" : ` · ${row.privacy_at ? "Datenschutz zugestimmt" : "Keine Zustimmung zum Datenschutz"}`}
      </p>
      {row.assignment ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 tls-type-small text-white/85">
          {row.assignment.label}{row.assignment.left ? " (nicht mehr dabei, der Platz ist frei)" : ""}
          {/* Paket D (#2262): auf die Teilnehmer der Staffel-Seite - nicht mehr in die Turnierverwaltung. */}
          <Link to={staffelAdminUrl(row.assignment.tournament_id, "teilnehmer")} data-testid={`application-open-staffel-${row.id}`} className="inline-flex min-h-[44px] items-center gap-1 tls-type-small font-bold text-[#29B6E8] hover:text-white">Staffel öffnen <ArrowRight className="h-3 w-3" aria-hidden="true" /></Link>
        </p>
      ) : null}
      {row.auto_accepted ? <p className="mt-1 tls-type-small text-white/60" data-testid={`application-auto-${row.id}`}>Automatisch angenommen{row.decided_at ? ` ${when(row.decided_at)}` : ""}.</p> : null}
      {/* Warum die Season nicht annehmen bzw. zuteilen konnte (#2348): Staffel voll oder gesperrt, Geschwister-Co-Team, Fehler. */}
      {row.auto_problem ? (
        <p className="mt-1 tls-type-small text-warn [overflow-wrap:anywhere]" data-testid={`application-auto-problem-${row.id}`}>
          {row.status === "accepted" ? "Nicht automatisch zugeteilt" : "Nicht automatisch angenommen"}: {row.auto_problem}
        </p>
      ) : null}
      {/* Befangenheit (#2348, Nr. 73): Beim Team einer Person der Liga-Leitung hat niemand entschieden - die anderen Zuständigen sehen es. */}
      {row.lead_team_auto ? (
        <p className="mt-1 flex items-center gap-1.5 tls-type-small font-semibold text-warn" data-testid={`application-lead-team-${row.id}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Team der Leitung – automatisch angenommen
        </p>
      ) : null}
      {row.decision_reason ? <p className="mt-1 tls-type-small text-white/75 [overflow-wrap:anywhere]">Grund: {row.decision_reason}{row.decided_by_name ? ` (${row.decided_by_name})` : ""}</p> : null}
      <Notes row={row} />
      <RowActions row={row} options={options} busy={busy} act={act} superadmin={superadmin} conflictReason={conflictReason} setConflictReason={setConflictReason} />
      {row.history?.length > 1 ? (
        <details className="mt-2 tls-type-small text-white/55">
          <summary className="cursor-pointer">Verlauf</summary>
          <ul className="mt-1 space-y-0.5">{row.history.map((step, index) => <li key={index} className="[overflow-wrap:anywhere]">{historyLine(step)}</li>)}</ul>
        </details>
      ) : null}
    </li>
  );
}

// ``version``: ändert sich mit den Einstellungen der Season. Wer das Fenster gerade gesetzt hat, sieht den Eingang gleich.
const CLOSED_SEASONS = ["completed", "archived"];

// ``seasonStatus``: der Stand der Season - beendet oder archiviert, gibt es dort kein Kennzeichen „Gast“ mehr zu setzen.
export function SeasonApplicationsPanel({ seasonId, version, seasonStatus = null }) {
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
      toast.success(isPerson(row) ? "Gespeichert. Der Spieler bekommt eine Nachricht." : "Gespeichert. Das Team bekommt eine Nachricht.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    await load();
    setBusy(false);
  };

  if (!visible) return null;
  const options = (row) => staffelOptions(data.divisions, row);
  const items = data.items || [];
  const closed = items.filter((row) => ["rejected", "withdrawn"].includes(row.status));
  return (
    <div id="anmeldungen" className="scroll-mt-24">
      <FormSection title="Anmeldungen" testId="season-applications" hint={data.kind === "solo"
        ? "Was Spieler eingereicht haben. Annehmen und Zuteilen prüfen sie noch einmal. Wird ein Platz frei, entscheidest du, wer nachrückt."
        : "Was Captains und Vertreter eingereicht haben. Annehmen und Zuteilen prüfen den Kader noch einmal. Wird ein Platz frei, entscheidest du, wer nachrückt."}>
        <p className="tls-type-small text-white/80" data-testid="season-applications-stats">{statsLine(data.stats)}</p>
        {!items.length ? <p className="tls-type-small text-white/55">Noch keine Anmeldung.</p> : null}
        {OPEN_GROUPS.map((group) => {
          const rows = items.filter((row) => group.statuses.includes(row.status));
          if (!rows.length) return null;
          return (
            <div key={group.key} className="space-y-2">
              <h3 className="tls-type-label text-white/60">{group.title} ({rows.length})</h3>
              <ul className="space-y-2">{rows.map((row) => (
                <ApplicationRow key={row.id} row={row} options={options(row)} busy={busy} act={act} superadmin={Boolean(data.superadmin)} seasonId={seasonId} reload={load}
                  seasonClosed={CLOSED_SEASONS.includes(seasonStatus)} />
              ))}</ul>
            </div>
          );
        })}
        {closed.length ? (
          <details data-testid="season-applications-closed">
            <summary className="cursor-pointer tls-type-label text-white/60">Abgeschlossen ({closed.length})</summary>
            <ul className="mt-2 space-y-2">{closed.map((row) => <ApplicationRow key={row.id} row={row} options={options(row)} busy={busy} act={act} />)}</ul>
          </details>
        ) : null}
      </FormSection>
    </div>
  );
}
