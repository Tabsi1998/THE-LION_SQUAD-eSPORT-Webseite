// Plätze über Staffeln hinweg im Reiter „Abschluss“ (#1627, docs/LIGA.md „F.2 … Zielregel je Zone“): Vergibt eine Liga mit mehreren
// Staffeln zusätzliche Auf- oder Abstiegsplätze über alle Staffeln („die zwei besten Zweiten“), stehen hier die Kandidaten mit ihrem
// Schnitt je Spiel. Fest steht es erst, wenn alle Staffeln der Liga abgeschlossen sind. Ein Gleichstand an der Grenze sperrt den
// Abschluss der letzten Staffel, bis die Leitung entschieden hat - mit Entscheidungsspiel oder eigenem Entscheid, ohne Los.
import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField, TextAreaField } from "@/components/tls/FormFields";
import { ConflictReasonField, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";
import { api, formatApiError } from "@/lib/api";
import { candidateLine, candidateState, crossDecisionLine, crossStatus, decisionReady, sideTitle, tieLine } from "@/lib/leagueCrossZones";

const BUTTON = "tls-btn inline-flex min-h-11 items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const STATE_CLASS = { chosen: "border-ok/50 text-ok", tied: "border-warn/50 text-warn", passed: "border-white/15 text-white/60" };

function DecisionSheet({ entry, side, methods, superadmin, onClose, onDone }) {
  const [picked, setPicked] = useState([]);
  const [method, setMethod] = useState("");
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const tie = side.tie;
  const needsReason = Boolean(side.own_team && superadmin);
  const toggle = (id) => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const submit = async (event) => {
    event.preventDefault();
    if (saving || !decisionReady(tie, picked, method, reason)) return;
    setSaving(true);
    try {
      await api.put(`/admin/leagues/divisions/${entry.division_id}/zone-decision`, {
        kind: side.kind, registration_ids: picked, method, reason: reason.trim(), ...overridePayload(needsReason, conflictReason),
      });
      toast.success("Entscheid gespeichert.");
      onDone();
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Gleichstand entscheiden" eyebrow={entry.label} onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Entscheid speichern"
      submitTestId="cross-decision-save" submitDisabled={!decisionReady(tie, picked, method, reason) || overrideMissing(needsReason, conflictReason)} testId="cross-decision-sheet">
      <p className="text-sm text-white/80">{tieLine(tie)}</p>
      <fieldset className="space-y-2" data-testid="cross-decision-teams">
        <legend className="text-xs font-bold uppercase tracking-wider text-white/70">
          Wer bekommt den Platz? {tie.open === 1 ? "Wähle ein Team." : `Wähle ${tie.open} Teams.`}
        </legend>
        {side.candidates.filter((candidate) => candidate.tied).map((candidate) => (
          <label key={candidate.registration_id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-3">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#29B6E8]" checked={picked.includes(candidate.registration_id)}
              onChange={() => toggle(candidate.registration_id)} data-testid={`cross-decision-pick-${candidate.registration_id}`} />
            <span className="min-w-0">
              <span className="block font-semibold text-white [overflow-wrap:anywhere]">{candidate.display_name}</span>
              <span className="block text-xs text-white/60">{candidateLine(candidate)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <SelectField label="Wie wurde entschieden?" value={method} onChange={setMethod} testId="cross-decision-method"
        options={[["", "Bitte wählen …"], ...Object.entries(methods || {})]} hint="Ein Los gibt es beim Auf- und Abstieg nicht." />
      <TextAreaField label="Grund (Pflicht)" rows={3} value={reason} onChange={setReason} testId="cross-decision-reason"
        hint="Zum Beispiel das Ergebnis des Entscheidungsspiels. Steht im Protokoll." />
      {needsReason ? <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="cross-decision-conflict" /> : null}
    </AdminSheet>
  );
}

function ClearSheet({ entry, side, superadmin, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Wie beim Entscheiden: Gehört die Person zu einem Team des Gleichstands, geht es nur als Notausnahme des Superadmins mit Grund.
  const needsReason = Boolean(side.own_team && superadmin);
  const submit = async (event) => {
    event.preventDefault();
    if (saving || reason.trim().length < 5 || overrideMissing(needsReason, conflictReason)) return;
    setSaving(true);
    try {
      await api.delete(`/admin/leagues/divisions/${entry.division_id}/zone-decision/${side.kind}`,
        { data: { reason: reason.trim(), ...overridePayload(needsReason, conflictReason) } });
      toast.success("Entscheid zurückgenommen. Der Gleichstand ist wieder offen.");
      onDone();
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Entscheid zurücknehmen" eyebrow={entry.label} onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Zurücknehmen"
      submitTestId="cross-clear-save" submitDisabled={reason.trim().length < 5 || overrideMissing(needsReason, conflictReason)} testId="cross-clear-sheet">
      <p className="text-sm text-white/80">Bisher: {crossDecisionLine(side.decision)}</p>
      <TextAreaField label="Grund (Pflicht)" rows={2} value={reason} onChange={setReason} testId="cross-clear-reason"
        hint="Danach ist der Gleichstand wieder offen und hält die neue Season auf, bis neu entschieden ist." />
      {needsReason ? <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="cross-clear-conflict" /> : null}
    </AdminSheet>
  );
}

function Side({ entry, side, canResults, superadmin, onSheet }) {
  return (
    <div className="space-y-2" data-testid={`cross-side-${entry.division_id}-${side.kind}`}>
      <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">{sideTitle(side)}</h4>
      {side.candidates.length ? (
        <ul className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#121212]">
          {side.candidates.map((candidate) => {
            const state = candidateState(side, candidate);
            return (
              <li key={candidate.registration_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid={`cross-candidate-${candidate.registration_id}`}>
                <span className="min-w-0 flex-1 basis-56">
                  <span className="block font-semibold text-white [overflow-wrap:anywhere]">{candidate.display_name}</span>
                  <span className="block text-xs tabular-nums text-white/60">{candidateLine(candidate)}</span>
                </span>
                {state ? <span className={`shrink-0 rounded-sm border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${STATE_CLASS[state.key]}`}>{state.label}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-white/55">Noch kein Kandidat – dafür braucht jede Staffel ein gewertetes Spiel.</p>}
      {side.tie ? (
        <div className="space-y-2 rounded-sm border border-warn/30 bg-warn/5 p-3" data-testid={`cross-tie-${entry.division_id}-${side.kind}`}>
          <p className="flex items-start gap-2 text-sm text-white"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> <span>{tieLine(side.tie)}</span></p>
          <p className="text-xs text-white/65">Die letzte Staffel dieser Liga lässt sich erst abschließen, wenn das entschieden ist: mit einem Entscheidungsspiel oder durch die Leitung, ohne Los.</p>
          {!canResults ? <p className="text-xs text-white/65">Den Entscheid trifft, wer in dieser Liga „Ergebnisse korrigieren“ darf.</p>
            : side.own_team && !superadmin ? <OwnTeamNote testId={`cross-own-${entry.division_id}-${side.kind}`} />
              : <button type="button" onClick={() => onSheet({ kind: "decide", entry, side })} className={`${BUTTON} tls-btn--secondary`} data-testid={`cross-decide-${entry.division_id}-${side.kind}`}>Gleichstand entscheiden</button>}
        </div>
      ) : null}
      {side.decision ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70" data-testid={`cross-decision-${entry.division_id}-${side.kind}`}>
          <span className="min-w-0 [overflow-wrap:anywhere]">Entscheid: {crossDecisionLine(side.decision)}</span>
          {/* Zurücknehmen entscheidet wie das Entscheiden: nie über das eigene Team, der Superadmin nur als Notausnahme. */}
          {canResults && !(side.own_team && !superadmin) ? <button type="button" onClick={() => onSheet({ kind: "clear", entry, side })} className="tls-btn tls-btn--quiet min-h-11 rounded-sm px-3 py-1 text-[11px] font-bold uppercase tracking-wider" data-testid={`cross-clear-${entry.division_id}-${side.kind}`}>Zurücknehmen</button> : null}
          {canResults && side.own_team && !superadmin ? <OwnTeamNote testId={`cross-clear-own-${entry.division_id}-${side.kind}`} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function SeasonCrossZones({ data, canResults, onChanged }) {
  const [sheet, setSheet] = useState(null);
  if (!data.cross?.length) return null;
  const done = () => { setSheet(null); onChanged(); };
  return (
    <div className="mt-4 space-y-4" data-testid="season-cross-zones">
      {data.cross.map((entry) => (
        <section key={entry.division_id} className="space-y-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-3 sm:p-4" aria-label={`${entry.label}: Plätze über Staffeln hinweg`}
          data-testid={`cross-division-${entry.division_id}`}>
          <div>
            <h3 className="font-heading text-lg font-black uppercase text-white">{entry.label} · Plätze über Staffeln hinweg</h3>
            <p className="mt-1 text-xs text-white/60" data-testid={`cross-status-${entry.division_id}`}>{crossStatus(entry)}</p>
            <p className="mt-1 text-xs text-white/55">Verglichen wird nach Punkten je Spiel, dann nach Map-Differenz je Spiel – so zählen auch verschieden große Staffeln gleich.</p>
          </div>
          {entry.sides.map((side) => <Side key={side.kind} entry={entry} side={side} canResults={canResults} superadmin={Boolean(data.superadmin)} onSheet={setSheet} />)}
        </section>
      ))}
      {sheet?.kind === "decide" ? <DecisionSheet entry={sheet.entry} side={sheet.side} methods={data.cross_methods} superadmin={Boolean(data.superadmin)} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === "clear" ? <ClearSheet entry={sheet.entry} side={sheet.side} superadmin={Boolean(data.superadmin)} onClose={() => setSheet(null)} onDone={done} /> : null}
    </div>
  );
}
