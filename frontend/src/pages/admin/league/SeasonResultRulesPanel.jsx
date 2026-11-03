// Ergebnisregeln der Season (docs/LIGA.md, C.3, #1617): Die Season hält die Regeln der Modi als Kopie fest - wie den Map-Pool.
// Ändert jemand später die Regel am Modus, bleibt die Season, wie sie ist; hier sieht die Leitung die Abweichung und übernimmt
// bewusst. Dazu „Punkte je Map Pflicht“. Bestehende Staffeln bekommen Änderungen beim Übertragen.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { RESULT_RULE_KINDS, RESULT_TARGET_MAX, resultRuleText } from "@/lib/gameMatchData";
import {
  ROUND_TIME_SECONDS_MAX, TIME_LIMIT_SECONDS_MAX, durationInput, entryPayload, entryToForm, parseDuration, ruleTimeLimitSeconds, settingProblem,
  settingValueText, settingsDiff, settingsMissing,
} from "@/lib/modeSettings";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ModeSettingsEditor } from "../ModeSettingsEditor";

const text = (value) => (value === null || value === undefined ? "" : String(value));
const blank = (value) => String(value ?? "").trim() === "";
const whole = (value) => (blank(value) ? null : Math.trunc(Number(value)));

/** Eine Regel als Formularzeile - leer heißt „keine Regel“. Zeiten als „10“ (Minuten) oder „1:30“ (#2271). */
export function ruleToRow(rule) {
  return {
    kind: text(rule?.kind), target: text(rule?.target), limit: text(rule?.round_limit), time: durationInput(ruleTimeLimitSeconds(rule)),
    round: durationInput(rule?.round_time_seconds), draw: Boolean(rule?.draw_allowed), overtime: Boolean(rule?.overtime),
  };
}

/** Die Zeile als Regel für den Server - dieselbe Form wie am Modus (C.1), Zeiten in Sekunden. */
export function rowToRule(row) {
  if (!row.kind) return null;
  const rule = { kind: row.kind };
  if (row.kind !== "highest") rule.target = whole(row.target);
  if (row.kind === "rounds" && !blank(row.limit)) rule.round_limit = whole(row.limit);
  if (!blank(row.time)) rule.time_limit_seconds = parseDuration(row.time);
  if (!blank(row.round)) rule.round_time_seconds = parseDuration(row.round);
  rule.draw_allowed = row.draw;
  rule.overtime = row.overtime;
  return rule;
}

/** Was an einer Zeile nicht passt - dieselben Grenzen wie `GameModeResultRule` im Backend. */
export function rowProblem(row, label) {
  if (!row.kind) return "";
  const where = `Modus „${label}“`;
  const target = whole(row.target);
  if (row.kind !== "highest" && (target === null || !(target >= 1 && target <= RESULT_TARGET_MAX))) return `${where}: Ziel von 1 bis 100.000.`;
  if (row.kind === "rounds" && !blank(row.limit)) {
    const limit = whole(row.limit);
    if (!(limit >= 1 && limit <= 999)) return `${where}: Rundenlimit von 1 bis 999 – oder leer lassen.`;
    if (limit < target) return `${where}: Das Rundenlimit (${limit}) ist kleiner als das Ziel (${target}).`;
  }
  if (!blank(row.time)) {
    const time = parseDuration(row.time);
    if (!time || time > TIME_LIMIT_SECONDS_MAX) return `${where}: Zeitlimit als Minuten:Sekunden (z. B. 1:30, 90 s oder 10) bis 600 Minuten – oder leer lassen.`;
  }
  if (!blank(row.round)) {
    const round = parseDuration(row.round);
    if (!round || round > ROUND_TIME_SECONDS_MAX) return `${where}: Zeit je Runde als Minuten:Sekunden (z. B. 1:45) bis 60 Minuten – oder leer lassen.`;
  }
  return "";
}

/** Was an den Einstellungen der Season für einen Modus nicht passt (#2271). */
function settingsRowProblem(form, label) {
  for (const row of (form?.settings || []).filter((item) => !blank(item.label) || !blank(item.value))) {
    const problem = settingProblem(row);
    if (problem) return `Modus „${label}“: ${problem}`;
  }
  return "";
}

/** Je Modus, was die Season an Einstellungen speichert - `null` heißt keine. */
export function settingsPayload(rows, forms) {
  return Object.fromEntries(rows.map((row) => [row.mode, entryPayload(forms[row.mode])]));
}

