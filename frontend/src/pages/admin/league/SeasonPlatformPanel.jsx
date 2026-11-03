// Plattform je Season (#2270, docs/LIGA.md B.3 „Plattform je Season“): welches ID-Feld des Spiels die Plattform trägt, welche
// Plattformen erlaubt sind, Crossplay und Eingabegerät. Eigener Kasten mit eigenem Speichern - er zieht mit der neuen Season-Seite
// (#2267) in den Reiter „Anmeldung und Kader“. Die Abweichung einer Liga N steht im Liga-N-Blatt (DivisionPlatformFields).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatApiError } from "@/lib/api";
import { CROSSPLAY_OPTIONS, INPUT_DEVICE_OPTIONS, platformPayload, platformShort, platformToForm } from "@/lib/leaguePlatform";

const BOX = "rounded-sm border px-3 py-2 text-sm [overflow-wrap:anywhere]";

/** Die Plattformen eines Felds zum Anhaken - geteilt mit dem Liga-N-Blatt. */
export function PlatformChoices({ field, value = [], onChange, testId, disabled }) {
  const picked = new Set(value);
  const toggle = (option, on) => onChange((field.options || []).filter((item) => (item === option ? on : picked.has(item))));
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1" data-testid={testId}>
      {(field.options || []).map((option) => (
        <CheckField key={option} label={(field.retired || []).includes(option) ? `${option} (nicht mehr am Spiel)` : option} checked={picked.has(option)}
          onChange={(on) => toggle(option, on)} disabled={disabled} className="min-h-[44px] py-2" testId={`${testId}-${option}`} />
      ))}
    </div>
  );
}

export function SeasonPlatformPanel({ seasonId, canEdit = true }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (withForm) => {
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/platform`);
      if (!data?.settings) return;
      setState(data);
      if (withForm) setForm(platformToForm(data.settings));
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Plattform konnte nicht geladen werden.");
    }
  }, [seasonId]);

  useEffect(() => { load(true); }, [load]);
  // Liga N geändert (Liga-N-Blatt): nur die Übersicht neu, die Eingabe bleibt.
  useApiInvalidation(() => load(false), ["leagues"]);

  if (!form || !state) {
    return error ? <p className="text-sm text-warn" role="alert" data-testid="season-platform-error">{error}</p> : null;
  }
  const fields = state.fields || [];
  const field = fields.find((row) => row.key === form.platform_field) || null;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const chooseField = (key) => setForm((current) => ({ ...current, platform_field: key, allowed_platforms: key === state.settings.platform_field ? current.allowed_platforms : [] }));
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/admin/leagues/seasons/${seasonId}/platform`, platformPayload(form, field?.options || []));
      setState(data);
      setForm(platformToForm(data.settings));
      toast.success("Plattform gespeichert – gilt sofort für Anmeldung, Zuteilen und Teilnehmerliste.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Plattform konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };
  const allTicked = field && form.allowed_platforms.length === field.options.length;

  return (
    <FormSection title="Plattform und Eingabegerät" testId="season-platform"
      hint="Wer auf welcher Plattform spielen darf. Gilt sofort, auch in laufenden Staffeln, für Anmeldung, Zuteilen und Teilnehmerliste. Liga N kann abweichen.">
      {state.field_missing ? (
        <p className={`${BOX} border-warn/40 bg-warn/5 text-warn`} role="alert" data-testid="season-platform-field-missing">
          Das gewählte Feld gibt es am Spiel nicht mehr. Bis ein anderes gewählt ist, prüft diese Season keine Plattform.
        </p>
      ) : null}
      {!fields.length ? (
        <p className={`${BOX} border-white/10 bg-white/[0.03] text-white/70`} data-testid="season-platform-no-field">
          {state.game?.name || "Das Spiel"} hat kein Spiel-ID-Feld mit Auswahl. Lege in der Spielverwaltung unter „Spiel-IDs“ ein Feld wie „Plattform“ mit
          den Auswahlwerten an – dann lassen sich hier Plattformen eingrenzen. Crossplay und Eingabegerät gehen auch ohne.
        </p>
      ) : (
        <SelectField label="In welchem Feld steht die Plattform?" value={form.platform_field} onChange={chooseField} disabled={!canEdit}
          options={[["", "kein Feld – keine Prüfung"], ...fields.map((row) => [row.key, row.label])]}
          hint="Ein Spiel-ID-Feld mit Auswahl. Die Spieler tragen den Wert im Profil ein." testId="season-platform-field" />
      )}
      {field ? (
        <fieldset className="min-w-0 space-y-1">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Erlaubte Plattformen</legend>
          <PlatformChoices field={field} value={form.allowed_platforms} onChange={(value) => set("allowed_platforms", value)} disabled={!canEdit}
            testId="season-platform-allowed" />
          <p className="text-xs text-white/50" data-testid="season-platform-allowed-hint">
            {!form.allowed_platforms.length ? "Nichts angehakt: alle Plattformen erlaubt, keine Prüfung."
              : allTicked ? "Alle angehakt: jede Plattform erlaubt, die Angabe im Profil ist aber Pflicht."
                : "Wer eine andere oder keine Plattform angibt, ist nicht spielberechtigt und bekommt den Grund im Klartext."}
            {field.required ? " Das Feld ist Pflicht: Die Plattform wird mit der Spiel-ID für die Season festgehalten."
              : " Das Feld ist freiwillig: Es zählt der aktuelle Wert im Profil."}
          </p>
        </fieldset>
      ) : null}
      <FormGrid cols={2}>
        <SelectField label="Crossplay" value={form.crossplay} onChange={(value) => set("crossplay", value)} options={CROSSPLAY_OPTIONS} disabled={!canEdit}
          hint="Nur Angabe für Regelwerk und Ligaseite, wird nicht geprüft." testId="season-platform-crossplay" />
        <SelectField label="Eingabegerät" value={form.input_device} onChange={(value) => set("input_device", value)} options={INPUT_DEVICE_OPTIONS} disabled={!canEdit}
          hint="Nur Angabe fürs Regelwerk, nicht prüfbar." testId="season-platform-input" />
      </FormGrid>
      {state.divisions?.length ? (
        <div className="space-y-1" data-testid="season-platform-divisions">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">So gilt es je Liga</p>
          <ul className="space-y-1 text-sm text-white/75">
            {state.divisions.map((row) => (
              <li key={row.id} className="flex min-w-0 flex-wrap gap-x-2" data-testid={`season-platform-division-${row.id}`}>
                <span className="font-bold text-white">{row.label}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{platformShort(row.effective)}</span>
                <span className="text-xs text-white/45">{Object.keys(row.overrides || {}).length ? "weicht ab" : "wie Season"}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/45">Abweichen stellst du bei der Liga ein (Stift bei „Liga N“). Gespeicherter Stand – nach dem Speichern oben neu.</p>
        </div>
      ) : null}
      {error ? <p className="text-sm text-warn" role="alert" data-testid="season-platform-error">{error}</p> : null}
      {canEdit ? (
        <button type="button" onClick={save} disabled={saving} data-testid="season-platform-save"
          className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {saving ? "Speichere …" : "Plattform speichern"}
        </button>
      ) : null}
    </FormSection>
  );
}
