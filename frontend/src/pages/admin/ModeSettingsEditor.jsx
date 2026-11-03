// Freie Einstellungen und Regeltext je Spielmodus (#2271, docs/LIGA.md C.1): je Zeile Gruppe, Bezeichnung, Einheit und Wert,
// Reihenfolge mit Pfeilen. Am Modus (Reiter Modi der Spielseite) und an der Season (Kopie, Ergebnisregeln) dieselbe Fläche - die
// Season zeigt je Zeile „weicht vom Spiel ab“ (`diff`). Umrechnen und Prüfen in lib/modeSettings.js.
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import {
  MODE_RULES_TEXT_MAX, MODE_SETTINGS_MAX, SETTING_GROUP_MAX, SETTING_LABEL_MAX, SETTING_TEXT_MAX, SETTING_UNITS, emptySetting, moveRow,
} from "@/lib/modeSettings";

const ICON_BUTTON = "p-2 text-white/45 hover:text-[#29B6E8] disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";
const VALUE_HINTS = { seconds: "Sekunden oder 1:30", minutes: "z. B. 5", points: "z. B. 250" };
const DIFF_WORDS = { changed: "weicht vom Spiel ab", added: "nur in der Season" };

function ValueField({ row, onChange, testId }) {
  if (row.unit === "toggle") {
    return <CheckField label="an" checked={Boolean(row.value)} onChange={(value) => onChange({ value })} testId={testId} className="md:mt-6" />;
  }
  return (
    <TextField label="Wert" value={row.value} onChange={(value) => onChange({ value })} maxLength={SETTING_TEXT_MAX}
      placeholder={VALUE_HINTS[row.unit] || "z. B. klein"} testId={testId} />
  );
}

export function ModeSettingsEditor({ value, onChange, diff = {}, testPrefix = "mode-settings" }) {
  const rows = value?.settings || [];
  const setRows = (next) => onChange({ ...value, settings: next });
  const setRow = (index, patch) => setRows(rows.map((row, at) => {
    if (at !== index) return row;
    const next = { ...row, ...patch };
    // Neue Einheit: an/aus braucht einen Wahrheitswert, alles andere Text im Feld.
    if (patch.unit !== undefined && (patch.unit === "toggle") !== (row.unit === "toggle")) next.value = patch.unit === "toggle" ? false : "";
    return next;
  }));
  const text = String(value?.rules_text || "");
  return (
    <div className="space-y-3" data-testid={testPrefix}>
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Einstellungen</legend>
        {rows.length ? (
          <ol className="space-y-2">
            {rows.map((row, index) => {
              const changed = row.key ? diff[row.key] : "";
              return (
                <li key={row.key || `neu-${index}`} data-testid={`${testPrefix}-row-${index}`}
                  className={`rounded-sm border bg-white/[0.02] p-2 ${changed ? "border-warn/40" : "border-white/10"}`}>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-[8rem_minmax(0,1fr)_7.5rem_minmax(0,10rem)_auto] md:items-end">
                    <TextField label="Gruppe" value={row.group} maxLength={SETTING_GROUP_MAX} onChange={(group) => setRow(index, { group })}
                      placeholder="z. B. Lobby" testId={`${testPrefix}-group-${index}`} />
                    <TextField label="Bezeichnung" value={row.label} maxLength={SETTING_LABEL_MAX} onChange={(label) => setRow(index, { label })}
                      placeholder="z. B. Rundenzeit" testId={`${testPrefix}-label-${index}`} />
                    <SelectField label="Einheit" value={row.unit} options={SETTING_UNITS} onChange={(unit) => setRow(index, { unit })}
                      testId={`${testPrefix}-unit-${index}`} />
                    <ValueField row={row} onChange={(patch) => setRow(index, patch)} testId={`${testPrefix}-value-${index}`} />
                    <div className="col-span-2 flex items-center justify-end md:col-span-1">
                      <button type="button" className={ICON_BUTTON} disabled={index === 0} onClick={() => setRows(moveRow(rows, index, -1))}
                        aria-label={`Einstellung ${index + 1} nach oben`} data-testid={`${testPrefix}-up-${index}`}>
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" className={ICON_BUTTON} disabled={index === rows.length - 1} onClick={() => setRows(moveRow(rows, index, 1))}
                        aria-label={`Einstellung ${index + 1} nach unten`} data-testid={`${testPrefix}-down-${index}`}>
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" className={ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live")} onClick={() => setRows(rows.filter((_, at) => at !== index))}
                        aria-label={`Einstellung ${index + 1} entfernen`} data-testid={`${testPrefix}-remove-${index}`}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {changed ? <p className="mt-1 text-[11px] font-bold text-warn" data-testid={`${testPrefix}-diff-${index}`}>{DIFF_WORDS[changed]}</p> : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-white/45" data-testid={`${testPrefix}-empty`}>Noch keine. Etwa Lobby-Einstellungen, die für jedes Spiel gelten.</p>
        )}
        <button type="button" onClick={() => setRows([...rows, emptySetting()])} disabled={rows.length >= MODE_SETTINGS_MAX}
          className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
          data-testid={`${testPrefix}-add`}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Einstellung hinzufügen
        </button>
      </fieldset>
      <TextAreaField label="Eigene Regeln" rows={2} value={text} onChange={(rules_text) => onChange({ ...value, rules_text: rules_text.slice(0, MODE_RULES_TEXT_MAX) })}
        placeholder="z. B. Die Uhr läuft nur, solange keine Seite die Zone hält."
        hint={`Kurz, steht im Regelwerk unter dem Modus. ${text.length} / ${MODE_RULES_TEXT_MAX} Zeichen`} testId={`${testPrefix}-rules`} />
    </div>
  );
}
