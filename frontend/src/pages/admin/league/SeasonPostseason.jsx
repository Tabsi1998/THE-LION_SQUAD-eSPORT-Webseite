// Playoffs und Relegation im Reiter „Abschluss“ (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“): die Einstellungen der Season
// und je Liga, die Vorschau der Setzung aus dem Endstand, die Paarungen mit Freilosen, die Wochen, „Anlegen“ mit Bestätigung, der Stand
// der angelegten Staffel und alles, was dem Anlegen noch entgegensteht. Was geht, sagt der Server - die Karte erklärt es statt eines
// toten Knopfs. Gelost wird erst beim Anlegen, nie in der Vorschau.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleAlert, GitBranch, Plus, Settings2, Shuffle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ConflictReasonField, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatApiError } from "@/lib/api";
import {
  REASON_MIN, championLine, divisionBody, formOf, formProblem, fullDay, lotLine, pairingLine, partState, playoffLine, relegationLine, roundLine,
  seasonBody, seedOrigin, tieText, weekRange,
} from "@/lib/leaguePostseason";

const BUTTON = "tls-btn inline-flex min-h-11 items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const CHIP = {
  closed: "border-[#29B6E8]/50 text-[#29B6E8]",
  running: "border-[#29B6E8]/50 text-[#29B6E8]",
  ready: "border-ok/50 text-ok",
  blocked: "border-warn/50 text-warn",
};
const HEAD = "text-[11px] font-bold uppercase tracking-[0.2em] text-white/50";

function errorOf(failure, fallback) {
  return formatApiError(failure.response?.data?.detail) || fallback;
}

function Chip({ part, testId }) {
  const state = partState(part);
  return <span className={`shrink-0 rounded-sm border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${CHIP[state.key]}`} data-testid={testId}>{state.label}</span>;
}

/** Was dem Anlegen noch entgegensteht - jeder Grund in einem Satz. */
function Blockers({ part, testId }) {
  if (!part.blockers?.length) return null;
  return (
    <ul className="space-y-2" aria-label="Was noch fehlt" data-testid={testId}>
      {part.blockers.map((blocker) => (
        <li key={blocker.code} className="rounded-sm border border-warn/30 bg-warn/5 p-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-white">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> <span>{blocker.label}</span>
          </p>
          <p className="mt-1 text-xs text-white/65">{blocker.text}</p>
        </li>
      ))}
    </ul>
  );
}

function StaffelLinks({ staffel, kind }) {
  if (!staffel) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid={`postseason-staffel-${staffel.tournament_id}`}>
      <span className="text-white/75">
        {staffel.matches.decided} von {staffel.matches.total} {staffel.matches.total === 1 ? "Spiel" : "Spielen"} entschieden
        {staffel.closed ? " · Endstand steht" : ""}
      </span>
      <Link to={`/admin/leagues/staffeln/${staffel.tournament_id}`} className="inline-flex min-h-11 items-center text-[#29B6E8] hover:underline">Staffel verwalten</Link>
      {staffel.slug ? (
        <Link to={`/tournaments/${staffel.slug}/bracket`} className="inline-flex min-h-11 items-center gap-1 text-[#29B6E8] hover:underline">
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> {kind === "relegation" ? "Paarungen ansehen" : "Baum ansehen"}
        </Link>
      ) : null}
    </p>
  );
}

