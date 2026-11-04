// Veto je Season (#1618, docs/LIGA.md D.3): an/aus, Team A (Heim oder Los), Zeit je Schritt und die Schrittfolge (Sperren, Wählen,
// Decider je Modus mit Position in der Serie) - mit Prüfung live, Vorschlag aus Modusfolge und Pools und eigenem Speichern. Die Werte
// gelten sofort für alle nicht gesperrten Staffeln der Season; ein laufendes Veto behält seinen Schnappschuss.
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";
import { KIND_OPTIONS, SECONDS, STEPS_MAX, TEAM_A_OPTIONS, TEAM_OPTIONS, emptyStep, moveStep, stepSentence, templateProblems, vetoRulesPayload } from "@/lib/leagueVeto";

const ICON = "inline-flex h-9 w-9 items-center justify-center rounded-sm text-white/55 hover:text-white disabled:opacity-30 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";

function toForm(rules, defaults) {
  const source = rules || defaults || { enabled: false, team_a: "home", step_seconds: 60, steps: [] };
  return {
    enabled: Boolean(source.enabled),
    team_a: source.team_a || "home",
    step_seconds: String(source.step_seconds ?? 60),
    steps: (source.steps || []).map((step) => ({ kind: step.kind, mode: step.mode || "", team: step.team || (step.kind === "decider" ? null : "A"), position: step.position == null ? "" : String(step.position) })),
  };
}

function Toggle({ label, hint, checked, onChange, testId }) {
  return (
    <label className="flex min-h-[44px] items-start gap-2 text-sm text-white/80">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="mt-1 accent-[#29B6E8]" data-testid={testId} />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint ? <span className="block text-xs text-white/50">{hint}</span> : null}
      </span>
    </label>
  );
}

