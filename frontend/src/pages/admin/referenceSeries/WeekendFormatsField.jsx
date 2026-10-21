import { FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import {
  DNF_OPTIONS, GRID_OPTIONS, MAX_SESSION, SESSION_CHOICES, SESSION_POINTS_OPTIONS, emptyFormat, emptySession, formatSummary, pointsPreview, sessionKind,
} from "@/lib/raceWeekend";
import { parsePointsList } from "@/lib/referenceSeries";
import { Plus, X } from "lucide-react";

// Ablauf je Runde (#1930): der Ablauf einer Runde mit Läufen als Vorgabe der Saison - je Lauf Name, Uhrzeit-Versatz,
// Wertung, Punkte (wie das Rennen, keine oder eine eigene Liste - mit Vorschau „P1 35 · P2 30 …“), Punkte trotz DNF,
// Bonus für die schnellste Runde und woher der Startplatz kommt. Ändert sich der Ablauf
// mitten in der Saison, gilt ein weiterer Abschnitt „ab Runde X“. Die Terminliste legt je Zeile alle Läufe an; bestehende
// Termine ändert die Vorgabe nicht, Punkte und Startplätze rechnet der Server aber neu.

const ICON_BUTTON = "p-2 rounded-sm text-white/45 hover:text-white hover:bg-white/5 transition active:scale-[0.97]";

function SessionRow({ session, index, onChange, onRemove, removable, racePoints }) {
  const setLabel = (label) => {
    // Ein Qualifying zählt in der Regel nicht und bringt keine Punkte - die Felder folgen der Wahl, bleiben aber änderbar.
    const kind = sessionKind(label);
    const was = sessionKind(session.label);
    if (kind === was) return onChange({ label });
    return onChange({ label, counts: kind !== "qualifying", points_mode: kind === "qualifying" ? "none" : "series", grid: kind === "race" ? "qualifying" : "manual" });
  };
  // Ein Qualifying mit eigener Liste (etwa P1 = 2) zählt, ohne Punkte nicht - der Haken folgt, bleibt aber änderbar.
  const setPoints = (points_mode) => {
    if (sessionKind(session.label) !== "qualifying") return onChange({ points_mode });
    return onChange({ points_mode, counts: points_mode !== "none" });
  };
  const list = session.points_mode === "own" ? parsePointsList(session.points) : session.points_mode === "series" ? racePoints || [] : [];
  return (
    <li className="space-y-2 border-t border-white/5 pt-3 first:border-t-0 first:pt-0" data-testid="weekend-session">
      {/* Oben Name, Versatz und Entfernen; darunter Punkte und Startplatz in voller Breite - die Auswahl bleibt lesbar. */}
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] gap-2 items-end">
        <TextField label={`Lauf ${index + 1}`} value={session.label} onChange={setLabel} suggestions={SESSION_CHOICES} maxLength={MAX_SESSION} placeholder="Rennen" testId="weekend-session-label" />
        <TextField label="Versatz (Min.)" type="number" step="5" value={session.offset} onChange={(offset) => onChange({ offset })} testId="weekend-session-offset" />
        <button type="button" onClick={onRemove} disabled={!removable} className={`${ICON_BUTTON} disabled:opacity-25`} aria-label={`Lauf ${index + 1} entfernen`} title="Entfernen" data-testid="weekend-session-remove">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-2 min-w-0">
          <SelectField label="Punkte" value={session.points_mode} onChange={setPoints} options={SESSION_POINTS_OPTIONS} testId="weekend-session-points-mode" />
          {session.points_mode === "own" && (
            <TextField label="Punkte je Platz" value={session.points} onChange={(points) => onChange({ points })} placeholder="12, 9, 7, 6, 5" testId="weekend-session-points" />
          )}
          <p className="text-xs text-white/55 tabular-nums" data-testid="weekend-session-preview">
            {session.points_mode === "series" && racePoints === null ? "Wie das Rennen (laut Veranstalter)" : pointsPreview(list)}
          </p>
        </div>
        <div className="space-y-2 min-w-0">
          <SelectField label="Startplatz" value={session.grid} onChange={(grid) => onChange({ grid })} options={GRID_OPTIONS} testId="weekend-session-grid" />
          <CheckField label="Zählt zur Wertung" checked={session.counts} onChange={(counts) => onChange({ counts })} testId="weekend-session-counts" />
        </div>
        <SelectField label="Punkte trotz DNF" value={session.dnf} onChange={(dnf) => onChange({ dnf })} options={DNF_OPTIONS} testId="weekend-session-dnf" />
        <TextField label="Schnellste Runde: Bonus" type="number" min="0" step="any" value={session.fastest_lap} onChange={(fastest_lap) => onChange({ fastest_lap })}
          placeholder="wie die Saison" hint="Leer: wie die Saison." testId="weekend-session-fastest-lap" />
      </div>
    </li>
  );
}

