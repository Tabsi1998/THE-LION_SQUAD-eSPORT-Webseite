// Spiel-Daten für Turniere (#1554) und Spielmodi (#2206, C.1) im Reiter „Modi“ der Spielseite (#2249). Umrechnen in
// lib/gameMatchData.js.
// - GameModesEditor: je Modus eine Zeile mit Name, Zustand, Spieler je Seite, Ergebnisregel und Dauer; ein Klick klappt alle
//   Felder auf. Verwendete Modi lassen sich nur deaktivieren oder archivieren - statt des Papierkorbs steht ein Schloss.
// - GameTournamentPresets: Spieler je Lauf, Best-of, Aufbauzeit, Geräte für Stationen und Punktetabelle. Alles freiwillig.
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
const STATUS_CHIPS = {
  active: ["Aktiv", "border-ok/30 text-ok"],
  inactive: ["Inaktiv", "border-warn/40 text-warn"],
  archived: ["Archiviert", "border-white/15 text-white/50"],
};
const RULE_HINTS = {
  "": "Ohne Regel wird jeder Endstand angenommen.",
  score: "Gewonnen hat, wer zuerst das Ziel erreicht – bei Zeitlimit sonst der höhere Stand.",
  rounds: "Gewonnen hat, wer zuerst so viele Runden gewinnt.",
  highest: "Kein Ziel: Am Ende gewinnt der höhere Stand.",
};
const TARGET_LABELS = { score: "Ziel (Punkte)", rounds: "Runden zum Sieg" };

function ruleOf(mode) {
  return resultRuleText({
    kind: mode.rule_kind, target: mode.rule_target, round_limit: mode.rule_round_limit, time_limit_minutes: mode.rule_time_limit,
    draw_allowed: mode.rule_draw, overtime: mode.rule_overtime,
  });
}

const playersOf = (mode) => (String(mode.players_per_side || "").trim() ? `${mode.players_per_side} je Seite` : "");
const durationOf = (mode) => (String(mode.minutes || "").trim() ? `${mode.minutes} Min.${mode.per_game ? " je Spiel" : ""}` : "");

/** Was eingetragen ist, in einer Zeile - für die Handy-Ansicht der Modus-Zeile. */
export function modeSummary(mode) {
  return [playersOf(mode), String(mode.format || "").trim(), ruleOf(mode), durationOf(mode)].filter(Boolean).join(" · ")
    || "Noch nichts festgelegt – aufklappen für Spieler je Seite, Ergebnisregel und Dauer";
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
  return (
    <>
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
    </>
  );
}

// Spalten der Modus-Zeile ab 768 px: Name, Zustand, Spieler je Seite, Ergebnisregel, Dauer. Darunter steht alles in zwei Zeilen.
const ROW_GRID = "grid grid-cols-[1rem_minmax(0,1fr)] md:grid-cols-[1rem_minmax(0,1.3fr)_6.5rem_6.5rem_minmax(0,2fr)_6rem] gap-x-3 gap-y-1 items-center";