// Je Modus die Einstellungen der Season: Abweichungen markiert, „Vom Spiel übernehmen“ holt die des Spiels.
function SeasonModeSettings({ row, form, onChange, canEdit, id }) {
  const own = entryPayload(form);
  const diff = settingsDiff(own || {}, row.game_settings || {});
  const missing = settingsMissing(own || {}, row.game_settings || {});
  const textDiffers = String(own?.rules_text || "") !== String(row.game_settings?.rules_text || "");
  const differs = Object.keys(diff).length > 0 || missing.length > 0 || textDiffers;
  if (!canEdit) {
    if (!own) return null;
    return (
      <ul className="mt-2 space-y-0.5 text-xs text-white/70" data-testid={`${id}-settings-read`}>
        {(own.settings || []).map((setting) => (
          <li key={setting.key || setting.label}>{setting.group ? `${setting.group} · ` : ""}{setting.label}: {settingValueText(setting)}</li>
        ))}
        {own.rules_text ? <li className="text-white/55">{own.rules_text}</li> : null}
      </ul>
    );
  }
  return (
    <details className="group mt-3 rounded-sm border border-white/10 bg-white/[0.02]" open={differs || undefined} data-testid={`${id}-settings`}>
      <summary className="tls-hit flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white/65 [&::-webkit-details-marker]:hidden">
        Einstellungen und eigene Regeln
        <span className="normal-case tracking-normal font-semibold text-white/45">{(own?.settings || []).length} Einstellungen</span>
        {differs ? <span className="normal-case tracking-normal text-warn" data-testid={`${id}-settings-differs`}>weicht vom Spiel ab</span> : null}
      </summary>
      <div className="space-y-3 border-t border-white/10 p-3">
        <ModeSettingsEditor value={form} onChange={onChange} diff={diff} testPrefix={`${id}-settings`} />
        {missing.length ? (
          <p className="text-xs text-warn" data-testid={`${id}-settings-missing`}>Das Spiel hat dazu: {missing.map((setting) => setting.label).join(", ")}.</p>
        ) : null}
        {differs && row.game_settings ? (
          <button type="button" onClick={() => onChange(entryToForm(row.game_settings))} data-testid={`${id}-settings-adopt`}
            className="tls-btn tls-btn--quiet rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">Einstellungen vom Spiel übernehmen</button>
        ) : null}
      </div>
    </details>
  );
}