/** `formats`: Abschnitte aus `weekendToForm`; `onChange` bekommt die neue Liste. Leer heißt: keine Vorgabe. `racePoints`:
 * das Schema der Saison (für „Wie Rennen“ in der Vorschau). */
export function WeekendFormatsField({ formats, onChange, racePoints = [] }) {
  const update = (key, values) => onChange(formats.map((format) => (format.key === key ? { ...format, ...values } : format)));
  const updateSession = (format, sessionKey, values) => update(format.key, {
    sessions: format.sessions.map((session) => (session.key === sessionKey ? { ...session, ...values } : session)),
  });
  const addPhase = () => {
    const last = formats[formats.length - 1];
    const from = Math.max(2, (Number(last?.from_round) || 1) + 1);
    // Ein neuer Abschnitt beginnt mit den Läufen des letzten - meist ändert sich nur eine Kleinigkeit.
    onChange([...formats, emptyFormat({ from_round: String(from), sessions: last.sessions.map((session) => emptySession({ ...session, key: null })) })]);
  };
  return (
    <FormSection title="Ablauf je Runde" plain testId="series-weekend"
      hint="Eine Runde (gleiches Kürzel) hat mehrere Läufe – etwa Qualifying, Sprint und Rennen. Die Terminliste legt je Zeile alle Läufe an, mit dem Versatz ab der Uhrzeit der Zeile. Ein Qualifying zählt in der Regel nicht; sein Platz 1 ist die Pole.">
      {formats.length === 0 ? (
        <button type="button" onClick={() => onChange([emptyFormat()])} data-testid="weekend-add"
          className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Ablauf festlegen
        </button>
      ) : (
        <>
          <ol className="space-y-3">
            {formats.map((format, index) => (
              <li key={format.key} className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 space-y-3" data-testid="weekend-format">
                <div className="flex items-end gap-3">
                  {/* „Format 1: Quali + Sprint + Hauptrennen“ - die Läufe in zeitlicher Reihenfolge. */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold uppercase tracking-widest text-white/60" data-testid="weekend-format-title">
                      {`Format ${index + 1}`}{index === 0 ? " · ab Runde 1" : ""}
                    </p>
                    <p className="mt-0.5 text-sm text-white/80 [overflow-wrap:anywhere]" data-testid="weekend-format-summary">{formatSummary(format.sessions)}</p>
                  </div>
                  {index > 0 && (
                    <TextField label="Ab Runde" type="number" min="2" value={format.from_round} onChange={(from_round) => update(format.key, { from_round })} className="w-28 shrink-0" testId="weekend-format-from" />
                  )}
                  {/* Der erste Abschnitt geht nur zusammen mit allen - die Vorgabe beginnt immer bei Runde 1. */}
                  <button type="button" onClick={() => onChange(formats.filter((item) => item.key !== format.key))} className={`${ICON_BUTTON} disabled:opacity-25`}
                    disabled={index === 0 && formats.length > 1}
                    aria-label={index === 0 ? "Ablauf je Runde entfernen" : `Format ab Runde ${format.from_round} entfernen`} title="Entfernen" data-testid="weekend-format-remove">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <ol className="space-y-2">
                  {format.sessions.map((session, position) => (
                    <SessionRow key={session.key} session={session} index={position} removable={format.sessions.length > 1} racePoints={racePoints}
                      onChange={(values) => updateSession(format, session.key, values)}
                      onRemove={() => update(format.key, { sessions: format.sessions.filter((item) => item.key !== session.key) })} />
                  ))}
                </ol>
                {format.sessions.length < 6 && (
                  <button type="button" onClick={() => update(format.key, { sessions: [...format.sessions, emptySession({ label: "Sprint", grid: "manual" })] })} data-testid="weekend-session-add"
                    className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Lauf
                  </button>
                )}
              </li>
            ))}
          </ol>
          <button type="button" onClick={addPhase} data-testid="weekend-phase-add"
            className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Format ab Runde …
          </button>
        </>
      )}
    </FormSection>
  );
}