function StepRow({ step, index, count, modes, labelOf, onChange, onMove, onRemove }) {
  const set = (patch) => onChange({ ...step, ...patch });
  return (
    <li className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`veto-step-${index}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs font-bold uppercase tracking-widest text-[#29B6E8]">Schritt {index + 1}</div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={ICON} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Schritt ${index + 1} nach oben`} data-testid={`veto-step-${index}-up`}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={ICON} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Schritt ${index + 1} nach unten`} data-testid={`veto-step-${index}-down`}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={`${ICON} hover:text-live`} onClick={onRemove} aria-label={`Schritt ${index + 1} entfernen`} data-testid={`veto-step-${index}-remove`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SelectField label="Art" value={step.kind} onChange={(kind) => set({ kind, team: kind === "decider" ? null : step.team || "A", position: kind === "ban" ? "" : step.position })}
          options={KIND_OPTIONS} testId={`veto-step-${index}-kind`} />
        <SelectField label="Modus" value={step.mode} onChange={(mode) => set({ mode })} options={[["", "bitte wählen"], ...modes.map((row) => [row.mode, row.label])]} testId={`veto-step-${index}-mode`} />
        {step.kind !== "decider" ? (
          <SelectField label="Wer" value={step.team || ""} onChange={(team) => set({ team })} options={TEAM_OPTIONS} testId={`veto-step-${index}-team`} />
        ) : <div className="text-xs text-white/50 self-end pb-2">Wer: das System</div>}
        {step.kind !== "ban" ? (
          <TextField label="Position (Map Nr.)" type="number" min={1} max={9} value={step.position} onChange={(position) => set({ position })} testId={`veto-step-${index}-position`} />
        ) : <div className="text-xs text-white/50 self-end pb-2">Position: keine (Sperre)</div>}
      </div>
      <p className="mt-2 text-xs text-white/60" data-testid={`veto-step-${index}-sentence`}>{stepSentence(step, labelOf)}</p>
    </li>
  );
}

export function SeasonVetoRulesPanel({ seasonId }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/veto-rules`).then(({ data }) => {
      if (!alive || !data?.defaults) return;
      setState(data);
      setForm(toForm(data.veto_rules, data.defaults));
    }).catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Veto konnte nicht geladen werden."));
    return () => { alive = false; };
  }, [seasonId]);

  const modes = state?.modes || [];
  const labelOf = (mode) => modes.find((row) => row.mode === mode)?.label || mode;
  const problems = useMemo(() => (form && form.enabled
    ? templateProblems(form, { modes, bestOf: state?.best_of, order: state?.game_mode_order, repeat: state?.map_repeat })
    : []), [form, modes, state]);

  if (!form) {
    return error ? <p className="text-sm text-warn" role="alert" data-testid="veto-rules-error">{error}</p> : null;
  }
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setSteps = (steps) => set("steps", steps);
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/admin/leagues/seasons/${seasonId}/veto-rules`, vetoRulesPayload(form));
      setState(data);
      setForm(toForm(data.veto_rules, data.defaults));
      toast.success(data.staffeln_updated ? `Veto gespeichert – gilt jetzt in ${data.staffeln_updated} Staffel${data.staffeln_updated === 1 ? "" : "n"}.` : "Veto gespeichert.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Veto konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };
  const propose = async () => {
    setProposing(true);
    setError("");
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/veto-rules/proposal`);
      setForm((current) => ({ ...current, enabled: true, steps: toForm({ steps: data.steps }).steps }));
      toast.success("Vorschlag übernommen – zum Anpassen, noch nicht gespeichert.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Ein Vorschlag war nicht möglich.");
    } finally {
      setProposing(false);
    }
  };
  const serverProblems = (state?.problems || []).filter((text) => !problems.includes(text));
  const bestOf = state?.best_of || 1;

  return (
    <FormSection title="Veto" testId="season-veto-rules"
      hint={`Regelwerk § 6: Vor Map 1 sperren und wählen die Teams die Maps nach dieser Vorlage (Best of ${bestOf}). Gilt sofort für alle Staffeln dieser Season; ein laufendes Veto behält seinen Stand.`}>
      {state && !state.veto_rules ? (
        <p className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-white/75" data-testid="veto-rules-inactive">
          Diese Season ist älter als das Veto: Dort werden die Maps beim Ergebnis eingetragen, bis ihr einmal speichert.
        </p>
      ) : null}
      {state && state.has_checkin === false ? (
        <p className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-white/75" data-testid="veto-rules-no-checkin">
          Das Veto braucht den Check-in (Reiter Termine) – es beginnt, sobald beide Seiten eingecheckt sind.
        </p>
      ) : null}
      <Toggle label="Veto in dieser Season" checked={form.enabled} onChange={(value) => set("enabled", value)}
        hint="Aus: die Teams tragen die Maps wie bisher beim Ergebnis ein. An: nach dem Check-in läuft das Veto, Map 1 folgt direkt danach." testId="veto-rules-enabled" />
      <FormGrid cols={2}>
        <SelectField label="Team A" value={form.team_a} onChange={(value) => set("team_a", value)} options={TEAM_A_OPTIONS}
          hint="Nr. 22: Team A beginnt laut Vorlage; Team B ist die andere Seite. Ein Los wird je Spiel einmal gezogen." testId="veto-rules-team-a" />
        <TextField label="Zeit je Schritt (Sekunden)" type="number" min={SECONDS[0]} max={SECONDS[1]} value={form.step_seconds}
          onChange={(value) => set("step_seconds", value)} hint="Nr. 23: Vorgabe 60 – danach wählt das System zufällig aus den zulässigen Maps" testId="veto-rules-seconds" />
      </FormGrid>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Schrittfolge</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={propose} disabled={proposing || !modes.length} data-testid="veto-rules-propose"
              className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> {proposing ? "Erzeuge …" : "Vorschlag aus Modusfolge und Pools"}
            </button>
            <button type="button" onClick={() => setSteps([...form.steps, emptyStep(modes[0]?.mode || "")])} disabled={form.steps.length >= STEPS_MAX} data-testid="veto-rules-add"
              className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Schritt hinzufügen
            </button>
          </div>
        </div>
        <p className="text-xs text-white/50">Sperren und Wählen gehören einem Team und einem Modus, eine Wahl und der Decider bekommen ihre Position in der Serie (Map 1 bis {bestOf}). Die Reihenfolge hier ist die des Vetos, nicht die Spielreihenfolge.</p>
        {form.steps.length ? (
          <ol className="space-y-2" data-testid="veto-rules-steps">
            {form.steps.map((step, index) => (
              <StepRow key={index} step={step} index={index} count={form.steps.length} modes={modes} labelOf={labelOf}
                onChange={(next) => setSteps(form.steps.map((row, at) => (at === index ? next : row)))}
                onMove={(delta) => setSteps(moveStep(form.steps, index, delta))}
                onRemove={() => setSteps(form.steps.filter((_, at) => at !== index))} />
            ))}
          </ol>
        ) : <p className="text-sm text-white/55" data-testid="veto-rules-empty">Noch keine Schritte – „Vorschlag aus Modusfolge und Pools“ baut eine passende Folge.</p>}
      </div>
      {form.enabled && (problems.length || serverProblems.length) ? (
        <ul className="space-y-1 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" data-testid="veto-rules-problems" aria-live="polite">
          {[...problems, ...serverProblems].map((text) => <li key={text}>{text}</li>)}
        </ul>
      ) : form.enabled && form.steps.length ? (
        <p className="text-xs text-ok" data-testid="veto-rules-ok">Die Vorlage geht mit dem Pool auf.</p>
      ) : null}
      {error ? <p className="text-sm text-warn" role="alert" data-testid="veto-rules-error">{error}</p> : null}
      <button type="button" onClick={save} disabled={saving || (form.enabled && problems.length > 0)} data-testid="veto-rules-save"
        className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
        {saving ? "Speichere …" : "Veto speichern"}
      </button>
    </FormSection>
  );
}
