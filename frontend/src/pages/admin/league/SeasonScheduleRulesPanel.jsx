// Terminregeln je Season (#2194, docs/LIGA.md D.1): 72-h-Regel, Verschiebung, Erinnerung und „überfällig“. Eigener Kasten mit
// eigenem Speichern - die Werte gelten sofort für alle nicht gesperrten Staffeln der Season, kein „Übertragen“ nötig.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";

const NUMBERS = ["home_rule_hours", "reschedule_notice_hours", "reschedule_max", "result_reminder_hours", "result_overdue_hours"];

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

/** Die Eingabe als Werte für den Server: Zahlen als ganze Zahlen, leer heißt Vorgabe. */
export function scheduleRulesPayload(form) {
  const out = { home_rule: Boolean(form.home_rule), reschedule_same_week: Boolean(form.reschedule_same_week) };
  for (const key of NUMBERS) {
    if (form[key] === "" || form[key] == null) continue;
    out[key] = Number.parseInt(String(form[key]), 10);
  }
  return out;
}

export function SeasonScheduleRulesPanel({ seasonId }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/schedule-rules`).then(({ data }) => {
      if (!alive || !data?.defaults) return;
      setState(data);
      setForm({ ...(data.schedule_rules || data.defaults) });
    }).catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Terminregeln konnten nicht geladen werden."));
    return () => { alive = false; };
  }, [seasonId]);

  if (!form) {
    return error ? <p className="text-sm text-warn" role="alert" data-testid="schedule-rules-error">{error}</p> : null;
  }
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/admin/leagues/seasons/${seasonId}/schedule-rules`, scheduleRulesPayload(form));
      setState(data);
      setForm({ ...data.schedule_rules });
      toast.success(data.staffeln_updated ? `Terminregeln gespeichert – gilt jetzt in ${data.staffeln_updated} Staffel${data.staffeln_updated === 1 ? "" : "n"}.` : "Terminregeln gespeichert.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Terminregeln konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSection title="Termine und Verschiebungen" testId="season-schedule-rules"
      hint="Gilt sofort für alle Staffeln dieser Season (gesperrte nehmen es beim Übertragen mit). Regelwerk § 7.">
      {!state?.active ? (
        <p className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-white/75" data-testid="schedule-rules-inactive">
          Diese Season ist älter als die Terminregeln: Ein Vorschlag der Heimseite gilt dort sofort, Verschiebungen gibt es nicht.
          Mit „Speichern“ gelten die Werte unten.
        </p>
      ) : null}
      <Toggle label="72-h-Regel: unbeantworteter Vorschlag der Heimseite gilt" checked={form.home_rule} onChange={(value) => set("home_rule", value)}
        hint="Nur, wenn er in der Spielwoche liegt und keine Sperre entgegensteht – sonst gilt der Standardtermin." testId="schedule-rules-home-rule" />
      <FormGrid cols={3}>
        <TextField label="Frist (Stunden)" type="number" min={1} max={336} value={form.home_rule_hours} onChange={(value) => set("home_rule_hours", value)}
          hint="ab dem Vorschlag, Sperrzeiten zählen nicht" testId="schedule-rules-home-hours" />
        <TextField label="Verschieben bis (Stunden vor dem Termin)" type="number" min={0} max={336} value={form.reschedule_notice_hours}
          onChange={(value) => set("reschedule_notice_hours", value)} hint="später nur die Leitung" testId="schedule-rules-notice" />
        <TextField label="Verschiebungen je Spiel" type="number" min={0} max={10} value={form.reschedule_max} onChange={(value) => set("reschedule_max", value)}
          hint="0 = nur die Leitung" testId="schedule-rules-max" />
      </FormGrid>
      <Toggle label="Verschieben nur innerhalb der Spielwoche" checked={form.reschedule_same_week} onChange={(value) => set("reschedule_same_week", value)}
        hint="Wochenübergreifend entscheidet dann die Leitung." testId="schedule-rules-same-week" />
      <FormGrid cols={2}>
        <TextField label="Erinnerung ohne Ergebnis (Stunden nach dem Termin)" type="number" min={1} max={336} value={form.result_reminder_hours}
          onChange={(value) => set("result_reminder_hours", value)} hint="an beide Seiten" testId="schedule-rules-reminder" />
        <TextField label="Überfällig nach (Stunden nach dem Termin)" type="number" min={1} max={720} value={form.result_overdue_hours}
          onChange={(value) => set("result_overdue_hours", value)} hint="dann entscheidet die Leitung (Mein Dienst)" testId="schedule-rules-overdue" />
      </FormGrid>
      {error ? <p className="text-sm text-warn" role="alert" data-testid="schedule-rules-error">{error}</p> : null}
      <button type="button" onClick={save} disabled={saving} data-testid="schedule-rules-save"
        className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
        {saving ? "Speichere …" : "Terminregeln speichern"}
      </button>
    </FormSection>
  );
}
