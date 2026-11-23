// Schweizer System und Gleichstand in Tabellen (#1559) im Abschnitt „Struktur“ bzw. „Spieloptionen“: Abschlussregel,
// nächste Runde automatisch und die Reihenfolge bei Punktgleichheit - alles Vorgaben, alles änderbar. Ohne gespeicherte
// Einstellung zeigt das Formular, wie das Turnier bisher rechnet; geschickt wird erst etwas, wenn jemand etwas ändert.
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { OrderedChips } from "@/components/tls/OrderedChips";
import {
  SWISS_END_RULE_OPTIONS, SWISS_TIEBREAK_KEYS, SWISS_TIEBREAK_LABELS, TABLE_TIEBREAK_KEYS, TABLE_TIEBREAK_LABELS,
  recommendedSwissRounds,
} from "@/lib/tournamentTableSettings";

const END_RULE_HINTS = {
  rounds: "Nach der letzten Runde ist Schluss. Mehr Runden gehen jederzeit: Zahl erhöhen, dann „Schweizer Runde“.",
  wins_losses: "Wer weiter oder raus ist, wird nicht mehr gepaart. Ein Freilos zählt als Sieg.",
  manual: "Es gibt Runden, solange die Turnierleitung welche startet.",
};

/** `value`: Formularwerte (lib/tournamentTableSettings.swissForm); `participants`: Größe des Felds für den Vorschlag der Runden. */
export function SwissSettingsFields({ value, onChange, participants, testPrefix = "tr-swiss" }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  const suggestion = recommendedSwissRounds(participants);
  return (
    <div className="space-y-3" data-testid={`${testPrefix}-settings`}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Schweizer System</div>
      <SelectField label="Abschluss" value={value.end_rule} onChange={(next) => set("end_rule", next)} options={SWISS_END_RULE_OPTIONS}
        hint={END_RULE_HINTS[value.end_rule]} testId={`${testPrefix}-end-rule`} />
      {value.end_rule === "rounds" && (
        <FormGrid cols={2}>
          <TextField label="Runden" type="number" min="1" max="30" value={value.rounds} onChange={(next) => set("rounds", next)}
            placeholder={`Vorschlag: ${suggestion}`} testId={`${testPrefix}-rounds`}
            hint={`Leer: nach der Größe des Felds – bei ${Number(participants) || 2} Teilnehmern ${suggestion}.`} />
          <TextField label="So viele kommen weiter" type="number" min="1" value={value.top_n} onChange={(next) => set("top_n", next)}
            placeholder="Niemand markiert" testId={`${testPrefix}-top-n`}
            hint="Nach der letzten Runde zeigt die Tabelle die Besten als „Weiter“. Leer: ohne Marke." />
        </FormGrid>
      )}
      {value.end_rule === "wins_losses" && (
        <FormGrid cols={2}>
          <TextField label="Siege zum Weiterkommen" type="number" min="1" max="20" value={value.wins_to_advance}
            onChange={(next) => set("wins_to_advance", next)} testId={`${testPrefix}-wins`} />
          <TextField label="Niederlagen zum Ausscheiden" type="number" min="1" max="20" value={value.losses_to_exit}
            onChange={(next) => set("losses_to_exit", next)} testId={`${testPrefix}-losses`} />
        </FormGrid>
      )}
      <CheckField label="Nächste Runde automatisch" checked={value.auto_next_round} onChange={(next) => set("auto_next_round", next)}
        testId={`${testPrefix}-auto`}
        hint="Sobald das letzte Spiel einer Runde gewertet ist, wird die nächste gepaart. Die erste Runde startest du mit „Schweizer Runde“. Aus: jede Runde von Hand." />
      <OrderedChips legend="Bei Punktgleichheit" labels={SWISS_TIEBREAK_LABELS} keys={SWISS_TIEBREAK_KEYS} value={value.tiebreakers}
        onChange={(next) => set("tiebreakers", next)} testPrefix={`${testPrefix}-tiebreaker`}
        hint="In der Reihenfolge des Anklickens. Zuerst zählen immer die Punkte. Buchholz: Punkte der Gegner; Median-Buchholz: ohne den besten und den schlechtesten. Der direkte Vergleich zählt nur, wenn sich alle Punktgleichen getroffen haben. Ohne Kriterium teilen sich Punktgleiche den Platz." />
    </div>
  );
}

/** `value`: die Reihenfolge als Liste (Gruppenphase, Jeder gegen jeden). */
export function TableTiebreakField({ value, onChange, testPrefix = "tr-table" }) {
  return (
    <div data-testid={`${testPrefix}-settings`}>
      <OrderedChips legend="Bei Punktgleichheit in der Tabelle" labels={TABLE_TIEBREAK_LABELS} keys={TABLE_TIEBREAK_KEYS} value={value}
        onChange={onChange} testPrefix={`${testPrefix}-tiebreaker`}
        hint="In der Reihenfolge des Anklickens. Zuerst zählen immer die Punkte. Direkter Vergleich: nur die Spiele der Punktgleichen untereinander, bei drei und mehr als kleine Tabelle – er zählt, sobald sie alle gespielt sind. Ohne Kriterium teilen sich Punktgleiche den Platz." />
    </div>
  );
}
