import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { sessionLabel } from "@/lib/raceWeekend";
import { todayDay } from "@/lib/referenceSeriesStaff";
import {
  adjustmentDefaultTeam, adjustmentDetail, adjustmentErrors, adjustmentPayload, adjustmentTarget, adjustmentTeamText, adjustmentText, adjustmentToForm,
  emptyAdjustment,
} from "@/lib/seriesSpecialRules";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";

// Anpassungen der Saison (#1960, nur Vorstand): ±Punkte in der Gesamtwertung ohne Rennergebnis - etwa −5 für
// Nichtteilnahme nach Anmeldung, verspätete Ab- oder Anmeldung oder ein fehlendes Video, auch als Korrektur der
// Teamwertung. Je Anpassung Teilnehmer bzw. Team, Punkte, Grund (öffentlich), Tag und optional der Termin. Der Server
// rechnet danach alle Stände neu und protokolliert jede Änderung. Bekommt `series` (mit `adjustments`).

const KIND_OPTIONS = [["participant", "Teilnehmer (Fahrerwertung)"], ["team", "Team (Teamwertung)"]];

// #2000: was der Haken „zählt auch für die Teamwertung“ im Modus der Saison heißt.
const TEAM_HINTS = {
  per_race: "Zählt für das Team, für das der Fahrer im Termin gefahren ist – ohne Termin für das Team seiner letzten Fahrt bis zum Tag. Als Ersatz gefahren: für keines.",
  current_lineup: "Bleibt in den Saisonpunkten des Fahrers und zählt so für sein aktuelles Team. Ohne Haken wird sie aus der Teamsumme herausgerechnet.",
};

/** Für welches Team eine Fahrer-Anpassung mit Haken zählt bzw. warum für keines - vom Server (`adjustment_teams`). */
function teamNote(item, series, scoring) {
  if (!scoring?.enabled || (item.kind || "participant") !== "participant") return null;
  const flagged = typeof item.counts_for_team === "boolean" ? item.counts_for_team : scoring.mode === "current_lineup";
  if (!flagged) return null;
  const credit = series.adjustment_teams?.[item.id];
  return { text: adjustmentTeamText({ counts_for_team: true, credited_team: credit?.team, team_note: credit?.note }), warn: Boolean(credit?.note) };
}