export function SeasonResultRulesPanel({ seasonId, canEdit = true, onSaved }) {
  const [data, setData] = useState(null);
  const [rows, setRows] = useState({});
  const [settings, setSettings] = useState({});
  const [settingsTouched, setSettingsTouched] = useState(false);
  const [required, setRequired] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/result-rules`);
      const rules = Array.isArray(body?.rules) ? body.rules : [];
      setData({ ...body, rules });
      setRows(Object.fromEntries(rules.map((row) => [row.mode, ruleToRow(row.season_rule)])));
      // Ältere Seasons ohne Kopie (`settings_held: false`) zeigen die Werte des Spiels - gespeichert wird erst, wenn jemand etwas ändert.
      setSettings(Object.fromEntries(rules.map((row) => [row.mode, entryToForm(body?.settings_held ? row.season_settings : row.game_settings)])));
      setSettingsTouched(false);
      setRequired(Boolean(body?.scores_required));
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["leagues"]);

  const set = (mode, patch) => setRows((current) => ({ ...current, [mode]: { ...current[mode], ...patch } }));
  const setModeSettings = (mode, next) => {
    setSettings((current) => ({ ...current, [mode]: next }));
    setSettingsTouched(true);
  };

  const save = async () => {
    for (const row of data.rules) {
      const problem = rowProblem(rows[row.mode], row.label) || settingsRowProblem(settings[row.mode], row.label);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError("");
    setSaving(true);
    try {
      const rules = Object.fromEntries(data.rules.map((row) => [row.mode, rowToRule(rows[row.mode])]).filter(([, rule]) => rule));
      const body = { scores_required: required, rules };
      if (data.settings_held || settingsTouched) body.settings = settingsPayload(data.rules, settings);
      const { data: saved } = await api.put(`/admin/leagues/seasons/${seasonId}/result-rules`, body);
      toast.success(saved.changed ? "Ergebnisregeln gespeichert." : "Keine Änderung.");
      onSaved?.(saved.staffeln_to_sync || 0);
      await load();
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
    setSaving(false);
  };

  if (!data) return error ? <p className="text-sm text-warn" role="alert" data-testid="result-rules-error">{error}</p> : null;
  return (
    <FormSection title="Ergebnisregeln" testId="season-result-rules"
      hint="Die Season hält die Regel je Modus fest. Ändert jemand später die Regel am Spiel, bleibt die Season, wie sie ist – übernehmen ist ein eigener Schritt. Die Meldung prüft jeden Endstand gegen die Regel.">
      <CheckField label="Punkte je Map Pflicht – jede Map bekommt ihren Endstand" checked={required} onChange={setRequired} disabled={!canEdit} testId="result-rules-required" />
      {!data.rules.length ? <p className="text-sm text-white/55">Das Spiel hat keine Modi – es gibt nichts einzustellen.</p> : null}
      <ul className="space-y-3">
        {data.rules.map((row) => {
          const form = rows[row.mode] || ruleToRow(null);
          const id = `result-rules-${row.mode}`;
          return (
            <li key={row.mode} className="min-w-0 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-2 font-bold text-white"><ModeIcon src={row.icon_url} size="sm" testId={`${id}-icon`} />{row.label}{row.status !== "active" ? <span className="ml-2 text-xs font-normal text-white/50">({row.status === "removed" ? "dem Spiel entfernt" : row.status === "inactive" ? "inaktiv" : "archiviert"})</span> : null}</span>
                {row.differs ? <span className="text-xs font-bold text-warn" data-testid={`${id}-differs`}>weicht vom Spiel ab</span> : null}
              </div>
              <p className="mt-1 text-xs text-white/55 [overflow-wrap:anywhere]" data-testid={`${id}-game`}>Spiel: {resultRuleText(row.game_rule) || "keine Regel"}</p>
              {canEdit ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <SelectField label="Art" value={form.kind} onChange={(value) => set(row.mode, { kind: value })} options={RESULT_RULE_KINDS} testId={`${id}-kind`} />
                    {form.kind && form.kind !== "highest" ? (
                      <TextField label={form.kind === "rounds" ? "Rundensiege zum Sieg" : "Zielpunkte"} type="number" min={1} max={RESULT_TARGET_MAX} value={form.target} onChange={(value) => set(row.mode, { target: value })} testId={`${id}-target`} />
                    ) : null}
                    {form.kind === "rounds" ? (
                      <TextField label="Höchstens Runden" type="number" min={1} max={999} value={form.limit} onChange={(value) => set(row.mode, { limit: value })} hint="leer: kein Limit" testId={`${id}-limit`} />
                    ) : null}
                    {form.kind ? (
                      <TextField label="Zeitlimit je Map" value={form.time} onChange={(value) => set(row.mode, { time: value })} placeholder="z. B. 10 oder 1:30"
                        hint="Minuten, 1:30 oder 90 s; leer: Map endet nur beim Ziel" testId={`${id}-time`} />
                    ) : null}
                    {form.kind ? (
                      <TextField label="Zeit je Runde" value={form.round} onChange={(value) => set(row.mode, { round: value })} placeholder="z. B. 1:45"
                        hint="Nur Angabe für Regelwerk und Anzeige" testId={`${id}-round-time`} />
                    ) : null}
                  </div>
                  {form.kind ? (
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <CheckField label="Remis möglich" checked={form.draw} onChange={(value) => set(row.mode, { draw: value })} testId={`${id}-draw`} />
                      <CheckField label="Verlängerung (Ziel darf überschritten werden)" checked={form.overtime} onChange={(value) => set(row.mode, { overtime: value })} testId={`${id}-overtime`} />
                    </div>
                  ) : null}
                  {row.differs && row.game_rule ? (
                    <button type="button" onClick={() => set(row.mode, ruleToRow(row.game_rule))} data-testid={`${id}-adopt`}
                      className="tls-btn tls-btn--quiet rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">Vom Spiel übernehmen</button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-xs text-white/75" data-testid={`${id}-season`}>Season: {resultRuleText(row.season_rule) || "keine Regel"}</p>
              )}
              <SeasonModeSettings row={row} form={settings[row.mode] || entryToForm(null)} onChange={(next) => setModeSettings(row.mode, next)}
                canEdit={canEdit} id={id} />
            </li>
          );
        })}
      </ul>
      {error ? <p className="text-sm text-warn" role="alert" data-testid="result-rules-error">{error}</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={saving} data-testid="result-rules-save"
            className="tls-btn tls-btn--primary rounded-sm px-5 py-2.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            {saving ? "Speichere …" : "Ergebnisregeln speichern"}
          </button>
          {data.staffeln ? <span className="text-xs text-white/50">Bestehende Staffeln übernehmen Änderungen beim Übertragen – auch nach dem ersten Ergebnis, nicht gesperrte.</span> : null}
        </div>
      ) : null}
    </FormSection>
  );
}
