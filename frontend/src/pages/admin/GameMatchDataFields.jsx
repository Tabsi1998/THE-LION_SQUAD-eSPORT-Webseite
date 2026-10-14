// Spiel-Daten für Turniere (#1554) im Seitenblatt „Spiel bearbeiten“: Dauer je Modus, Spieler je Lauf, Best-of,
// Aufbauzeit, Geräte für Stationen und Punktetabelle. Alles freiwillig; Umrechnen in lib/gameMatchData.js.
import { Plus, Trash2 } from "lucide-react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { MODES_MAX, STATION_DEVICE_OPTIONS, emptyMode, parsePointsTable } from "@/lib/gameMatchData";
import { formatDeviceType } from "@/lib/tournamentLabels";

const BEST_OF = ["1", "3", "5", "7"];
const PREVIEW_PLACES = 8;

function pointsPreview(points) {
  if (!points.length) return "";
  const shown = points.slice(0, PREVIEW_PLACES).map((value, index) => `${index + 1}. ${value}`).join(" · ");
  const rest = points.length > PREVIEW_PLACES ? ` … ${points.length}. ${points[points.length - 1]}` : "";
  return `${points.length === 1 ? "1 Platz" : `${points.length} Plätze`}: ${shown}${rest}`;
}

export function GameMatchDataFields({ value, onChange, testPrefix = "game-edit" }) {
  const data = value;
  const set = (key, next) => onChange({ ...data, [key]: next });
  const modes = data.match_modes || [];
  const setMode = (index, patch) => set("match_modes", modes.map((mode, i) => (i === index ? { ...mode, ...patch } : mode)));
  const devices = data.station_devices || [];
  const knownDevices = STATION_DEVICE_OPTIONS.map(([key]) => key);
  const deviceOptions = [...STATION_DEVICE_OPTIONS, ...devices.filter((key) => !knownDevices.includes(key)).map((key) => [key, formatDeviceType(key)])];
  const toggleDevice = (key) => set("station_devices", devices.includes(key) ? devices.filter((item) => item !== key) : [...devices, key]);
  const points = parsePointsTable(data.points_table);
  const bestOfOptions = [["", "Keine Vorgabe"], ...[...new Set([...BEST_OF, ...(data.default_best_of ? [String(data.default_best_of)] : [])])]
    .sort((a, b) => Number(a) - Number(b)).map((count) => [count, `Best of ${count}`])];

  return (
    <FormSection
      title="Für Turniere"
      hint="Alles freiwillig. Hat ein Turnier keine eigene Matchdauer, plant es mit dem gewählten Modus, sonst mit dem ersten. Best-of und Spieler je Lauf füllen das Turnierformular vor."
      testId={`${testPrefix}-match-data`}
    >
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Dauer je Modus</div>
          <button
            type="button"
            onClick={() => set("match_modes", [...modes, emptyMode()])}
            disabled={modes.length >= MODES_MAX}
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm"
            data-testid={`${testPrefix}-mode-add`}
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Modus
          </button>
        </div>
        {modes.length === 0 ? (
          <p className="text-xs text-white/45" data-testid={`${testPrefix}-modes-empty`}>
            Noch kein Modus. Ohne Modus gilt die Matchdauer des Turniers, sonst 30 Minuten.
          </p>
        ) : (
          <ul className="space-y-2">
            {modes.map((mode, index) => (
              <li key={index} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-2.5 space-y-2">
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] gap-2 items-center">
                  <input
                    value={mode.label}
                    onChange={(e) => setMode(index, { label: e.target.value })}
                    maxLength={60}
                    placeholder={index === 0 ? "z. B. Grand Prix 4 Rennen" : "z. B. Einzelrennen"}
                    aria-label={`Modus ${index + 1}: Name`}
                    data-testid={`${testPrefix}-mode-label-${index}`}
                    className="min-w-0 w-full bg-[#121212] border border-white/10 focus:border-[#29B6E8] px-2.5 py-2 rounded-sm text-sm text-white focus:outline-none"
                  />
                  <label className="relative block">
                    <input
                      type="number"
                      min="1"
                      max="600"
                      inputMode="numeric"
                      value={mode.minutes}
                      onChange={(e) => setMode(index, { minutes: e.target.value })}
                      aria-label={`Modus ${index + 1}: Minuten`}
                      data-testid={`${testPrefix}-mode-minutes-${index}`}
                      className="w-full bg-[#121212] border border-white/10 focus:border-[#29B6E8] pl-2.5 pr-9 py-2 rounded-sm text-sm text-white tabular-nums focus:outline-none"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-white/45">Min.</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => set("match_modes", modes.filter((_, i) => i !== index))}
                    aria-label={`Modus ${index + 1} entfernen`}
                    title="Modus entfernen"
                    data-testid={`${testPrefix}-mode-remove-${index}`}
                    className="p-2 text-white/45 hover:text-live focus-visible:outline focus-visible:outline-1 focus-visible:outline-live rounded-sm"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <label className="inline-flex items-center gap-2 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={!!mode.per_game}
                      onChange={(e) => setMode(index, { per_game: e.target.checked })}
                      data-testid={`${testPrefix}-mode-per-game-${index}`}
                      className="accent-[#29B6E8]"
                    />
                    Minuten je Einzelspiel – Best-of zählt mit
                  </label>
                  {index === 0 && modes.length > 1 && <span className="text-[11px] text-white/45">Vorgabe, wenn das Turnier keinen Modus wählt</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {modes.length >= MODES_MAX && (
          <p className="text-xs text-white/45" data-testid={`${testPrefix}-modes-full`}>Höchstens {MODES_MAX} Modi je Spiel.</p>
        )}
        {modes.some((mode) => mode.per_game) && (
          <p className="text-xs text-white/45">Je Einzelspiel: ein Best of 3 plant 2,5 Spiele, ein Best of 5 vier.</p>
        )}
      </div>

      <FormGrid cols={2}>
        <TextField label="Spieler je Lauf vor Ort" type="number" min="1" max="64" value={data.players_per_run_local} onChange={(v) => set("players_per_run_local", v)} placeholder="z. B. 4" hint="Wie viele an einer Station gleichzeitig spielen." testId={`${testPrefix}-run-local`} />
        <TextField label="Spieler je Lauf online" type="number" min="1" max="64" value={data.players_per_run_online} onChange={(v) => set("players_per_run_online", v)} placeholder="z. B. 12" hint="Wie viele in einer Online-Lobby spielen." testId={`${testPrefix}-run-online`} />
        <SelectField label="Best-of-Vorgabe" value={String(data.default_best_of || "")} onChange={(v) => set("default_best_of", v)} options={bestOfOptions} testId={`${testPrefix}-best-of`} />
        <TextField label="Aufbau- und Wechselzeit Min." type="number" min="0" max="120" value={data.setup_minutes} onChange={(v) => set("setup_minutes", v)} placeholder="z. B. 3" hint="Kommt zur Dauer aus dem Modus dazu." testId={`${testPrefix}-setup`} />
      </FormGrid>

      <fieldset className="space-y-2">
        <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Geräte für Stationen</legend>
        <div className="flex flex-wrap gap-2">
          {deviceOptions.map(([key, label]) => {
            const on = devices.includes(key);
            return (
              <label
                key={key}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border text-xs cursor-pointer select-none focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8] ${on ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/65 hover:border-white/25"}`}
              >
                <input type="checkbox" checked={on} onChange={() => toggleDevice(key)} className="accent-[#29B6E8]" data-testid={`${testPrefix}-device-${key}`} />
                {label}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-white/45">Der Planer nimmt nur Stationen mit einem dieser Geräte. Nichts gewählt: jede Station.</p>
      </fieldset>

      <div className="space-y-1">
        <TextField label="Punktetabelle" value={data.points_table} onChange={(v) => set("points_table", v)} placeholder="z. B. 15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1" testId={`${testPrefix}-points`} />
        {points.error ? (
          <div role="alert" className="text-xs text-warn" data-testid={`${testPrefix}-points-error`}>{points.error}</div>
        ) : (
          <div className="text-xs text-white/45 tabular-nums break-words" data-testid={`${testPrefix}-points-preview`}>
            {pointsPreview(points.points) || "Punkte je Platz, getrennt durch Komma oder Bindestrich (4-3-2-1)."}
          </div>
        )}
      </div>
    </FormSection>
  );
}
