// Erinnerungen je Season (#1647, docs/LIGA.md E.5): ein Schalter je Art, Zeiten mit Vorgabe, Discord ergänzend. Eigener Kasten mit
// eigenem Speichern im Reiter „Termine“ (Sprungmarke `#erinnerungen`) - die Werte gelten sofort für alle nicht gesperrten Staffeln.
// Wann „Ergebnis fehlt“ kommt, steht nur in den Terminregeln darüber; hier steht es als Hinweis (jede Angabe an einer Stelle, #2023).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, TextField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";

const FLAGS = ["upcoming", "unscheduled", "result_missing", "veto_turn", "discord"];
const NUMBERS = ["upcoming_early_hours", "upcoming_late_minutes", "unscheduled_week_percent", "unscheduled_hours_before_default",
  "veto_idle_seconds", "veto_min_left_seconds"];

/** Die Eingabe als Werte für den Server: Schalter als an/aus, Zahlen als ganze Zahlen. Ein leeres Feld geht nicht mit - der Server
 * behält dann den gespeicherten Wert (ohne gespeicherten die Vorgabe). */
export function reminderRulesPayload(form) {
  const out = Object.fromEntries(FLAGS.map((key) => [key, Boolean(form[key])]));
  for (const key of NUMBERS) {
    if (form[key] === "" || form[key] == null) continue;
    out[key] = Number.parseInt(String(form[key]), 10);
  }
  return out;
}

/** Passt „Map-Veto wartet“ in die Zeit je Schritt der Season? Sonst der Satz für den Kasten (der Server lehnt dann mit 422 ab). */
export function vetoMisfit(form, stepSeconds) {
  if (!form?.veto_turn || !stepSeconds) return "";
  const idle = Number.parseInt(String(form.veto_idle_seconds), 10);
  const left = Number.parseInt(String(form.veto_min_left_seconds), 10);
  if (Number.isNaN(idle) || Number.isNaN(left) || idle < stepSeconds - left) return "";
  return `Je Schritt sind ${stepSeconds} Sekunden Zeit – so käme die Erinnerung nie. Höchstens ${Math.max(stepSeconds - left - 1, 0)} Sekunden ohne Zug.`;
}

function Kind({ label, hint, checked, onChange, testId, disabled = false, children }) {
  return (
    <div className="rounded-sm border border-white/10 bg-white/[0.02] p-3" data-testid={`${testId}-box`}>
      <CheckField label={label} hint={hint} checked={checked} onChange={onChange} testId={testId} disabled={disabled} className="min-h-[44px]" />
      {children ? <div className="mt-2 pl-6">{children}</div> : null}
    </div>
  );
}