function SeedList({ seeds, testId }) {
  if (!seeds?.length) return null;
  // Warum eine Staffel vor der nächsten steht, gilt für alle ihre Teams - es steht einmal da, beim ersten Team der Staffel.
  const first = new Map();
  for (const row of seeds) if (!first.has(row.staffel)) first.set(row.staffel, row.seed);
  return (
    <ol className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#121212]" data-testid={testId}>
      {seeds.map((row) => (
        <li key={row.seed} className="flex items-center gap-3 px-3 py-2">
          <span className="w-6 shrink-0 text-right font-display text-base font-bold tabular-nums text-white">{row.seed}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</span>
            <span className="block text-xs text-white/60">{[seedOrigin(row), first.get(row.staffel) === row.seed ? tieText(row) : ""].filter(Boolean).join(" · ")}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Eine Seite einer Paarung der ersten Runde: Setzplatz und Team - oder das Freilos. */
function PairSide({ entry }) {
  if (!entry) return <p className="px-3 py-2 text-sm text-white/45">Freilos</p>;
  return (
    <p className="flex items-center gap-2 px-3 py-2 text-sm">
      <span className="w-5 shrink-0 text-right font-display font-bold tabular-nums text-white/60">{entry.seed}</span>
      <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{entry.display_name}</span>
    </p>
  );
}

function Note({ children, testId }) {
  return (
    <p className="flex items-start gap-2 rounded-sm border border-warn/40 bg-warn/5 p-3 text-sm text-white" role="note" data-testid={testId}>
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> <span>{children}</span>
    </p>
  );
}

function Playoffs({ row, data, onSheet }) {
  const part = row.playoffs;
  const id = row.division_id;
  const lot = lotLine(part.open_lot);
  const blockedByTeam = part.own_team && !data.superadmin;
  return (
    <div className="space-y-3" data-testid={`postseason-playoffs-${id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className={HEAD}>Playoffs</h4>
        <Chip part={part} testId={`postseason-playoffs-state-${id}`} />
      </div>
      <p className="text-xs text-white/60" data-testid={`postseason-playoffs-line-${id}`}>{playoffLine(row.settings)}</p>
      {part.too_few_hint ? <Note testId={`postseason-too-few-${id}`}>{part.too_few_hint}</Note> : null}
      {!part.staffel ? <Blockers part={part} testId={`postseason-playoffs-blockers-${id}`} /> : null}
      <StaffelLinks staffel={part.staffel} kind="playoff" />
      {part.stale ? (
        <p className="flex items-start gap-2 rounded-sm border border-warn/40 bg-warn/5 p-3 text-sm text-white" role="note" data-testid={`postseason-stale-${id}`}>
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> <span>{part.stale_note}</span>
        </p>
      ) : null}
      {part.seeds.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h5 className={HEAD}>{part.staffel ? "Setzliste" : "Vorschau der Setzliste"}</h5>
            <SeedList seeds={part.seeds} testId={`postseason-seeds-${id}`} />
            {lot ? <p className="flex items-start gap-2 text-xs text-white/70" data-testid={`postseason-lot-${id}`}><Shuffle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#29B6E8]" aria-hidden="true" /> <span>{lot}</span></p> : null}
          </div>
          <div className="space-y-2">
            <h5 className={HEAD}>Erste Runde</h5>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" data-testid={`postseason-pairings-${id}`}>
              {part.pairings.map((pair) => (
                <li key={pair.order} className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#121212]" aria-label={pairingLine(pair)}
                  data-testid={`postseason-pairing-${id}-${pair.order}`}>
                  <PairSide entry={pair.a} />
                  <PairSide entry={pair.b} />
                </li>
              ))}
            </ul>
            {part.byes ? <p className="text-xs text-white/60">{part.byes === 1 ? "Ein Freilos" : `${part.byes} Freilose`} für die Bestgesetzten.</p> : null}
            {lot && !part.staffel ? <p className="text-xs text-white/60">Die Paarungen stehen nach dem Los fest.</p> : null}
          </div>
        </div>
      ) : null}
      {part.rounds.length ? (
        <div className="space-y-1">
          <h5 className={HEAD}>{part.estimated ? "Wochen (voraussichtlich)" : "Wochen"}</h5>
          <ul className="space-y-1 text-sm text-white/75" data-testid={`postseason-rounds-${id}`}>
            {part.rounds.map((round) => <li key={round.round}>{roundLine(round)}</li>)}
          </ul>
        </div>
      ) : null}
      {[...(part.veto_notes || []), ...(part.staffel?.veto_notes || [])].map((note) => <Note key={note} testId={`postseason-veto-note-${id}`}>{note}</Note>)}
      {part.stale && part.next_seeds?.length ? (
        <div className="space-y-2">
          <h5 className={HEAD}>Setzliste nach dem geltenden Endstand</h5>
          <SeedList seeds={part.next_seeds} testId={`postseason-next-seeds-${id}`} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {!part.staffel && data.can_act && !blockedByTeam ? (
          <button type="button" disabled={!part.can_create} onClick={() => onSheet({ kind: "create", what: "playoffs", row, part })}
            className={`${BUTTON} tls-btn--primary`} data-testid={`postseason-create-playoffs-${id}`}>
            <GitBranch className="h-4 w-4" aria-hidden="true" /> Playoffs anlegen
          </button>
        ) : null}
        {part.staffel && part.can_reseed ? (
          <button type="button" onClick={() => onSheet({ kind: "reseed", row, part })} className={`${BUTTON} tls-btn--secondary`} data-testid={`postseason-reseed-${id}`}>
            <Shuffle className="h-4 w-4" aria-hidden="true" /> Setzliste neu berechnen
          </button>
        ) : null}
        {part.staffel && part.stale && !part.can_reseed && part.reseed_refusal ? <span className="text-xs text-white/60" data-testid={`postseason-reseed-refusal-${id}`}>{part.reseed_refusal}</span> : null}
        {!part.staffel && data.can_act && !blockedByTeam && !part.can_create ? <span className="text-xs text-white/55">Geht, sobald die Punkte oben erledigt sind.</span> : null}
        {!part.staffel && blockedByTeam ? <span className="text-xs font-semibold text-white/80" data-testid={`postseason-own-${id}`}>Du gehörst zu einem Team dieser Liga. Anlegen muss eine andere Person.</span> : null}
        {!data.can_act ? <span className="text-xs text-white/55">Anlegen darf, wer {data.responsible} hat.</span> : null}
      </div>
    </div>
  );
}

function Relegation({ row, data, onSheet }) {
  const part = row.relegation;
  const id = row.division_id;
  const lot = lotLine(part.open_lot);
  const blockedByTeam = part.own_team && !data.superadmin;
  return (
    <div className="space-y-3 border-t border-white/10 pt-4" data-testid={`postseason-relegation-${id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className={HEAD}>Relegation gegen {part.lower_label}</h4>
        <Chip part={part} testId={`postseason-relegation-state-${id}`} />
      </div>
      <p className="text-xs text-white/60">{relegationLine(row)}</p>
      {!part.staffel ? <Blockers part={part} testId={`postseason-relegation-blockers-${id}`} /> : null}
      <StaffelLinks staffel={part.staffel} kind="relegation" />
      {part.stale ? (
        <p className="flex items-start gap-2 rounded-sm border border-warn/40 bg-warn/5 p-3 text-sm text-white" role="note">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> <span>Der Endstand hat sich seit dem Anlegen geändert. Die Relegation spielt mit ihren Paarungen weiter.</span>
        </p>
      ) : null}
      {part.pairs.length ? (
        <ul className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#121212]" data-testid={`postseason-pairs-${id}`}>
          {part.pairs.map((pair) => (
            <li key={`${pair.upper.display_name}-${pair.lower.display_name}`} className="grid gap-1 px-3 py-2 sm:grid-cols-2">
              <span className="min-w-0">
                <span className="block font-semibold text-white [overflow-wrap:anywhere]">{pair.upper.display_name}</span>
                <span className="block text-xs text-white/60">{row.label} · {seedOrigin(pair.upper)} · Heim</span>
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-white [overflow-wrap:anywhere]">{pair.lower.display_name}</span>
                <span className="block text-xs text-white/60">{part.lower_label} · {seedOrigin(pair.lower)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {lot ? <p className="flex items-start gap-2 text-xs text-white/70"><Shuffle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#29B6E8]" aria-hidden="true" /> <span>{lot}</span></p> : null}
      {[...(part.veto_notes || []), ...(part.staffel?.veto_notes || [])].map((note) => <Note key={note} testId={`postseason-relegation-veto-note-${id}`}>{note}</Note>)}
      {part.start_day ? (
        <p className="text-sm text-white/75" data-testid={`postseason-relegation-week-${id}`}>
          Woche {weekRange(part.start_day, part.end_day)}
          {part.after_playoffs_of ? ` · nach den Playoffs von ${part.after_playoffs_of}` : ""}
          {part.moved ? " (der eingestellte Start liegt davor)" : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {!part.staffel && data.can_act && !blockedByTeam ? (
          <button type="button" disabled={!part.can_create} onClick={() => onSheet({ kind: "create", what: "relegation", row, part })}
            className={`${BUTTON} tls-btn--primary`} data-testid={`postseason-create-relegation-${id}`}>
            <GitBranch className="h-4 w-4" aria-hidden="true" /> Relegation anlegen
          </button>
        ) : null}
        {!part.staffel && blockedByTeam ? <span className="text-xs font-semibold text-white/80">Du gehörst zu einem Team dieser Ligen. Anlegen muss eine andere Person.</span> : null}
      </div>
    </div>
  );
}

function CreateSheet({ sheet, seasonId, superadmin, onClose, onDone }) {
  const { what, row, part } = sheet;
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const override = Boolean(part.own_team) && superadmin;
  const playoffs = what === "playoffs";
  const lot = lotLine(part.open_lot);
  const submit = async (event) => {
    event.preventDefault();
    if (overrideMissing(override, conflictReason)) {
      toast.error("Bitte den Grund für die Notausnahme mit mindestens 5 Zeichen angeben.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/admin/leagues/seasons/${seasonId}/postseason/${what}`, {
        division_id: row.division_id, stamp: part.stamp, confirm: true, ...overridePayload(override, conflictReason) });
      toast.success(data.replay ? "Die Staffel gab es schon." : playoffs ? "Playoffs angelegt. Der Baum steht." : "Relegation angelegt. Die Paarungen stehen.");
      onDone();
    } catch (failure) {
      // Inzwischen kann sich der Endstand geändert haben: Karte neu laden, die Vorschau zeigt den neuen Stand.
      toast.error(errorOf(failure, "Anlegen hat nicht geklappt."));
      onDone();
    }
  };
  return (
    <AdminSheet title={playoffs ? "Playoffs anlegen" : "Relegation anlegen"} eyebrow={row.label} onClose={onClose} onSubmit={submit} saving={saving} noValidate
      submitLabel="Jetzt anlegen" savingLabel="Lege an …" submitTestId="postseason-create-confirm" testId="postseason-create-sheet">
      <div className="space-y-3 text-sm text-white/75">
        <p>{playoffs
          ? `Aus dem Endstand entsteht eine eigene K.-o.-Staffel mit ${part.seeds.length} Teams. Die Setzliste wird festgehalten.`
          : `Aus dem Endstand entsteht eine eigene Staffel mit ${part.pairs.length === 1 ? "einer Paarung" : `${part.pairs.length} Paarungen`} gegen ${part.lower_label}.`}</p>
        <ul className="list-disc space-y-1 pl-5 text-white/65">
          <li>Die Staffel läuft sofort, die Spiele stehen in den Wochen aus der Vorschau.</li>
          <li>Check-in, Veto, Melden, Proteste und Strafen gelten wie in der Season.</li>
          {playoffs ? <li>Die Setzliste lässt sich nur vor dem ersten gespielten Spiel neu berechnen.</li> : <li>Das Team der oberen Liga hat Heimrecht. Das Ergebnis gilt für Auf- und Abstieg der nächsten Season.</li>}
          <li>Der Endstand der regulären Staffeln bleibt, wie er ist.</li>
        </ul>
        {lot ? <p className="flex items-start gap-2 rounded-sm border border-[#29B6E8]/40 bg-[#29B6E8]/5 px-3 py-2 text-white" data-testid="postseason-create-lot"><Shuffle className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" /> <span>{lot}. Das Los fällt einmal und steht im Protokoll.</span></p> : null}
      </div>
      {override ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="postseason-conflict-reason" /></div> : null}
    </AdminSheet>
  );
}

function ReseedSheet({ sheet, seasonId, superadmin, onClose, onDone }) {
  const { row, part } = sheet;
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const override = Boolean(part.own_team) && superadmin;
  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < REASON_MIN) {
      toast.error(`Bitte einen Grund mit mindestens ${REASON_MIN} Zeichen angeben.`);
      return;
    }
    if (overrideMissing(override, conflictReason)) {
      toast.error("Bitte den Grund für die Notausnahme mit mindestens 5 Zeichen angeben.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/admin/leagues/seasons/${seasonId}/postseason/${part.staffel.tournament_id}/reseed`, {
        stamp: part.stamp, confirm: true, reason: reason.trim(), ...overridePayload(override, conflictReason) });
      toast.success("Setzliste neu berechnet. Der Baum ist neu gebaut.");
      onDone();
    } catch (failure) {
      toast.error(errorOf(failure, "Neu berechnen hat nicht geklappt."));
      onDone();
    }
  };
  return (
    <AdminSheet title="Setzliste neu berechnen" eyebrow={`${row.label} · Playoffs`} onClose={onClose} onSubmit={submit} saving={saving} noValidate
      submitLabel="Neu berechnen" savingLabel="Berechne …" submitTestId="postseason-reseed-confirm" testId="postseason-reseed-sheet">
      <p className="text-sm text-white/75">
        Die Setzliste entsteht neu aus dem geltenden Endstand, der Baum wird neu gebaut. Ist ein Team ausgeschieden, rückt der Nächste seiner Staffel nach.
        Das geht nur, solange kein Playoff-Spiel gespielt ist.
      </p>
      <div className="mt-4">
        <TextAreaField label="Grund" rows={3} value={reason} onChange={setReason} required placeholder="z. B. Endstand von Staffel A korrigiert"
          hint="Pflicht. Steht im Protokoll." testId="postseason-reseed-reason" />
      </div>
      {override ? <div className="mt-4"><ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="postseason-reseed-conflict" /></div> : null}
    </AdminSheet>
  );
}

function BestOfSelect({ label, value, onChange, options, fallback, testId, disabled }) {
  return <SelectField label={label} value={value} onChange={onChange} testId={testId} disabled={disabled}
    options={[["", fallback], ...options.map((item) => [String(item), `Best of ${item}`])]} />;
}

const START_LOCK_NOTE = "Seit dem Season-Start stehen Best of, Spiel um Platz 3 und Heimrecht fest. Das gilt auch nach einem Wiederöffnen.";

function PlayoffFields({ form, change, options, locked, startLocked = false, earliest, prefix }) {
  const rounds = form.best_of_rounds || [];
  const setRound = (index, patch) => change({ best_of_rounds: rounds.map((row, at) => (at === index ? { ...row, ...patch } : row)) });
  return (
    <div className="space-y-4">
      <CheckField label="Playoffs spielen" checked={form.enabled} onChange={(value) => change({ enabled: value })} disabled={locked}
        hint="Die besten Teams jeder Staffel spielen nach der regulären Season einen K.-o.-Baum." testId={`${prefix}-playoffs-enabled`} />
      {form.enabled ? (
        <>
          {startLocked ? <p className="rounded-sm border border-white/15 bg-white/5 p-3 text-xs text-white/75" role="note" data-testid={`${prefix}-start-locked`}>{START_LOCK_NOTE}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Plätze je Staffel" type="number" min={options.per_staffel[0]} max={options.per_staffel[1]} value={form.per_staffel} required disabled={locked}
              onChange={(value) => change({ per_staffel: value })} hint="So viele Teams jeder Staffel kommen in die Playoffs." testId={`${prefix}-per-staffel`} />
            <BestOfSelect label="Best of" value={form.best_of} onChange={(value) => change({ best_of: value })} options={options.best_of}
              fallback="Wie in der Season" testId={`${prefix}-best-of`} disabled={startLocked} />
            <SelectField label="Heimrecht und Team A im Veto" value={form.home} onChange={(value) => change({ home: value })} testId={`${prefix}-home`} disabled={startLocked}
              options={[["better_seed", "Der besser Gesetzte"], ["draw", "Los je Spiel"]]} />
            <TextField label="Start der Playoffs" type="date" min={earliest || undefined} value={form.start_date} onChange={(value) => change({ start_date: value })}
              hint="Leer: die erste freie Woche nach der regulären Season." testId={`${prefix}-start`} />
          </div>
          <CheckField label="Spiel um Platz 3" checked={form.third_place} onChange={(value) => change({ third_place: value })} disabled={startLocked}
            hint="Ohne das Spiel teilen sich die beiden Halbfinal-Verlierer Platz 3." testId={`${prefix}-third-place`} />
          <fieldset className="space-y-2">
            <legend className={HEAD}>Best of je Runde</legend>
            <p className="text-xs text-white/55">Nur für Runden, die abweichen. Runde 1 ist die erste Runde des Baums. Das Spiel um Platz 3 folgt dem Finale.</p>
            {rounds.map((row, index) => (
              // Die Zeilen stehen fest in dieser Reihenfolge - der Index ist hier der Schlüssel.
              <div key={index} className="flex flex-wrap items-end gap-2">
                <SelectField label="Runde" value={row.round} onChange={(value) => setRound(index, { round: value })} className="w-28" testId={`${prefix}-round-${index}`} disabled={startLocked}
                  options={[["", "–"], ...Array.from({ length: options.round_max }, (_unused, at) => [String(at + 1), `Runde ${at + 1}`])]} />
                <BestOfSelect label="Best of" value={row.best_of} onChange={(value) => setRound(index, { best_of: value })} options={options.best_of}
                  fallback="–" testId={`${prefix}-round-best-of-${index}`} disabled={startLocked} />
                <button type="button" disabled={startLocked} onClick={() => change({ best_of_rounds: rounds.filter((_row, at) => at !== index) })} aria-label={`Zeile ${index + 1} entfernen`}
                  className="tls-btn tls-btn--quiet inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            {rounds.length < options.round_max && !startLocked ? (
              <button type="button" onClick={() => change({ best_of_rounds: [...rounds, { round: "", best_of: "" }] })} className={`${BUTTON} tls-btn--quiet`} data-testid={`${prefix}-round-add`}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Runde hinzufügen
              </button>
            ) : null}
          </fieldset>
        </>
      ) : null}
    </div>
  );
}

function RelegationFields({ form, change, options, locked, earliest, prefix }) {
  return (
    <div className="space-y-4">
      <CheckField label="Relegation spielen" checked={form.enabled} onChange={(value) => change({ enabled: value })} disabled={locked}
        hint="Die Relegationsplätze unten spielen gegen die Relegationsplätze oben der Liga darunter - ein Spiel je Paarung. Die Plätze stehen bei den Zonen im Reiter „Ligen und Staffeln“."
        testId={`${prefix}-relegation-enabled`} />
      {form.enabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <BestOfSelect label="Best of" value={form.best_of} onChange={(value) => change({ best_of: value })} options={options.best_of}
            fallback="Wie in der Season" testId={`${prefix}-relegation-best-of`} />
          <TextField label="Start der Relegation" type="date" min={earliest || undefined} value={form.start_date} onChange={(value) => change({ start_date: value })}
            hint="Leer: automatisch. Sie liegt immer hinter den Playoffs der Liga darunter." testId={`${prefix}-relegation-start`} />
        </div>
      ) : null}
    </div>
  );
}

const LOCK_NOTE = "In dieser Liga ist schon eine Staffel abgeschlossen: an/aus und die Plätze je Staffel stehen fest. Zum Ändern erst alle Staffeln der Liga wieder öffnen.";
const SEASON_LOCK_NOTE = "In mindestens einer Liga ist schon eine Staffel abgeschlossen: Dort stehen an/aus, die Plätze je Staffel und „Meister aus“ fest. Zum Ändern erst alle Staffeln dieser Liga wieder öffnen. Best of, Platz 3, Heimrecht und Termine lassen sich bis zum Anlegen ändern.";

function SettingsSheet({ data, seasonId, onClose, onDone }) {
  const [form, setForm] = useState(() => formOf(data.settings));
  const [saving, setSaving] = useState(false);
  const locked = data.divisions.some((row) => row.locked);
  const submit = async (event) => {
    event.preventDefault();
    const problem = formProblem(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const { data: saved } = await api.put(`/admin/leagues/seasons/${seasonId}/postseason`, seasonBody(form));
      toast.success(["Einstellungen gespeichert.", ...(saved?.warnings || [])].join(" "));
      onDone();
    } catch (failure) {
      toast.error(errorOf(failure, "Speichern hat nicht geklappt."));
      setSaving(false);
    }
  };
  const earliest = data.season.regular_end_day || "";
  return (
    <AdminSheet title="Playoffs und Relegation" eyebrow={data.season.name} size="lg" onClose={onClose} onSubmit={submit} saving={saving} noValidate
      submitTestId="postseason-settings-save" testId="postseason-settings-sheet">
      <p className="text-sm text-white/70">Die Vorlage für alle Ligen dieser Season. Jede Liga kann davon abweichen.</p>
      {locked ? <p className="mt-3 rounded-sm border border-warn/40 bg-warn/5 p-3 text-xs text-white/80" role="note" data-testid="postseason-settings-locked">{SEASON_LOCK_NOTE}</p> : null}
      <div className="mt-4 space-y-6">
        <PlayoffFields form={form.playoffs} change={(patch) => setForm((current) => ({ ...current, playoffs: { ...current.playoffs, ...patch } }))}
          options={data.options} earliest={earliest} prefix="postseason" startLocked={Boolean(data.started && data.settings?.playoffs?.enabled)} />
        <RelegationFields form={form.relegation} change={(patch) => setForm((current) => ({ ...current, relegation: { ...current.relegation, ...patch } }))}
          options={data.options} earliest={earliest} prefix="postseason" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Meister aus" value={form.champion_source} onChange={(value) => setForm((current) => ({ ...current, champion_source: value }))}
            options={[["table", "der Tabelle"], ["playoffs", "den Playoffs"]]} testId="postseason-champion-source"
            hint="Mit Playoffs ist Meister der Sieger des Finales der obersten Liga. Platz 1 einer Staffel heißt dann Staffelsieger." />
          <SelectField label="Wiederöffnen nach dem Start der Playoffs" value={form.reopen_guard} onChange={(value) => setForm((current) => ({ ...current, reopen_guard: value }))}
            options={[["hint", "Erlaubt, mit Hinweis"], ["block", "Gesperrt"]]} testId="postseason-reopen-guard"
            hint="Gilt für reguläre Staffeln, sobald ein Playoff- oder Relegationsspiel gespielt ist." />
        </div>
      </div>
    </AdminSheet>
  );
}

function DivisionSheet({ data, row, onClose, onDone }) {
  const [form, setForm] = useState(() => formOf(row.settings));
  const [own, setOwn] = useState(() => ({ playoffs: Boolean(row.settings.own?.playoffs), relegation: Boolean(row.settings.own?.relegation) }));
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    const problem = own.playoffs ? formProblem(form) : "";
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const { data: saved } = await api.put(`/admin/leagues/divisions/${row.division_id}/postseason`, divisionBody(form, own));
      toast.success([own.playoffs || own.relegation ? "Abweichung gespeichert." : "Die Liga folgt wieder der Season.", ...(saved?.warnings || [])].join(" "));
      onDone();
    } catch (failure) {
      toast.error(errorOf(failure, "Speichern hat nicht geklappt."));
      setSaving(false);
    }
  };
  const earliest = data.season.regular_end_day || "";
  return (
    <AdminSheet title="Abweichung dieser Liga" eyebrow={row.label} size="lg" onClose={onClose} onSubmit={submit} saving={saving} noValidate
      submitTestId="postseason-division-save" testId="postseason-division-sheet">
      <p className="text-sm text-white/70">Ohne Haken gilt, was die Season vorgibt.</p>
      {row.locked ? <p className="mt-3 rounded-sm border border-warn/40 bg-warn/5 p-3 text-xs text-white/80" role="note">{LOCK_NOTE}</p> : null}
      <div className="mt-4 space-y-6">
        <div className="space-y-3">
          <CheckField label="Eigene Playoff-Einstellungen für diese Liga" checked={own.playoffs} onChange={(value) => setOwn((current) => ({ ...current, playoffs: value }))}
            testId="postseason-division-own-playoffs" />
          {own.playoffs ? <PlayoffFields form={form.playoffs} change={(patch) => setForm((current) => ({ ...current, playoffs: { ...current.playoffs, ...patch } }))}
            options={data.options} locked={row.locked} earliest={earliest} prefix="postseason-division"
            startLocked={Boolean(data.started && row.settings?.playoffs?.enabled)} /> : <p className="text-xs text-white/55">Season: {playoffLine({ playoffs: data.settings.playoffs })}</p>}
        </div>
        {row.has_lower ? (
          <div className="space-y-3">
            <CheckField label="Eigene Relegations-Einstellungen für diese Liga" checked={own.relegation} onChange={(value) => setOwn((current) => ({ ...current, relegation: value }))}
              testId="postseason-division-own-relegation" />
            {own.relegation ? <RelegationFields form={form.relegation} change={(patch) => setForm((current) => ({ ...current, relegation: { ...current.relegation, ...patch } }))}
              options={data.options} locked={row.locked} earliest={earliest} prefix="postseason-division" /> : null}
          </div>
        ) : null}
      </div>
    </AdminSheet>
  );
}

function DivisionCard({ row, data, onSheet }) {
  const nothing = !row.playoffs && !row.relegation;
  return (
    <section className="space-y-4 rounded-sm border border-white/10 bg-[#0A0A0A] p-3 sm:p-4" aria-label={`${row.label}: Playoffs und Relegation`}
      data-testid={`postseason-division-${row.division_id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-lg font-black uppercase text-white">{row.label}</h3>
        {data.can_act ? (
          <button type="button" onClick={() => onSheet({ kind: "division", row })} className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
            data-testid={`postseason-division-edit-${row.division_id}`}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> {row.own_settings ? "Abweichung ändern" : "Abweichen"}
          </button>
        ) : null}
      </div>
      {nothing ? <p className="text-sm text-white/60" data-testid={`postseason-none-${row.division_id}`}>In dieser Liga gibt es keine Playoffs und keine Relegation.</p> : null}
      {row.playoffs ? <Playoffs row={row} data={data} onSheet={onSheet} /> : null}
      {row.relegation ? <Relegation row={row} data={data} onSheet={onSheet} /> : null}
    </section>
  );
}

export function SeasonPostseason({ seasonId, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/postseason`);
      setData(body);
      setError("");
    } catch (failure) {
      setError(errorOf(failure, "Playoffs und Relegation konnten nicht geladen werden."));
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments", "matches"]);
  const done = () => {
    setSheet(null);
    load();
    onChanged?.();
  };

  if (error && !data) return <p className="mt-4 text-sm text-warn" role="alert">{error}</p>;
  if (!data) return <p className="mt-4 text-sm text-white/45" aria-busy="true">Lade Playoffs und Relegation …</p>;
  const divisions = data.divisions || [];
  const missing = data.missing || [];
  const active = divisions.some((row) => row.playoffs || row.relegation);
  return (
    <div className="mt-6 space-y-4" data-testid="season-postseason">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-xl font-black uppercase text-white">Playoffs und Relegation</h3>
          <p className="mt-1 text-sm text-white/70" data-testid="postseason-summary">
            {active
              ? `${championLine(data.settings)}. Die Setzliste entsteht aus dem Endstand der regulären Staffeln.`
              : "In dieser Season gibt es keine Playoffs und keine Relegation. Auf- und Abstieg ergeben sich allein aus der Tabelle."}
          </p>
          {data.season?.regular_end_day ? <p className="mt-1 text-xs text-white/55">Die reguläre Season endet am {fullDay(data.season.regular_end_day)}.</p> : null}
        </div>
        {data.can_act ? (
          <button type="button" onClick={() => setSheet({ kind: "settings" })} className={`${BUTTON} tls-btn--secondary`} data-testid="postseason-settings">
            <Settings2 className="h-4 w-4" aria-hidden="true" /> Einstellen
          </button>
        ) : null}
      </div>
      {missing.length ? (
        <ul className="space-y-1 rounded-sm border border-warn/30 bg-warn/5 p-3 text-sm text-white" data-testid="postseason-missing">
          {missing.map((row) => (
            <li key={`${row.kind}-${row.division_id}`} className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> <span>{row.text} Solange läuft die Season weiter.</span></li>
          ))}
        </ul>
      ) : active ? (
        <p className="flex items-start gap-2 text-sm text-ok" data-testid="postseason-complete"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>Alle eingestellten Playoffs und Relegationen sind angelegt.</span></p>
      ) : null}
      {active || data.configured ? divisions.map((row) => <DivisionCard key={row.division_id} row={row} data={data} onSheet={setSheet} />) : null}
      {sheet?.kind === "settings" ? <SettingsSheet data={data} seasonId={seasonId} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === "division" ? <DivisionSheet data={data} row={sheet.row} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === "create" ? <CreateSheet sheet={sheet} seasonId={seasonId} superadmin={Boolean(data.superadmin)} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === "reseed" ? <ReseedSheet sheet={sheet} seasonId={seasonId} superadmin={Boolean(data.superadmin)} onClose={() => setSheet(null)} onDone={done} /> : null}
    </div>
  );
}
