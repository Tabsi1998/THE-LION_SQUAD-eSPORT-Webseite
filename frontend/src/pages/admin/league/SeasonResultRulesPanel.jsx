// Ergebnisregeln der Season (docs/LIGA.md, C.3, #1617): Die Season hält die Regeln der Modi als Kopie fest - wie den Map-Pool.
// Ändert jemand später die Regel am Modus, bleibt die Season, wie sie ist; hier sieht die Leitung die Abweichung und übernimmt
// bewusst. Dazu „Punkte je Map Pflicht“. Bestehende Staffeln bekommen Änderungen beim Übertragen.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { RESULT_RULE_KINDS, RESULT_TARGET_MAX, resultRuleText } from "@/lib/gameMatchData";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const text = (value) => (value === null || value === undefined ? "" : String(value));
const blank = (value) => String(value ?? "").trim() === "";
const whole = (value) => (blank(value) ? null : Math.trunc(Number(value)));

/** Eine Regel als Formularzeile - leer heißt „keine Regel“. */
function ruleToRow(rule) {
  return {
    kind: text(rule?.kind), target: text(rule?.target), limit: text(rule?.round_limit), time: text(rule?.time_limit_minutes),
    draw: Boolean(rule?.draw_allowed), overtime: Boolean(rule?.overtime),
  };
}

/** Die Zeile als Regel für den Server - dieselbe Form wie am Modus (C.1). */
export function rowToRule(row) {
  if (!row.kind) return null;
  const rule = { kind: row.kind };
  if (row.kind !== "highest") rule.target = whole(row.target);
  if (row.kind === "rounds" && !blank(row.limit)) rule.round_limit = whole(row.limit);
  if (!blank(row.time)) rule.time_limit_minutes = whole(row.time);
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
  if (!blank(row.time) && !(whole(row.time) >= 1 && whole(row.time) <= 600)) return `${where}: Zeitlimit von 1 bis 600 Minuten – oder leer lassen.`;
  return "";
}

// `modes` (Season-Seite #2267): nur diese Modi zeigen - die Modi der Season. Gespeichert werden weiter die Regeln aller Modi.
export function SeasonResultRulesPanel({ seasonId, canEdit = true, onSaved, modes }) {
  const [data, setData] = useState(null);
  const [rows, setRows] = useState({});
  const [required, setRequired] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/result-rules`);
      const rules = Array.isArray(body?.rules) ? body.rules : [];
      setData({ ...body, rules });
      setRows(Object.fromEntries(rules.map((row) => [row.mode, ruleToRow(row.season_rule)])));
      setRequired(Boolean(body?.scores_required));
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["leagues"]);

  const set = (mode, patch) => setRows((current) => ({ ...current, [mode]: { ...current[mode], ...patch } }));

  const save = async () => {
    for (const row of data.rules) {
      const problem = rowProblem(rows[row.mode], row.label);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError("");
    setSaving(true);
    try {
      const rules = Object.fromEntries(data.rules.map((row) => [row.mode, rowToRule(rows[row.mode])]).filter(([, rule]) => rule));
      const { data: saved } = await api.put(`/admin/leagues/seasons/${seasonId}/result-rules`, { scores_required: required, rules });
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
        {data.rules.filter((row) => !modes || modes.includes(row.mode)).map((row) => {
          const form = rows[row.mode] || ruleToRow(null);
          const id = `result-rules-${row.mode}`;
          return (
            <li key={row.mode} className="min-w-0 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold text-white">{row.label}{row.status !== "active" ? <span className="ml-2 text-xs font-normal text-white/50">({row.status === "removed" ? "dem Spiel entfernt" : row.status === "inactive" ? "inaktiv" : "archiviert"})</span> : null}</span>
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
                      <TextField label="Zeitlimit (Min.)" type="number" min={1} max={600} value={form.time} onChange={(value) => set(row.mode, { time: value })} hint="leer: Map endet nur beim Ziel" testId={`${id}-time`} />
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