/** ``canEdit``: Zuständigkeit „Season konfigurieren“ - ohne sie nur lesen, mit Hinweis. */
export function SeasonReminderRulesPanel({ seasonId, canEdit = true }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/reminder-rules`).then(({ data }) => {
      if (!alive || !data?.defaults) return;
      setState(data);
      setForm({ ...(data.reminder_rules || data.defaults) });
    }).catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Erinnerungen konnten nicht geladen werden."));
    return () => { alive = false; };
  }, [seasonId]);

  if (!form) {
    return error ? <p className="text-sm text-warn" role="alert" data-testid="reminder-rules-error">{error}</p> : null;
  }
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/admin/leagues/seasons/${seasonId}/reminder-rules`, reminderRulesPayload(form));
      setState(data);
      setForm({ ...data.reminder_rules });
      toast.success(data.staffeln_updated ? `Erinnerungen gespeichert – gilt jetzt in ${data.staffeln_updated} Staffel${data.staffeln_updated === 1 ? "" : "n"}.` : "Erinnerungen gespeichert.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Erinnerungen konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };
  const resultHours = state?.result_reminder_hours;
  const stepSeconds = state?.veto_step_seconds;
  const misfit = vetoMisfit(form, stepSeconds);

  return (
    <FormSection title="Erinnerungen" testId="season-reminder-rules"
      hint="Gilt sofort für alle Staffeln dieser Season (gesperrte nehmen es beim Übertragen mit). Kommt im Web, in der App und per Push – jede Person kann „Match-Erinnerungen“ in ihren Benachrichtigungs-Einstellungen abschalten.">
      {!state?.active ? (
        <p className="rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-white/75" data-testid="reminder-rules-inactive">
          Für diese Season ist noch nichts gespeichert – es gelten die Vorgaben unten.
        </p>
      ) : null}
      {!canEdit ? (
        <p className="rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-white/75" data-testid="reminder-rules-readonly">
          Nur lesen: Ändern darf, wer für diese Liga „Season konfigurieren“ hat.
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <Kind label="Spiel steht an" checked={form.upcoming} onChange={(value) => set("upcoming", value)} testId="reminder-rules-upcoming" disabled={!canEdit}
          hint="An die Aufgestellten (ohne Aufstellung den Kader) und die Captains, mit Gegner und Uhrzeit. Nicht bei abgesagten, verschobenen oder gestarteten Spielen und nicht, wenn das Spiel in einer Sperrzeit liegt.">
          <FormGrid cols={2}>
            <TextField label="Erste Erinnerung (Stunden vorher)" type="number" min={2} max={72} value={form.upcoming_early_hours}
              onChange={(value) => set("upcoming_early_hours", value)} hint="Vorgabe 24" disabled={!canEdit || !form.upcoming} testId="reminder-rules-early" />
            <TextField label="Zweite Erinnerung (Minuten vorher)" type="number" min={30} max={720} value={form.upcoming_late_minutes}
              onChange={(value) => set("upcoming_late_minutes", value)} hint="Vorgabe 60" disabled={!canEdit || !form.upcoming} testId="reminder-rules-late" />
          </FormGrid>
        </Kind>
        <Kind label="Termin noch offen" checked={form.unscheduled} onChange={(value) => set("unscheduled", value)} testId="reminder-rules-unscheduled" disabled={!canEdit}
          hint="An beide Captains, solange kein Termin vereinbart ist. Ohne Einigung gilt der Standardtermin.">
          <FormGrid cols={2}>
            <TextField label="Zeitpunkt in der Spielwoche (%)" type="number" min={10} max={90} value={form.unscheduled_week_percent}
              onChange={(value) => set("unscheduled_week_percent", value)} hint="50 = Wochenmitte (Vorgabe)" disabled={!canEdit || !form.unscheduled}
              testId="reminder-rules-week-percent" />
            <TextField label="Spätestens vor dem Standardtermin (Stunden)" type="number" min={1} max={168}
              value={form.unscheduled_hours_before_default} onChange={(value) => set("unscheduled_hours_before_default", value)}
              hint="liegt er früher in der Woche; Vorgabe 24" disabled={!canEdit || !form.unscheduled} testId="reminder-rules-before-default" />
          </FormGrid>
        </Kind>
        <Kind label="Ergebnis fehlt" checked={form.result_missing} onChange={(value) => set("result_missing", value)} testId="reminder-rules-result" disabled={!canEdit}
          hint={`An beide Captains${resultHours ? `, ${resultHours} h nach dem Termin (einstellbar oben unter „Termine und Verschiebungen“)` : ""}. Wartet, solange ein Vorfall oder Verfahren offen ist.`} />
        <Kind label="Map-Veto wartet" checked={form.veto_turn} onChange={(value) => set("veto_turn", value)} testId="reminder-rules-veto" disabled={!canEdit}
          hint={`An die Seite am Zug, wenn sie das Veto gerade nicht offen hat – einmal je Schritt.${stepSeconds ? ` Zeit je Schritt in dieser Season: ${stepSeconds} Sekunden.` : ""}`}>
          <FormGrid cols={2}>
            <TextField label="Nach Sekunden ohne Zug" type="number" min={5} max={300} value={form.veto_idle_seconds}
              onChange={(value) => set("veto_idle_seconds", value)} hint="Vorgabe 20" disabled={!canEdit || !form.veto_turn} testId="reminder-rules-veto-idle" />
            <TextField label="Nicht in den letzten Sekunden" type="number" min={0} max={120} value={form.veto_min_left_seconds}
              onChange={(value) => set("veto_min_left_seconds", value)} hint="Vorgabe 5" disabled={!canEdit || !form.veto_turn} testId="reminder-rules-veto-left" />
          </FormGrid>
          {misfit ? <p className="mt-2 text-sm text-warn" data-testid="reminder-rules-veto-misfit">{misfit}</p> : null}
        </Kind>
      </div>
      <Kind label="Zusätzlich per Discord" checked={form.discord} onChange={(value) => set("discord", value)} testId="reminder-rules-discord" disabled={!canEdit}
        hint="Direktnachricht vom Vereins-Bot – nur an alle, die Discord in ihren Einstellungen eingeschaltet haben. Keine Funktion hängt an Discord." />
      {error ? <p className="text-sm text-warn" role="alert" data-testid="reminder-rules-error">{error}</p> : null}
      {canEdit ? (
        <button type="button" onClick={save} disabled={saving} data-testid="reminder-rules-save"
          className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {saving ? "Speichere …" : "Erinnerungen speichern"}
        </button>
      ) : null}
    </FormSection>
  );
}
