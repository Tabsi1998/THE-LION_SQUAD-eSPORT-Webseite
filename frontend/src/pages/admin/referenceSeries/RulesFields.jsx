import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { COUNT_MODE_OPTIONS, POINTS_MODE_OPTIONS, TABLE_TIEBREAKER_OPTIONS, TIEBREAKER_OPTIONS } from "@/lib/referenceSeries";

// Regeln einer Serie (#1741) - alles einstellbar, nichts fest verdrahtet. Die Felder kommen aus `rulesToForm`, gerechnet
// wird im Server. Eine Team-Liga braucht nur Sieg/Unentschieden/Niederlage und den Vorrang ihrer Tabelle.

export function RulesFields({ rules, kind, onChange }) {
  const set = (key, value) => onChange({ ...rules, [key]: value });
  const setAt = (key, index, value) => onChange({ ...rules, [key]: rules[key].map((item, at) => (at === index ? value : item)) });
  const scheme = rules.points_mode === "scheme";

  if (kind === "team_league") {
    return (
      <FormSection title="Team-Liga" hint="Punkte für ein Spiel und der Vorrang in der Tabelle. Die Tabelle des Veranstalters gilt, sobald sie eingefügt ist." plain testId="series-rules-league">
        <FormGrid cols={3}>
          <TextField label="Sieg" type="number" step="any" value={rules.match_win} onChange={(v) => set("match_win", v)} testId="series-rules-win" />
          <TextField label="Unentschieden" type="number" step="any" value={rules.match_draw} onChange={(v) => set("match_draw", v)} testId="series-rules-draw" />
          <TextField label="Niederlage" type="number" step="any" value={rules.match_loss} onChange={(v) => set("match_loss", v)} testId="series-rules-loss" />
        </FormGrid>
        <FormGrid cols={3}>
          {rules.table_tiebreakers.map((value, index) => (
            <SelectField key={index} label={`Vorrang ${index + 1}`} value={value} onChange={(v) => setAt("table_tiebreakers", index, v)} options={TABLE_TIEBREAKER_OPTIONS} testId={`series-rules-table-tiebreaker-${index}`} />
          ))}
        </FormGrid>
      </FormSection>
    );
  }

  return (
    <>
      <FormSection title="Punkte" hint="Punkte je Platz oder wie beim Veranstalter. Boni, Ausfall und Strafen gelten nur bei Punkten je Platz." plain testId="series-rules-points-section">
        <FormGrid>
          <SelectField label="Punkte" value={rules.points_mode} onChange={(v) => set("points_mode", v)} options={POINTS_MODE_OPTIONS} testId="series-rules-points-mode" />
          {scheme && <TextField label="Punkte je Platz" value={rules.points_by_place} onChange={(v) => set("points_by_place", v)} placeholder="25, 18, 15, 12, 10" hint="Platz 1 zuerst, dahinter 0." testId="series-rules-points" />}
        </FormGrid>
        {scheme && (
          <FormGrid cols={3}>
            <TextField label="Schnellste Runde: Bonus" type="number" step="any" min="0" value={rules.fastest_lap_points} onChange={(v) => set("fastest_lap_points", v)} testId="series-rules-fastest-lap" />
            <TextField label="… nur bis Platz" type="number" min="1" value={rules.fastest_lap_max_place} onChange={(v) => set("fastest_lap_max_place", v)} hint="Leer: auf jedem Platz." testId="series-rules-fastest-lap-place" />
            <TextField label="Pole: Bonus" type="number" step="any" min="0" value={rules.pole_points} onChange={(v) => set("pole_points", v)} testId="series-rules-pole" />
            <TextField label="Punkte bei Ausfall" type="number" step="any" value={rules.dnf_points} onChange={(v) => set("dnf_points", v)} hint="Leer: Punkte nach Platz." testId="series-rules-dnf" />
            <TextField label="Punkte bei Nichtstart" type="number" step="any" value={rules.dns_points} onChange={(v) => set("dns_points", v)} testId="series-rules-dns" />
            <TextField label="Punkte bei Disqualifikation" type="number" step="any" value={rules.dsq_points} onChange={(v) => set("dsq_points", v)} testId="series-rules-dsq" />
          </FormGrid>
        )}
      </FormSection>

      <FormSection title="Was zählt" hint="Bei Streichergebnissen zählen die besten „Runden im Kalender minus N“; wer weniger Ergebnisse hat, dem zählt alles." plain testId="series-rules-count-section">
        <FormGrid cols={3}>
          <SelectField label="Wertung" value={rules.count_mode} onChange={(v) => set("count_mode", v)} options={COUNT_MODE_OPTIONS} testId="series-rules-count-mode" />
          {rules.count_mode !== "all" && <TextField label="N" type="number" min="0" value={rules.count_n} onChange={(v) => set("count_n", v)} testId="series-rules-count-n" />}
          <TextField label="Finale: die besten" type="number" min="1" value={rules.final_top_n} onChange={(v) => set("final_top_n", v)} hint="Leer: kein Finale." testId="series-rules-final" />
          <TextField label="Aktivitätspunkte je Runde" type="number" step="any" min="0" value={rules.activity_points} onChange={(v) => set("activity_points", v)} testId="series-rules-activity" />
          <TextField label="… ab Runde" type="number" min="1" value={rules.activity_from_round} onChange={(v) => set("activity_from_round", v)} testId="series-rules-activity-from" />
        </FormGrid>
      </FormSection>

      <FormSection title="Vorrang bei Gleichstand" hint="Der Reihe nach; entscheidet keines, teilen sich beide den Platz." plain testId="series-rules-tiebreak-section">
        <FormGrid cols={3}>
          {rules.tiebreakers.map((value, index) => (
            <SelectField key={index} label={`Vorrang ${index + 1}`} value={value} onChange={(v) => setAt("tiebreakers", index, v)} options={TIEBREAKER_OPTIONS} testId={`series-rules-tiebreaker-${index}`} />
          ))}
        </FormGrid>
      </FormSection>

      <FormSection title="Teamwertung" hint="Je Rennen zählen die besten Fahrer eines Teams; das Team je Rennen steht im Ergebnis, sonst gilt das Standard-Team." plain testId="series-rules-team-section">
        <CheckField label="Teamwertung führen" checked={rules.team_enabled} onChange={(v) => set("team_enabled", v)} testId="series-rules-team-enabled" />
        {rules.team_enabled && (
          <FormGrid>
            <TextField label="Fahrer, die je Rennen zählen" type="number" min="1" value={rules.team_counting_drivers} onChange={(v) => set("team_counting_drivers", v)} hint="Leer: alle." testId="series-rules-team-drivers" />
            <CheckField label="Gäste zählen fürs Team" checked={rules.team_guests_count} onChange={(v) => set("team_guests_count", v)} testId="series-rules-team-guests" />
          </FormGrid>
        )}
      </FormSection>
    </>
  );
}
