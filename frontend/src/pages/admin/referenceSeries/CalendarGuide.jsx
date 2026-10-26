import { useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { dayLabel, roundLabel, suggestNextDay } from "@/lib/referenceCalendar";
import { kindWord } from "@/lib/seriesKinds";
import { toast } from "sonner";
import { Check, Wand2 } from "lucide-react";

// Geführter Termin-Ablauf (#2024): drei Schritte, solange noch etwas fehlt - Anzahl der Termine in der Saison, Termine
// anlegen, Datum nachtragen - und die Sammelansicht „Datum nachtragen“ für alle Termine ohne Datum auf einmal. Der
// Vorschlag je Termin kommt aus dem Standard-Wochentag (nach dem letzten Termin mit Datum, dann je Woche weiter).

/** Termine ohne Datum, die noch kommen (nicht abgesagt, nicht gewertet). */
export function undatedRounds(rounds) {
  return (rounds || []).filter((round) => !round.club_day && round.state !== "cancelled" && round.state !== "scored");
}

/** Die drei Schritte mit „erledigt“ - leer, wenn alles erledigt ist. */
export function guideSteps({ rounds, planned, plannedRounds, profile }) {
  const many = kindWord(profile, "round_many", "Termine");
  const hasCount = Boolean(planned?.planned || plannedRounds);
  const created = (rounds || []).length > 0 && (!planned || planned.missing === 0);
  const dated = (rounds || []).length > 0 && undatedRounds(rounds).length === 0;
  const steps = [
    { key: "count", done: hasCount, text: `Anzahl der ${many} in der Saison eintragen („Bearbeiten“ → Termine)` },
    { key: "create", done: created, text: hasCount ? "Termine anlegen – „Fehlende Termine anlegen“ legt sie ohne Datum an" : "Termine anlegen – einzeln mit „Termin“ oder mit „Liste einfügen“" },
    { key: "dates", done: dated, text: "Datum nachtragen, sobald es feststeht – für alle offenen auf einmal" },
  ];
  return steps.every((step) => step.done) ? [] : steps;
}

export function GuideSteps({ steps }) {
  if (!steps.length) return null;
  return (
    <ol className="mt-3 grid gap-1.5 sm:grid-cols-3 text-sm" data-testid="calendar-steps" aria-label="Nächste Schritte">
      {steps.map((step, index) => (
        <li key={step.key} data-done={step.done ? "true" : "false"}
          className={`tls-guide-step flex items-start gap-2 rounded-sm border px-3 py-2 ${step.done ? "border-white/5 text-white/40" : "border-[#29B6E8]/30 bg-[#29B6E8]/5 text-white/85"}`}>
          <span aria-hidden="true" className={`tls-guide-step__mark mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${step.done ? "bg-emerald-400/15 text-emerald-300" : "bg-[#29B6E8]/20 text-[#29B6E8]"}`}>
            {step.done ? <Check className="h-3 w-3" /> : index + 1}
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {step.text}
            {step.done && <span className="sr-only"> – erledigt</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const SMALL_INPUT = `${INPUT_CLASS} !py-1.5 text-sm`;

/** Vorschläge der Reihe nach: der nächste Standard-Wochentag nach dem letzten Termin mit Datum, dann je eine Woche. */
export function suggestDays(rounds, open, weekday, today) {
  const known = (rounds || []).filter((round) => round.club_day).map((round) => ({ club_day: round.club_day }));
  const out = {};
  for (const round of open) {
    const day = suggestNextDay(known, weekday, today);
    out[round.id] = day;
    if (day) known.push({ club_day: day });
  }
  return out;
}

export function DatesSheet({ series, rounds, today, version, profile, onClose, onSaved, onStale }) {
  const open = useMemo(() => undatedRounds(rounds), [rounds]);
  const suggestions = useMemo(() => suggestDays(rounds, open, series.default_weekday, today), [rounds, open, series.default_weekday, today]);
  const [values, setValues] = useState(() => Object.fromEntries(open.map((round) => [round.id, { day: "", time: "" }])));
  const [saving, setSaving] = useState(false);
  const one = kindWord(profile, "round_one", "Termin");
  const set = (id, key, value) => setValues((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const items = open.filter((round) => values[round.id]?.day).map((round) => ({ id: round.id, day: values[round.id].day, time: values[round.id].time || null }));
  const suggestAll = () => setValues((current) => Object.fromEntries(open.map((round) => [round.id, { ...current[round.id], day: current[round.id]?.day || suggestions[round.id] || "" }])));

  const save = async (event) => {
    event.preventDefault();
    if (!items.length) {
      toast.error("Noch kein Tag eingetragen.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/reference-series/admin/series/${series.id}/rounds/dates`, { expected_version: version, items });
      toast.success(items.length === 1 ? "Datum eingetragen." : `${items.length} Termine mit Datum.`);
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      if (err.response?.status === 409) onStale?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminSheet title="Datum nachtragen" eyebrow={series.lineage?.title} onClose={onClose} onSubmit={save} saving={saving}
      submitLabel={items.length ? `${items.length} übernehmen` : "Übernehmen"} submitTestId="dates-save" testId="dates-sheet">
      <p className="text-sm text-white/60">
        Alle {kindWord(profile, "round_many", "Termine")} ohne Datum. Trag nur ein, was feststeht – der Rest bleibt offen. Ohne Uhrzeit gilt
        {series.default_time ? ` die Standard-Uhrzeit (${series.default_time} Uhr)` : " die gemerkte Uhrzeit"}.
      </p>
      {open.some((round) => suggestions[round.id]) && (
        <button type="button" onClick={suggestAll} data-testid="dates-suggest-all"
          className="tls-btn tls-btn--quiet self-start px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5" /> Vorschläge einsetzen
        </button>
      )}
      <ol className="divide-y divide-white/5">
        {open.map((round, index) => {
          const suggestion = suggestions[round.id];
          const value = values[round.id] || { day: "", time: "" };
          return (
            <li key={round.id} className="tls-dates-row py-2 grid grid-cols-[4rem_minmax(0,1fr)] sm:grid-cols-[4rem_minmax(0,1fr)_7rem] items-center gap-x-2 gap-y-1" style={{ "--tls-row-i": index }} data-testid="dates-row">
              <span className="text-sm font-black tabular-nums text-white/80 [overflow-wrap:anywhere]">{roundLabel(round)}</span>
              <input type="date" aria-label={`Tag ${one} ${roundLabel(round)}`} value={value.day} onChange={(event) => set(round.id, "day", event.target.value)} data-testid="dates-day" className={SMALL_INPUT} />
              <input type="time" aria-label={`Uhrzeit ${one} ${roundLabel(round)}`} value={value.time} placeholder={round.time || ""} onChange={(event) => set(round.id, "time", event.target.value)} data-testid="dates-time" className={`${SMALL_INPUT} col-start-2 sm:col-start-auto`} />
              {suggestion && !value.day && (
                <button type="button" onClick={() => set(round.id, "day", suggestion)} data-testid="dates-suggest"
                  className="col-start-2 justify-self-start text-[11px] text-[#29B6E8] underline-offset-2 hover:underline">
                  Vorschlag: {dayLabel(suggestion)}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </AdminSheet>
  );
}
