import { Plus, Trash2 } from "lucide-react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";

// Spielberechtigung je Season (docs/LIGA.md, B.3, #2204): alles sind Vorgaben, nichts ist fest. Der Stichtag steht in der Kaderübersicht,
// weil ihn auch die Zuständigkeit „Kader prüfen“ setzt.

const LINEUP_OPTIONS = [["series", "Teilnehmerliste einmal je Spiel"], ["per_map", "Aufstellung je Map (wie bisher)"]];

function Toggle({ label, hint, checked, onChange, testId }) {
  return (
    <label className="flex min-h-[44px] items-start gap-2 text-sm text-white/80">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="mt-1 accent-[#29B6E8]" data-testid={testId} />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint ? <span className="block text-xs text-white/50">{hint}</span> : null}
      </span>
    </label>
  );
}

function TransferWindows({ value = [], onChange }) {
  const set = (index, patch) => onChange(value.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2" data-testid="season-form-transfer-windows">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] font-bold uppercase tracking-widest text-white/60">Transferfenster</p>
        <button type="button" onClick={() => onChange([...value, { start_date: "", end_date: "" }])} className="tls-btn tls-btn--quiet inline-flex min-h-[40px] items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider" data-testid="season-form-transfer-add">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Fenster
        </button>
      </div>
      {!value.length ? <p className="text-xs text-white/50">Ohne Fenster gibt es in dieser Season keine Transfers. Wer im Fenster wechseln will, braucht die Genehmigung der Liga-Leitung.</p> : null}
      {value.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <TextField label="Von" type="date" value={row.start_date || ""} onChange={(next) => set(index, { start_date: next })} testId={`season-form-transfer-start-${index}`} />
          <TextField label="Bis" type="date" value={row.end_date || ""} onChange={(next) => set(index, { end_date: next })} testId={`season-form-transfer-end-${index}`} />
          <TextField label="Name (freiwillig)" value={row.label || ""} onChange={(next) => set(index, { label: next })} testId={`season-form-transfer-label-${index}`} />
          <button type="button" aria-label="Fenster entfernen" onClick={() => onChange(value.filter((_, at) => at !== index))} className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center justify-center rounded-sm px-3">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function SeasonEligibilitySection({ form, set }) {
  const series = form.lineup_mode === "series";
  return (
    <FormSection title="Spielberechtigung" testId="season-eligibility"
      hint="Wer in dieser Season spielen darf. Leer lassen heißt: Die Regel bleibt, wie sie ist. Eine 0 schaltet Mindestalter und Wartezeit aus.">
      <FormGrid cols={3}>
        <TextField label="Höchstkader" type="number" min={1} max={200} value={form.max_squad_size} onChange={(value) => set("max_squad_size", value)}
          hint="Mindestkader steht bei „Spiel und Wertung“" testId="season-form-max-squad" />
        <TextField label="Mindestalter (Jahre)" type="number" min={0} max={99} value={form.min_age} onChange={(value) => set("min_age", value)}
          hint="Selbstauskunft: Geburtsdatum im Profil" testId="season-form-min-age" />
        <TextField label="Wartezeit neuer Spieler (Tage)" type="number" min={0} max={60} value={form.new_player_wait_days} onChange={(value) => set("new_player_wait_days", value)}
          hint="ab Aufnahme: Neue nach dem Ende von Spieltag 1, Transfers immer" testId="season-form-wait-days" />
      </FormGrid>
      <FormGrid cols={2}>
        <SelectField label="Wer gespielt hat" value={form.lineup_mode} onChange={(value) => set("lineup_mode", value)} options={LINEUP_OPTIONS}
          hint="Bei der Liste hakt jedes Team am Schluss einmal an, wer gespielt hat. Maps und Endstände bleiben je Map Pflicht. Gilt ab „Übertragen“, nur vor dem ersten Ergebnis." testId="season-form-lineup-mode" />
        {series ? (
          <TextField label="Mindestens auf der Liste" type="number" min={1} max={20} value={form.lineup_min_players} onChange={(value) => set("lineup_min_players", value)}
            hint="nach oben offen, bei Wechseln auch mehr" testId="season-form-lineup-min" />
        ) : null}
      </FormGrid>
      <Toggle label="Ein Team je Season" hint="Eine Person steht in dieser Season nur in einem Co-Team. In anderen Seasons und Ligen darf sie für andere Teams spielen." checked={form.one_team_per_season}
        onChange={(value) => set("one_team_per_season", value)} testId="season-form-one-team" />
      <Toggle label="Jede Spiel-ID nur einmal" hint="Eine ID, die in dieser Season schon gilt, kann niemand zweites nutzen. Die Meldung nennt nie, wem sie gehört." checked={form.unique_game_ids}
        onChange={(value) => set("unique_game_ids", value)} testId="season-form-unique-ids" />
      <TransferWindows value={form.transfer_windows} onChange={(value) => set("transfer_windows", value)} />
    </FormSection>
  );
}