function ModeRow({ mode, index, open, onToggle, setMode, usage, onRemove, isFirst, testPrefix }) {
  const status = mode.status || "active";
  const [chip, chipClass] = STATUS_CHIPS[status] || STATUS_CHIPS.active;
  const detailsId = `${testPrefix}-mode-details-${index}`;
  const rule = ruleOf(mode);
  return (
    <li className={`border rounded-sm bg-[#0A0A0A] ${open ? "border-[#29B6E8]/40" : "border-white/10"}`} data-testid={`${testPrefix}-mode-row-${index}`}>
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={detailsId}
          data-testid={`${testPrefix}-mode-more-${index}`}
          className={`${ROW_GRID} min-w-0 flex-1 px-3 py-2.5 text-left rounded-sm hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]`}
        >
          <ChevronDown className={`w-4 h-4 text-[#29B6E8] transition-transform duration-fast ease-tls ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          <span className="min-w-0 truncate font-semibold text-white" data-testid={`${testPrefix}-mode-name-${index}`}>
            {String(mode.label || "").trim() || <span className="font-normal text-white/45">Neuer Modus</span>}
          </span>
          <span className="col-start-2 md:col-start-auto">
            <span className={`inline-block rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${chipClass}`} data-testid={`${testPrefix}-mode-chip-${index}`}>{chip}</span>
          </span>
          <span className="hidden md:block text-xs text-white/70 tabular-nums">{playersOf(mode) || <span className="text-white/35">–</span>}</span>
          <span className="hidden md:block min-w-0 truncate text-xs text-white/70" title={rule}>{rule || <span className="text-white/35">keine Regel</span>}</span>
          <span className="hidden md:block text-xs text-white/70 tabular-nums">{durationOf(mode) || <span className="text-white/35">–</span>}</span>
          <span className="col-start-2 md:hidden min-w-0 text-xs text-white/55 [overflow-wrap:anywhere]" data-testid={`${testPrefix}-mode-summary-${index}`}>{modeSummary(mode)}</span>
        </button>
        <RemoveOrLock mode={mode} index={index} usage={usage} onRemove={onRemove} testPrefix={testPrefix} />
      </div>
      {mode.mode && modeInUse(usage, mode.mode) && (
        <p className="px-3 pb-2 -mt-1 text-[11px] text-white/50" data-testid={`${testPrefix}-mode-used-${index}`}>
          Wird verwendet (Pool, Reihenfolge, Turnier oder Spiel) – entfernen geht nicht, nur deaktivieren oder archivieren.
        </p>
      )}
      {open && (
        <div id={detailsId} className="space-y-4 border-t border-white/10 p-3 md:p-4" data-testid={detailsId}>
          <FormGrid cols={2}>
            <TextField label="Name" required maxLength={60} value={mode.label} onChange={(value) => setMode(index, { label: value })}
              placeholder={index === 0 ? "z. B. Grand Prix 4 Rennen" : "z. B. Suchen & Zerstören"} hint="Umbenennen behält die Zuordnung der Maps."
              testId={`${testPrefix}-mode-label-${index}`} />
            <SelectField label="Zustand" value={status} onChange={(value) => setMode(index, { status: value })} options={MODE_STATUS_OPTIONS}
              testId={`${testPrefix}-mode-status-${index}`} />
          </FormGrid>
          {STATUS_HINTS[status] && (
            <p className="text-xs text-warn/90" data-testid={`${testPrefix}-mode-status-hint-${index}`}>{STATUS_HINTS[status]}</p>
          )}
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Dauer für die Turnierplanung</legend>
            <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)] md:items-center">
              <TextField label="Minuten" type="number" min="1" max="600" value={mode.minutes} onChange={(value) => setMode(index, { minutes: value })}
                placeholder="z. B. 12" testId={`${testPrefix}-mode-minutes-${index}`} />
              <CheckField label="Minuten je Einzelspiel – Best-of zählt mit" checked={mode.per_game} onChange={(value) => setMode(index, { per_game: value })}
                testId={`${testPrefix}-mode-per-game-${index}`} className="md:mt-5" />
            </div>
            <p className="text-xs text-white/45">
              Freiwillig. Ein Modus ohne Dauer dient nur den Maps und der Reihenfolge einer Liga.
              {isFirst ? " Der erste Modus ist die Vorgabe für die Dauer, wenn ein Turnier keinen Modus wählt." : ""}
            </p>
          </fieldset>
          <ModeDetails mode={mode} index={index} setMode={setMode} testPrefix={testPrefix} />
        </div>
      )}
    </li>
  );
}

export function GameModesEditor({ modes = [], onChange, usage, testPrefix = "game-edit" }) {
  const setMode = (index, patch) => onChange(modes.map((mode, i) => (i === index ? { ...mode, ...patch } : mode)));
  // Aufgeklappte Zeilen; eine neue Zeile kommt aufgeklappt, damit man gleich den Namen tippt.
  const [open, setOpen] = useState(() => new Set());
  const toggle = (index) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });
  const add = () => {
    onChange([...modes, emptyMode()]);
    setOpen((current) => new Set([...current, modes.length]));
  };
  const removeMode = (index) => {
    onChange(modes.filter((_, i) => i !== index));
    setOpen((current) => new Set([...current].filter((at) => at !== index).map((at) => (at > index ? at - 1 : at))));
  };

  return (
    <FormSection
      title="Modi"
      hint="Ein Modus ist eine Spielart, etwa „Suchen & Zerstören“ oder „Grand Prix“. Im Reiter Maps gibst du je Modus die Maps frei; Turniere planen mit seiner Dauer, Liga-Seasons spielen ihn in ihrer Reihenfolge."
      testId={`${testPrefix}-modes`}
    >
      {modes.length === 0 ? (
        <p className="rounded-sm border border-dashed border-white/15 px-4 py-5 text-sm text-white/55" data-testid={`${testPrefix}-modes-empty`}>
          Noch kein Modus. Ohne Modus gilt die Matchdauer des Turniers, sonst 30 Minuten, und jede Map gilt für jeden Pool.
        </p>
      ) : (
        <div className="space-y-2">
          <div className={`${ROW_GRID} hidden md:grid px-3 pr-12 text-[10px] font-bold uppercase tracking-widest text-white/40`} aria-hidden="true">
            <span />
            <span>Modus</span>
            <span>Zustand</span>
            <span>Spieler</span>
            <span>Ergebnisregel</span>
            <span>Dauer</span>
          </div>
          <ul className="space-y-2">
            {modes.map((mode, index) => (
              <ModeRow key={index} mode={mode} index={index} open={open.has(index)} onToggle={() => toggle(index)} setMode={setMode} usage={usage}
                onRemove={() => removeMode(index)} isFirst={index === 0 && modes.length > 1} testPrefix={testPrefix} />
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={modes.length >= MODES_MAX}
          className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid={`${testPrefix}-mode-add`}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Modus hinzufügen
        </button>
        {modes.length >= MODES_MAX && (
          <span className="text-xs text-white/45" data-testid={`${testPrefix}-modes-full`}>Höchstens {MODES_MAX} Modi je Spiel.</span>
        )}
      </div>
      {modes.some((mode) => mode.per_game) && (
        <p className="text-xs text-white/45">Je Einzelspiel: ein Best of 3 plant 2,5 Spiele, ein Best of 5 vier.</p>
      )}
      {modes.length > 0 && (
        <p className="text-xs text-white/45" data-testid={`${testPrefix}-modes-maps`}>
          Entfernen geht nur bei unbenutzten Modi und nimmt sie beim Speichern auch aus den Maps. Einen verwendeten Modus stellst du
          auf „Inaktiv“ oder „Archiviert“.
        </p>
      )}
    </FormSection>
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

export function GameTournamentPresets({ value, onChange, testPrefix = "game-edit" }) {
  const data = value;
  const set = (key, next) => onChange({ ...data, [key]: next });
  const devices = data.station_devices || [];
  const knownDevices = STATION_DEVICE_OPTIONS.map(([key]) => key);
  const deviceOptions = [...STATION_DEVICE_OPTIONS, ...devices.filter((key) => !knownDevices.includes(key)).map((key) => [key, formatDeviceType(key)])];
  const toggleDevice = (key) => set("station_devices", devices.includes(key) ? devices.filter((item) => item !== key) : [...devices, key]);
  const points = parsePointsTable(data.points_table);
  const bestOfOptions = [["", "Keine Vorgabe"], ...[...new Set([...BEST_OF, ...(data.default_best_of ? [String(data.default_best_of)] : [])])]
    .sort((a, b) => Number(a) - Number(b)).map((count) => [count, `Best of ${count}`])];

  return (
    <FormSection
      title="Vorgaben für Turniere"
      hint="Alles freiwillig. Best-of und Spieler je Lauf füllen das Turnierformular vor, die Aufbauzeit kommt zur Dauer aus dem Modus dazu."
      testId={`${testPrefix}-match-data`}
    >
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