function AdjustmentSheet({ series, item, participants, rounds, teams, onClose, onSaved }) {
  const isNew = !item?.id;
  const scoring = series.rules?.team_scoring;
  const [form, setForm] = useState(() => (item ? adjustmentToForm(item, scoring) : emptyAdjustment({ day: todayDay(), counts_for_team: adjustmentDefaultTeam(scoring) })));
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const errors = touched ? adjustmentErrors(form) : {};
  const base = `/reference-series/admin/series/${series.id}/adjustments`;

  const save = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(adjustmentErrors(form)).length) return;
    setSaving(true);
    try {
      if (isNew) await api.post(base, adjustmentPayload(form));
      else await api.patch(`${base}/${item.id}`, adjustmentPayload(form));
      toast.success("Gespeichert – die Stände sind neu gerechnet.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const people = [["", "— Teilnehmer wählen —"], ...participants.map((person) => [person.id, person.name])];
  const roundOptions = [["", "— ohne Termin —"], ...rounds.map((round) => [round.id, sessionLabel(round)])];
  return (
    <AdminSheet title={isNew ? "Neue Anpassung" : "Anpassung bearbeiten"} eyebrow="Punkte ohne Rennergebnis" onClose={onClose} onSubmit={save} saving={saving} submitTestId="adjustment-save" testId="adjustment-sheet">
      {Object.keys(errors).length > 0 && (
        <ul className="border border-red-400/40 bg-red-400/10 rounded-sm px-3 py-2 text-sm text-red-100 space-y-0.5" role="alert" data-testid="adjustment-errors">
          {Object.values(errors).map((message) => <li key={message}>{message}</li>)}
        </ul>
      )}
      <SelectField label="Für" value={form.kind} onChange={(value) => set("kind", value)} options={KIND_OPTIONS} testId="adjustment-kind" />
      {form.kind === "team" ? (
        <TextField label="Team" required value={form.team} onChange={(value) => set("team", value)} suggestions={teams} maxLength={120} testId="adjustment-team"
          hint="Wie in der Teamwertung; Groß- und Kleinschreibung egal." />
      ) : (
        <SelectField label="Teilnehmer" value={form.participant_id} onChange={(value) => set("participant_id", value)} options={people} testId="adjustment-participant" />
      )}
      <FormGrid>
        <TextField label="Punkte" required value={form.points} onChange={(value) => set("points", value)} placeholder="-5" testId="adjustment-points"
          hint="Minus zieht ab, plus gibt dazu." />
        <TextField label="Tag" type="date" required value={form.day} onChange={(value) => set("day", value)} testId="adjustment-day"
          hint="Ohne Termin zählt sie ab dem Stand an diesem Tag." />
      </FormGrid>
      <TextField label="Grund" required value={form.reason} onChange={(value) => set("reason", value)} maxLength={200} placeholder="Nichtteilnahme nach Anmeldung" testId="adjustment-reason"
        hint="Öffentlich: steht als „−5“ mit diesem Grund bei den Punkten." />
      <SelectField label="Termin (optional)" value={form.round_id} onChange={(value) => set("round_id", value)} options={roundOptions} testId="adjustment-round"
        hint="Zählt ab dem Stand dieses Termins." />
      {/* #2000: nur für Fahrer und nur mit Teamwertung - Vorgabe aus den Regeln der Saison. */}
      {form.kind !== "team" && form.counts_for_team !== null && (
        <CheckField label="Zählt auch für die Teamwertung" checked={form.counts_for_team} onChange={(value) => set("counts_for_team", value)} testId="adjustment-counts-for-team"
          hint={TEAM_HINTS[scoring?.mode] || TEAM_HINTS.per_race} />
      )}
    </AdminSheet>
  );
}

export function SeriesAdjustmentsSection({ series, onChanged }) {
  const [participants, setParticipants] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [sheet, setSheet] = useState(null);
  const confirm = useConfirm();
  const items = useMemo(() => series.adjustments || [], [series.adjustments]);
  const teamNotes = useMemo(() => Object.fromEntries(items.map((item) => [item.id, teamNote(item, series, series.rules?.team_scoring)])), [items, series]);

  const load = useCallback(async () => {
    try {
      const [people, calendar] = await Promise.all([
        api.get(`/reference-series/admin/series/${series.id}/participants`),
        api.get(`/reference-series/admin/series/${series.id}/calendar`),
      ]);
      setParticipants(people?.data?.participants || []);
      setRounds(calendar?.data?.rounds || []);
    } catch {
      // Namen und Termine sind nur Hilfen - die Liste steht auch ohne.
    }
  }, [series.id]);
  useEffect(() => { load(); }, [load]);

  const teams = useMemo(() => [...new Set([
    ...(series.own_teams || []).map((team) => team.name),
    ...participants.map((person) => person.default_team),
  ].filter(Boolean))], [series.own_teams, participants]);

  const remove = async (item) => {
    if (!await confirm({ title: `Anpassung ${adjustmentText(item.points)} entfernen?`, description: "Die Stände werden neu gerechnet; das Protokoll behält die Anpassung.", confirmLabel: "Entfernen" })) return;
    try {
      await api.delete(`/reference-series/admin/series/${series.id}/adjustments/${item.id}`);
      toast.success("Anpassung entfernt.");
      onChanged?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" aria-labelledby="series-adjustments-title" data-testid="series-adjustments-admin">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 id="series-adjustments-title" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Anpassungen</h2>
          <p className="mt-1 text-sm text-white/60">Punkte ohne Rennergebnis – etwa −5 für Nichtteilnahme nach Anmeldung. Öffentlich mit Grund.</p>
        </div>
        <button type="button" onClick={() => setSheet({ item: null })} data-testid="adjustment-new" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> Anpassung
        </button>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-white/50" data-testid="adjustments-empty">Keine Anpassungen – die Tabelle zählt nur Rennergebnisse.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5" data-testid="adjustments-list">
          {items.map((item) => (
            <li key={item.id} className="py-2.5 flex items-start gap-3" data-testid="adjustment-row">
              <span className={`w-12 shrink-0 pt-0.5 font-display text-base font-bold tabular-nums ${Number(item.points) < 0 ? "text-red-300" : "text-emerald-300"}`}>{adjustmentText(item.points)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white [overflow-wrap:anywhere]">
                  {adjustmentTarget(item, participants)}
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-white/45">{item.kind === "team" ? "Team" : "Fahrer"}</span>
                </span>
                <span className="block text-sm text-white/60 [overflow-wrap:anywhere]">{adjustmentDetail(item, rounds)}</span>
                {/* #2000: für welches Team - bzw. als Ersatz gefahren: für keines (Hinweis). */}
                {teamNotes[item.id] && (
                  <span className={`block text-xs [overflow-wrap:anywhere] ${teamNotes[item.id].warn ? "text-amber-200/90" : "text-[#29B6E8]/90"}`} data-tone={teamNotes[item.id].warn ? "warn" : "info"} data-testid="adjustment-team-note">
                    {teamNotes[item.id].text}
                  </span>
                )}
              </span>
              <button type="button" onClick={() => setSheet({ item })} aria-label={`Anpassung ${adjustmentText(item.points)} bearbeiten`} title="Bearbeiten" data-testid="adjustment-edit" className="tls-hit p-2 text-white/50 hover:text-white">
                <Pencil className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => remove(item)} aria-label={`Anpassung ${adjustmentText(item.points)} entfernen`} title="Entfernen" data-testid="adjustment-remove" className="tls-hit p-2 text-white/50 hover:text-white">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {sheet && (
        <AdjustmentSheet series={series} item={sheet.item} participants={participants} rounds={rounds} teams={teams}
          onClose={() => setSheet(null)} onSaved={() => { setSheet(null); onChanged?.(); }} />
      )}
    </section>
  );
}
