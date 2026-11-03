// Spiel-Daten für Turniere (#1554) im Seitenblatt „Spiel bearbeiten“: Dauer je Modus, Spieler je Lauf, Best-of,
// Aufbauzeit, Geräte für Stationen und Punktetabelle. Alles freiwillig; Umrechnen in lib/gameMatchData.js.
// Je Modus dazu (#2206, C.1): Zustand, Beschreibung, Spieler je Seite, Format und Ergebnisregel. Verwendete Modi lassen sich
// nur deaktivieren oder archivieren - der Knopf zum Entfernen steht nur bei unbenutzten.
import { useState } from "react";
import { ChevronDown, Lock, Plus, Trash2 } from "lucide-react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import {
  MODES_MAX, MODE_DESCRIPTION_MAX, MODE_FORMAT_MAX, MODE_STATUS_OPTIONS, RESULT_RULE_KINDS, STATION_DEVICE_OPTIONS,
  emptyMode, modeInUse, parsePointsTable, resultRuleText,
} from "@/lib/gameMatchData";
import { formatDeviceType } from "@/lib/tournamentLabels";

const STATUS_HINTS = {
  inactive: "Inaktiv: steht für neue Map-Pools, „Modus je Map“ und Turniere nicht mehr zur Wahl. Laufende Spiele, gespeicherte Pools und alte Ergebnisse zeigen ihn weiter.",
  archived: "Archiviert: wie inaktiv, dazu in allen Auswahllisten der Verwaltung ausgeblendet und an keiner Map neu wählbar. Bestehendes zeigt ihn weiter.",
};
const RULE_HINTS = {
  "": "Ohne Regel wird jeder Endstand angenommen.",
  score: "Gewonnen hat, wer zuerst das Ziel erreicht – bei Zeitlimit sonst der höhere Stand.",
  rounds: "Gewonnen hat, wer zuerst so viele Runden gewinnt.",
  highest: "Kein Ziel: Am Ende gewinnt der höhere Stand.",
};
const TARGET_LABELS = { score: "Ziel (Punkte)", rounds: "Runden zum Sieg" };

function rowSummary(mode) {
  const rule = resultRuleText({
    kind: mode.rule_kind, target: mode.rule_target, round_limit: mode.rule_round_limit, time_limit_minutes: mode.rule_time_limit,
    draw_allowed: mode.rule_draw, overtime: mode.rule_overtime,
  });
  const players = String(mode.players_per_side || "").trim() ? `${mode.players_per_side} je Seite` : "";
  return [players, String(mode.format || "").trim(), rule].filter(Boolean).join(" · ") || "Beschreibung, Spieler je Seite, Format, Ergebnisregel";
}

