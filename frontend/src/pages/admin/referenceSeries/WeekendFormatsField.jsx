import { FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import {
  GRID_OPTIONS, MAX_SESSION, SESSION_CHOICES, SESSION_POINTS_OPTIONS, emptyFormat, emptySession, sessionKind,
} from "@/lib/raceWeekend";
import { Plus, X } from "lucide-react";

// Läufe je Runde (#1930): der Ablauf eines Rennwochenendes als Vorgabe der Saison - je Lauf Name, Uhrzeit-Versatz,
// Wertung, Punkte (wie die Saison, keine oder ein eigenes Schema) und woher der Startplatz kommt. Ändert sich der Ablauf
// mitten in der Saison, gilt ein weiterer Abschnitt „ab Runde X“. Die Terminliste legt je Zeile alle Läufe an; bestehende
// Termine ändert die Vorgabe nicht, Punkte und Startplätze rechnet der Server aber neu.

const ICON_BUTTON = "p-2 rounded-sm text-white/45 hover:text-white hover:bg-white/5 transition active:scale-[0.97]";

function SessionRow({ session, index, onChange, onRemove, removable }) {
  const setLabel = (label) => {
    // Ein Qualifying zählt in der Regel nicht und bringt keine Punkte - die Felder folgen der Wahl, bleiben aber änderbar.
    const kind = sessionKind(label);
    const was = sessionKind(session.label);
    if (kind === was) return onChange({ label });
    return onChange({ label, counts: kind !== "qualifying", points_mode: kind === "qualifying" ? "none" : "series", grid: kind === "race" ? "qualifying" : "manual" });
  };
  return (
    <li className="grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_6rem_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-start border-t border-white/5 pt-2 first:border-t-0 first:pt-0" data-testid="weekend-session">
      <TextField label={`Lauf ${index + 1}`} value={session.label} onChange={setLabel} suggestions={SESSION_CHOICES} maxLength={MAX_SESSION} placeholder="Rennen" testId="weekend-session-label" />
      <TextField label="Versatz (Min.)" type="number" step="5" value={session.offset} onChange={(offset) => onChange({ offset })} testId="weekend-session-offset" />
      <div className="space-y-2 min-w-0">
        <SelectField label="Punkte" value={session.points_mode} onChange={(points_mode) => onChange({ points_mode })} options={SESSION_POINTS_OPTIONS} testId="weekend-session-points-mode" />
        {session.points_mode === "own" && (
          <TextField label="Punkte je Platz" value={session.points} onChange={(points) => onChange({ points })} placeholder="12, 9, 7, 6, 5" testId="weekend-session-points" />
        )}
      </div>
      <div className="space-y-2 min-w-0">
        <SelectField label="Startplatz" value={session.grid} onChange={(grid) => onChange({ grid })} options={GRID_OPTIONS} testId="weekend-session-grid" />
        <CheckField label="Zählt zur Wertung" checked={session.counts} onChange={(counts) => onChange({ counts })} testId="weekend-session-counts" />
      </div>
      <button type="button" onClick={onRemove} disabled={!removable} className={`${ICON_BUTTON} sm:mt-5 justify-self-end disabled:opacity-25`} aria-label={`Lauf ${index + 1} entfernen`} title="Entfernen" data-testid="weekend-session-remove">
        <X className="w-4 h-4" />
      </button>
    </li>
  );
}

/** `formats`: Abschnitte aus `weekendToForm`; `onChange` bekommt die neue Liste. Leer heißt: keine Vorgabe. */
export function WeekendFormatsField({ formats, onChange }) {
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
    <FormSection title="Läufe je Runde" plain testId="series-weekend"
      hint="Rennwochenende: Eine Runde (gleiches Kürzel) hat mehrere Läufe – etwa Qualifying, Sprint und Rennen. Die Terminliste legt je Zeile alle Läufe an, mit dem Versatz ab der Uhrzeit der Zeile. Ein Qualifying zählt in der Regel nicht; sein Platz 1 ist die Pole.">
      {formats.length === 0 ? (
        <button type="button" onClick={() => onChange([emptyFormat()])} data-testid="weekend-add"
          className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Läufe festlegen
        </button>
      ) : (
        <>
          <ol className="space-y-3">
            {formats.map((format, index) => (
              <li key={format.key} className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 space-y-3" data-testid="weekend-format">
                <div className="flex items-end gap-3">
                  {index === 0 ? (
                    <p className="flex-1 text-xs font-bold uppercase tracking-widest text-white/60">Ab Runde 1</p>
                  ) : (
                    <TextField label="Ab Runde" type="number" min="2" value={format.from_round} onChange={(from_round) => update(format.key, { from_round })} className="w-32" testId="weekend-format-from" />
                  )}
                  <span className="flex-1" />
                  {/* Der erste Abschnitt geht nur zusammen mit allen - die Vorgabe beginnt immer bei Runde 1. */}
                  <button type="button" onClick={() => onChange(formats.filter((item) => item.key !== format.key))} className={`${ICON_BUTTON} disabled:opacity-25`}
                    disabled={index === 0 && formats.length > 1}
                    aria-label={index === 0 ? "Läufe je Runde entfernen" : `Abschnitt ab Runde ${format.from_round} entfernen`} title="Entfernen" data-testid="weekend-format-remove">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <ol className="space-y-2">
                  {format.sessions.map((session, position) => (
                    <SessionRow key={session.key} session={session} index={position} removable={format.sessions.length > 1}
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
            <Plus className="w-3.5 h-3.5" /> Ab Runde … anders
          </button>
        </>
      )}
    </FormSection>
  );
}
