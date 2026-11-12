import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { FormGrid } from "@/components/tls/AdminForm";
import {
  EXIT_RULE_OPTIONS, FORFEIT_SCORE_OPTIONS, HEAD_TO_HEAD_LABELS, POINTS_MODE_OPTIONS, TIEBREAK_KEYS, TIEBREAK_LABELS, pointsModeChange,
} from "@/lib/leagueTable";

// Tabellenregeln je Season (E.1, #1625, docs/LIGA.md „E.1 Tabelle“): Reihenfolge bei Punktgleichheit, Mini-Tabelle,
// Remis, Default-Win und Ausscheiden. Alles Vorgaben - wirken auf Staffeln erst beim Übertragen (vor dem ersten Ergebnis).

function OrderedChips({ legend, labels, keys, value, onChange, hint, testPrefix }) {
  const toggle = (key) => onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key]);
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {keys.map((key) => {
          const position = value.indexOf(key);
          return (
            <label key={key} className={`inline-flex min-h-[40px] items-center gap-2 rounded-sm border px-3 py-1.5 text-xs cursor-pointer select-none focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8] ${position >= 0 ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/65"}`}>
              <input type="checkbox" checked={position >= 0} onChange={() => toggle(key)} className="accent-[#29B6E8]" data-testid={`${testPrefix}-${key}`} />
              {position >= 0 ? <span className="font-bold tabular-nums text-[#29B6E8]">{position + 1}.</span> : null}
              {labels[key]}
            </label>
          );
        })}
      </div>
      {hint ? <p className="text-xs text-white/45">{hint}</p> : null}
    </fieldset>
  );
}

/** Punkteart und Punkte (#2312): Sieg/Remis/Niederlage oder je gewonnene Map. Der Wechsel auf Map-Punkte schlägt die
 *  Reihenfolge bei Punktgleichheit und „kampflos wie 3:0“ vor - beides bleibt änderbar. */
export function SeasonPointsFields({ form, set }) {
  const maps = form.match_points_mode === "maps";
  const change = (mode) => {
    if (mode === form.match_points_mode) return;
    for (const [key, value] of Object.entries(pointsModeChange(mode))) set(key, value);
  };
  return (
    <div className="space-y-3">
      <SelectField label="Punkteart" value={form.match_points_mode || "result"} onChange={change} options={POINTS_MODE_OPTIONS} testId="season-form-points-mode"
        hint={maps
          ? "Jede Seite bekommt so viele Punkte, wie sie Maps gewonnen hat: 3:2 ergibt 3 und 2, kampflos 3:0. Reihenfolge unten ist ein Vorschlag."
          : "Feste Punkte für Sieg, Remis und Niederlage."} />
      {maps ? null : (
        <FormGrid cols={3}>
          <TextField label="Punkte Sieg" type="number" step="any" value={form.points_win} onChange={(value) => set("points_win", value)} testId="season-form-points-win" />
          <TextField label="Remis" type="number" step="any" value={form.points_draw} onChange={(value) => set("points_draw", value)} testId="season-form-points-draw" />
          <TextField label="Niederlage" type="number" step="any" value={form.points_loss} onChange={(value) => set("points_loss", value)} testId="season-form-points-loss" />
        </FormGrid>
      )}
    </div>
  );
}

export function SeasonTableRules({ form, set }) {
  const headToHead = form.table_tiebreakers.includes("head_to_head");
  const maps = form.match_points_mode === "maps";
  return (
    <div className="space-y-4" data-testid="season-table-rules">
      <OrderedChips legend="Bei Punktgleichheit" labels={TIEBREAK_LABELS} keys={TIEBREAK_KEYS} value={form.table_tiebreakers}
        onChange={(value) => set("table_tiebreakers", value)} testPrefix="tiebreaker"
        hint="In der Reihenfolge des Anklickens. Zuerst zählen immer die Punkte. Ohne „Entscheid der Leitung“ teilen sich Teams bei echtem Gleichstand den Platz." />
      {headToHead ? (
        <OrderedChips legend="Direkter Vergleich (Mini-Tabelle)" labels={HEAD_TO_HEAD_LABELS} keys={Object.keys(HEAD_TO_HEAD_LABELS)}
          value={form.head_to_head_criteria} onChange={(value) => set("head_to_head_criteria", value)} testPrefix="head-to-head"
          hint="Nur die Spiele der gleichstehenden Teams untereinander. Bleibt danach eine Restgruppe, wird ihre Mini-Tabelle neu gerechnet; dann zählen die Gesamtwerte." />
      ) : null}
      <FormGrid cols={2}>
        <SelectField label="Kampflos (Default-Win)" value={maps ? "best_of" : form.forfeit_score} onChange={(value) => set("forfeit_score", value)} options={FORFEIT_SCORE_OPTIONS}
          disabled={maps}
          hint={maps ? "Mit Map-Punkten zählt kampflos immer wie die Maps des Best of (BO5 3:0)." : "Maps, die ein kampfloser Sieg zählt. Die Tabelle markiert ihn als „kampflos“."}
          testId="season-form-forfeit-score" />
        <SelectField label="Austritt, Auflösung, Disqualifikation" value={form.exit_rule} onChange={(value) => set("exit_rule", value)} options={EXIT_RULE_OPTIONS}
          hint="Echte Ergebnisse bleiben im Spielplan sichtbar. Disqualifizierte stehen immer unter Ausgetretenen." testId="season-form-exit-rule" />
      </FormGrid>
      <CheckField label="Remis erlaubt" checked={form.allow_draws} onChange={(value) => set("allow_draws", value)} testId="season-form-allow-draws"
        hint="Aus: Best-of-Serien ohne Remis, die Tabelle zeigt keine Spalte „U“. Beide nicht erschienen zählt für beide als Niederlage." />
    </div>
  );
}
