// Plattform je Season (#2270, docs/LIGA.md B.3 „Plattform je Season“): welches ID-Feld des Spiels die Plattform trägt, welche
// Plattformen erlaubt sind, Crossplay und Eingabegerät. Ein Abschnitt im Formular des Reiters „Anmeldung und Kader“ (#plattform) -
// gespeichert wird mit dem Reiter. Wählbare Felder und was je Liga N gilt kommen von GET …/platform. Die Abweichung einer Liga N steht
// im Liga-N-Blatt (DivisionPlatformFields).
import { useCallback, useEffect, useState } from "react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api } from "@/lib/api";
import { CROSSPLAY_OPTIONS, INPUT_DEVICE_OPTIONS, platformShort } from "@/lib/leaguePlatform";

const BOX = "rounded-sm border px-3 py-2 text-sm [overflow-wrap:anywhere]";

/** Die Plattformen eines Felds zum Anhaken, in der Reihenfolge des Spiels - geteilt mit dem Liga-N-Blatt. */
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

function allowedHint(form, field) {
  const picked = form.allowed_platforms || [];
  const base = !picked.length ? "Nichts angehakt: alle Plattformen erlaubt, keine Prüfung."
    : picked.length === field.options.length ? "Alle angehakt: jede Plattform erlaubt, die Angabe im Profil ist aber Pflicht."
      : "Wer eine andere oder keine Plattform angibt, ist nicht spielberechtigt und bekommt den Grund im Klartext.";
  return `${base}${field.required ? " Das Feld ist Pflicht: Die Plattform wird mit der Spiel-ID für die Season festgehalten."
    : " Das Feld ist freiwillig: Es zählt der aktuelle Wert im Profil."}`;
}

/** Abschnitt „Plattform und Eingabegerät“. ``version``: der gespeicherte Stand der Season - danach lädt die Übersicht je Liga neu. */
export function SeasonPlatformSection({ seasonId, form, set, id, version }) {
  const [state, setState] = useState(null);

  const load = useCallback(() => api.get(`/admin/leagues/seasons/${seasonId}/platform`)
    .then(({ data }) => setState(data?.settings ? data : null)).catch(() => setState(null)), [seasonId]);
  useEffect(() => { load(); }, [load, version]);
  // Liga N im Liga-N-Blatt geändert: nur die Übersicht je Liga neu, die Eingabe bleibt.
  useApiInvalidation(load, ["leagues"]);

  if (!state) return null;
  const fields = state.fields || [];
  const field = fields.find((row) => row.key === form.platform_field) || null;
  const chooseField = (key) => {
    set("platform_field", key);
    set("allowed_platforms", key && key === state.settings.platform_field ? state.settings.allowed_platforms : []);
  };
  const missing = state.field_missing && form.platform_field === state.settings.platform_field;

  return (
    <FormSection title="Plattform und Eingabegerät" testId="season-platform" className="scroll-mt-24" id={id}
      hint="Wer auf welcher Plattform spielen darf. Gilt nach dem Speichern sofort, auch in laufenden Staffeln: Anmeldung, Zuteilen, Teilnehmerliste. Liga N kann abweichen.">
      {missing ? (
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
        <SelectField label="In welchem Feld steht die Plattform?" value={form.platform_field} onChange={chooseField}
          options={[["", "kein Feld – keine Prüfung"], ...fields.map((row) => [row.key, row.label])]}
          hint="Ein Spiel-ID-Feld mit Auswahl. Die Spieler tragen den Wert im Profil ein." testId="season-platform-field" />
      )}
      {field ? (
        <fieldset className="min-w-0 space-y-1">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Erlaubte Plattformen</legend>
          <PlatformChoices field={field} value={form.allowed_platforms} onChange={(value) => set("allowed_platforms", value)} testId="season-platform-allowed" />
          <p className="text-xs text-white/50" data-testid="season-platform-allowed-hint">{allowedHint(form, field)}</p>
        </fieldset>
      ) : null}
      <FormGrid cols={2}>
        <SelectField label="Crossplay" value={form.crossplay} onChange={(value) => set("crossplay", value)} options={CROSSPLAY_OPTIONS}
          hint="Nur Angabe für Regelwerk und Ligaseite, wird nicht geprüft." testId="season-platform-crossplay" />
        <SelectField label="Eingabegerät" value={form.input_device} onChange={(value) => set("input_device", value)} options={INPUT_DEVICE_OPTIONS}
          hint="Nur Angabe fürs Regelwerk, nicht prüfbar." testId="season-platform-input" />
      </FormGrid>
      {state.divisions?.length ? (
        <div className="space-y-1" data-testid="season-platform-divisions">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">So gilt es je Liga (gespeicherter Stand)</p>
          <ul className="space-y-1 text-sm text-white/75">
            {state.divisions.map((row) => (
              <li key={row.id} className="flex min-w-0 flex-wrap gap-x-2" data-testid={`season-platform-division-${row.id}`}>
                <span className="font-bold text-white">{row.label}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{platformShort(row.effective)}</span>
                <span className="text-xs text-white/45">{Object.keys(row.overrides || {}).length ? "weicht ab" : "wie Season"}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/45">Abweichen stellst du bei der Liga ein: Reiter „Ligen und Staffeln“, Stift bei der Liga.</p>
        </div>
      ) : null}
    </FormSection>
  );
}