// Entfernen nur bei unbenutzten Modi: neue Zeilen immer, gespeicherte erst, wenn die Zählung „unbenutzt“ sagt. Lädt sie noch
// (`usage === undefined`), wartet der Knopf; schlug sie fehl (`null`), bleibt er - der Server lehnt Verwendetes mit 409 ab.
function RemoveOrLock({ mode, index, usage, onRemove, testPrefix }) {
  const used = mode.mode ? modeInUse(usage, mode.mode) : false;
  if (used) {
    return (
      <span className="p-2 text-white/45" title="Wird verwendet – nur deaktivieren oder archivieren" data-testid={`${testPrefix}-mode-locked-${index}`}>
        <Lock className="w-4 h-4" aria-hidden="true" />
        <span className="sr-only">Modus {index + 1} wird verwendet und lässt sich nicht entfernen</span>
      </span>
    );
  }
  const waiting = Boolean(mode.mode) && usage === undefined;
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={waiting}
      aria-label={`Modus ${index + 1} entfernen`}
      title={waiting ? "Prüfe, ob der Modus verwendet wird …" : "Modus entfernen"}
      data-testid={`${testPrefix}-mode-remove-${index}`}
      className="p-2 text-white/45 hover:text-live disabled:opacity-40 disabled:cursor-wait focus-visible:outline focus-visible:outline-1 focus-visible:outline-live rounded-sm"
    >
      <Trash2 className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

function ModeDetails({ mode, index, setMode, testPrefix }) {
  const kind = mode.rule_kind || "";
  const id = `${testPrefix}-mode-details-${index}`;
  return (
    <div id={id} className="space-y-3 border-t border-white/10 pt-3" data-testid={id}>
      <TextAreaField label="Beschreibung" rows={2} value={mode.description} onChange={(value) => setMode(index, { description: value.slice(0, MODE_DESCRIPTION_MAX) })}
        placeholder="Kurz, worum es in diesem Modus geht."
        hint={`${String(mode.description || "").length} / ${MODE_DESCRIPTION_MAX} Zeichen`} testId={`${testPrefix}-mode-description-${index}`} />
      <FormGrid cols={2}>
        <TextField label="Spieler je Seite" type="number" min="1" max="64" value={mode.players_per_side} onChange={(value) => setMode(index, { players_per_side: value })}
          placeholder="z. B. 4" hint="4 heißt 4 gegen 4. Leer: keine Vorgabe." testId={`${testPrefix}-mode-players-${index}`} />
        <TextField label="Format" maxLength={MODE_FORMAT_MAX} value={mode.format} onChange={(value) => setMode(index, { format: value })}
          placeholder="z. B. Standard-Regeln" hint="Freitext, etwa die Regel-Variante." testId={`${testPrefix}-mode-format-${index}`} />
      </FormGrid>
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Ergebnisregel</legend>
        <SelectField label="Art" value={kind} onChange={(value) => setMode(index, { rule_kind: value })} options={RESULT_RULE_KINDS}
          hint={RULE_HINTS[kind]} testId={`${testPrefix}-mode-rule-kind-${index}`} />
        {kind && (
          <>
            <FormGrid cols={kind === "rounds" ? 3 : 2}>
              {kind !== "highest" && (
                <TextField label={TARGET_LABELS[kind]} type="number" min="1" max="100000" required value={mode.rule_target}
                  onChange={(value) => setMode(index, { rule_target: value })} placeholder={kind === "rounds" ? "z. B. 6" : "z. B. 200"}
                  testId={`${testPrefix}-mode-rule-target-${index}`} />
              )}
              {kind === "rounds" && (
                <TextField label="Rundenlimit" type="number" min="1" max="999" value={mode.rule_round_limit}
                  onChange={(value) => setMode(index, { rule_round_limit: value })} placeholder="z. B. 11" hint="Höchstens so viele Runden. Leer: offen."
                  testId={`${testPrefix}-mode-rule-limit-${index}`} />
              )}
              <TextField label="Zeitlimit Min." type="number" min="1" max="600" value={mode.rule_time_limit}
                onChange={(value) => setMode(index, { rule_time_limit: value })} placeholder="z. B. 10" hint="Je Map. Leer: ohne Zeitlimit."
                testId={`${testPrefix}-mode-rule-time-${index}`} />
            </FormGrid>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <CheckField label="Remis erlaubt" checked={mode.rule_draw} onChange={(value) => setMode(index, { rule_draw: value })} testId={`${testPrefix}-mode-rule-draw-${index}`} />
              <CheckField label="Verlängerung bei Gleichstand" checked={mode.rule_overtime} onChange={(value) => setMode(index, { rule_overtime: value })} testId={`${testPrefix}-mode-rule-overtime-${index}`} />
            </div>
          </>
        )}
        <p className="text-xs text-white/45">Die Regel wird gespeichert und hier angezeigt. Gemeldete Endstände prüft die Seite damit noch nicht.</p>
      </fieldset>
    </div>
  );
}

const BEST_OF = ["1", "3", "5", "7"];
const PREVIEW_PLACES = 8;

function pointsPreview(points) {
  if (!points.length) return "";
  const shown = points.slice(0, PREVIEW_PLACES).map((value, index) => `${index + 1}. ${value}`).join(" · ");
  const rest = points.length > PREVIEW_PLACES ? ` … ${points.length}. ${points[points.length - 1]}` : "";
  return `${points.length === 1 ? "1 Platz" : `${points.length} Plätze`}: ${shown}${rest}`;
}

export function GameMatchDataFields({ value, onChange, testPrefix = "game-edit", usage }) {
  const data = value;
  const set = (key, next) => onChange({ ...data, [key]: next });
  const modes = data.match_modes || [];
  const setMode = (index, patch) => set("match_modes", modes.map((mode, i) => (i === index ? { ...mode, ...patch } : mode)));
  // Aufgeklappte Details je Zeile; eine neue Zeile kommt zugeklappt.
  const [open, setOpen] = useState(() => new Set());
  const toggle = (index) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });
  const removeMode = (index) => {
    set("match_modes", modes.filter((_, i) => i !== index));
    setOpen((current) => new Set([...current].filter((at) => at !== index).map((at) => (at > index ? at - 1 : at))));
  };
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
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Modi und Dauer</div>
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
                  <RemoveOrLock mode={mode} index={index} usage={usage} onRemove={() => removeMode(index)} testPrefix={testPrefix} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
                  <label className="inline-flex min-w-0 items-center gap-2 text-xs text-white/70">
                    <span className="shrink-0">Zustand</span>
                    <select
                      value={mode.status || "active"}
                      onChange={(e) => setMode(index, { status: e.target.value })}
                      aria-label={`Modus ${index + 1}: Zustand`}
                      data-testid={`${testPrefix}-mode-status-${index}`}
                      className="min-w-0 max-w-[15rem] bg-[#121212] border border-white/10 focus:border-[#29B6E8] px-2 py-1.5 rounded-sm text-xs text-white focus:outline-none"
                    >
                      {MODE_STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                  </label>
                </div>
                {index === 0 && modes.length > 1 && <p className="text-[11px] text-white/45">Vorgabe für die Dauer, wenn das Turnier keinen Modus wählt</p>}
                {STATUS_HINTS[mode.status] && (
                  <p className="text-[11px] text-warn/90" data-testid={`${testPrefix}-mode-status-hint-${index}`}>{STATUS_HINTS[mode.status]}</p>
                )}
                {mode.mode && modeInUse(usage, mode.mode) && (
                  <p className="text-[11px] text-white/50" data-testid={`${testPrefix}-mode-used-${index}`}>
                    Wird verwendet (Pool, Reihenfolge, Turnier oder Spiel) – entfernen geht nicht, nur deaktivieren oder archivieren.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  aria-expanded={open.has(index)}
                  aria-controls={`${testPrefix}-mode-details-${index}`}
                  data-testid={`${testPrefix}-mode-more-${index}`}
                  className="flex w-full min-w-0 items-center gap-2 text-left text-xs text-[#29B6E8] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm"
                >
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-fast${open.has(index) ? "rotate-180" : ""}`} aria-hidden="true" />
                  <span className="min-w-0 truncate">{rowSummary(mode)}</span>
                </button>
                {open.has(index) && <ModeDetails mode={mode} index={index} setMode={setMode} testPrefix={testPrefix} />}
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
        {modes.length > 0 && (
          <p className="text-xs text-white/45" data-testid={`${testPrefix}-modes-maps`}>
            Minuten freiwillig – ein Modus ohne Dauer dient nur den Maps (Spiele → Maps). Umbenennen behält die Zuordnung.
            Entfernen geht nur bei unbenutzten Modi und nimmt sie beim Speichern auch aus den Maps. Einen verwendeten Modus
            stellst du auf „Inaktiv“ oder „Archiviert“.
          </p>
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
