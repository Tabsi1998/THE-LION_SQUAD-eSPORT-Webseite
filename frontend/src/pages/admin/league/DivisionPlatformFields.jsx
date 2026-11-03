// Plattform je Season (#2270): die Abweichung einer Liga N im Liga-N-Blatt - eigene Plattformen, Crossplay, Eingabegerät. Leer heißt
// „wie Season“; die Werte reisen mit den übrigen Abweichungen (`overridesPayload`) zum Server.
import { useEffect, useState } from "react";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, SelectField } from "@/components/tls/FormFields";
import { api } from "@/lib/api";
import { CROSSPLAY_OPTIONS, INPUT_DEVICE_OPTIONS, platformShort } from "@/lib/leaguePlatform";
import { PlatformChoices } from "./SeasonPlatformPanel";

function asSeason(options, current) {
  return [["", `wie Season (${current})`], ...options.filter(([key]) => key)];
}

export function DivisionPlatformFields({ form, set, seasonId }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/platform`).then(({ data }) => alive && setState(data)).catch(() => alive && setState(null));
    return () => { alive = false; };
  }, [seasonId]);

  if (!state?.settings) return null;
  const settings = state.settings;
  const field = (state.fields || []).find((row) => row.key === settings.platform_field) || null;
  const crossplayNow = settings.crossplay === true ? "an" : settings.crossplay === false ? "aus" : "keine Angabe";
  const deviceNow = INPUT_DEVICE_OPTIONS.find(([key]) => key === (settings.input_device || ""))?.[1] || "keine Angabe";
  return (
    <fieldset className="min-w-0 space-y-2" data-testid="division-platform">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Plattform</legend>
      <p className="text-xs text-white/55" data-testid="division-platform-season">
        Season: {platformShort({ allowed: field ? settings.allowed_platforms : [], crossplay: settings.crossplay, input_device: settings.input_device })}
      </p>
      {field ? (
        <>
          <CheckField label="Eigene Plattformen für diese Liga" checked={form.platform_own} onChange={(value) => set("platform_own", value)}
            hint="Aus: wie die Season. An und nichts angehakt: in dieser Liga alle Plattformen." className="min-h-[44px]" testId="override-platform-own" />
          {form.platform_own ? (
            <PlatformChoices field={field} value={form.allowed_platforms} onChange={(value) => set("allowed_platforms", value)} testId="override-platforms" />
          ) : null}
        </>
      ) : (
        <p className="text-xs text-white/50">Plattformen eingrenzen geht erst, wenn die Season im Kasten „Plattform und Eingabegerät“ das Feld gewählt hat.</p>
      )}
      <FormGrid cols={2}>
        <SelectField label="Crossplay" value={form.crossplay} onChange={(value) => set("crossplay", value)} options={asSeason(CROSSPLAY_OPTIONS, crossplayNow)}
          testId="override-crossplay" />
        <SelectField label="Eingabegerät" value={form.input_device} onChange={(value) => set("input_device", value)} options={asSeason(INPUT_DEVICE_OPTIONS, deviceNow)}
          testId="override-input" />
      </FormGrid>
    </fieldset>
  );
}
