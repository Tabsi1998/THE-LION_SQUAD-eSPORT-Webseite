import { useMemo, useState } from "react";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { emptyMap, emptyMatch, isBanned, matchParticipant } from "@/lib/referenceResults";
import { parseMatchdayPaste } from "@/lib/matchdayPaste";
import { parseLineupPaste } from "@/lib/lineupPaste";
import { dayLabel } from "@/lib/referenceCalendar";
import {
  applyLineupPaste, applyMatchday, isOwnMatch, ownTeamMatcher, pickMatchday, rosterFor, setMapLineup, toggleLineup,
  toggleMatchLineup,
} from "@/lib/teamLeagueEntry";
import { Check, ClipboardList, Plus, Trash2, X } from "lucide-react";

// Team-Liga im Ergebnisblatt (#1931): „Spieltag einfügen“ (Begegnungsliste des Veranstalters - das eigene Spiel wird
// erkannt und ausgefüllt, die übrigen kommen auf Wunsch mit), das eigene Spiel mit Tag und Uhrzeit, die Maps in der
// Reihenfolge des Vetos mit Rolle (unsere Wahl, Wahl Gegner, Decider, Bann) - der Name mit Vorschlägen aus der Saison,
// bis die Map-Bibliothek (#1616) kommt - und die Aufstellung als Ankreuzliste aus dem Kader, auf Wunsch je Map, oder
// eingefügt von der Match-Seite (Häkchen, „x“ oder „ja“). Darunter die übrigen Spiele des Spieltags, kompakt.
// Gerechnet und geprüft wird im Server; hier wird nur das Formular gefüllt.

const SMALL_INPUT = `${INPUT_CLASS} !py-1.5 text-sm`;
const LABEL = "text-[10px] font-bold uppercase tracking-widest text-white/45";
const ICON_BUTTON = "p-1.5 rounded-sm text-white/45 hover:text-white hover:bg-white/5 transition active:scale-[0.97]";
const QUIET_BUTTON = "tls-btn tls-btn--quiet px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5";
const INVALID = "!border-red-400/80";

function invalidProps(fields, field) {
  return fields?.[field] ? { "aria-invalid": true, "data-invalid": field } : {};
}

function FieldErrors({ fields, testId }) {
  const messages = Object.values(fields || {});
  if (!messages.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-red-300" data-testid={testId} role="alert">
      {[...new Set(messages)].map((message) => <li key={message}>{message}</li>)}
    </ul>
  );
}

function PasteErrors({ errors, testId }) {
  if (!errors?.length) return null;
  return (
    <ul className="text-xs text-red-200 space-y-0.5" data-testid={testId} role="alert">
      {errors.map((error, index) => (
        <li key={index}>{error.line ? `Zeile ${error.line}: ` : ""}{error.message}{error.text ? <span className="text-red-200/60"> – „{error.text}“</span> : null}</li>
      ))}
    </ul>
  );
}

/** Ein Name in der Ankreuzliste: gedrückt heißt aufgestellt. */
function PersonToggle({ person, on, onToggle, testId = "result-lineup-person", size = "md" }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-sm border transition-colors active:scale-[0.97] ${size === "sm" ? "min-h-[30px] px-2 text-[11px]" : "min-h-[34px] px-2.5 text-xs"} ${on ? "border-[#29B6E8] bg-[#29B6E8]/15 text-white" : "border-white/10 text-white/60 hover:text-white hover:border-white/25"}`}>
      <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] ${on ? "bg-[#29B6E8] text-[#04121a]" : "ring-1 ring-inset ring-white/25"}`} aria-hidden="true">
        {on && <Check className="h-3 w-3" strokeWidth={3.5} />}
      </span>
      {person.name || "Teilnehmer"}
    </button>
  );
}

function sameEntry(entry, person) {
  return person.id ? entry.participant_id === person.id : String(entry.name || "").toLowerCase() === String(person.name || "").toLowerCase();
}

/** Eingefügter Text mit „Übernehmen“ - für Begegnungsliste und Aufstellung. */
function PasteArea({ label, hint, placeholder, testId, onApply, children }) {
  const [text, setText] = useState("");
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 space-y-2" data-testid={testId}>
      <label className="block">
        <span className={LABEL}>{label}</span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} placeholder={placeholder} data-testid={`${testId}-text`}
          className={`${INPUT_CLASS} mt-1 font-mono text-xs`} />
      </label>
      {hint && <p className="text-xs text-white/50">{hint}</p>}
      {children}
      <button type="button" disabled={!text.trim()} onClick={() => { if (onApply(text)) setText(""); }} data-testid={`${testId}-apply`}
        className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
        Übernehmen
      </button>
    </div>
  );
}

// „Spieltag einfügen“: Begegnungsliste (auch mehrere Spieltage aus der Ansicht „Alle“), dann das eigene Spiel ausfüllen.
function MatchdayPaste({ form, setForm, ownTeams, round, onDone }) {
  const [keepOthers, setKeepOthers] = useState(true);
  const [result, setResult] = useState(null);
  const year = Number(String(round?.club_day || "").slice(0, 4)) || null;

  const choose = (parsed, block) => {
    const outcome = applyMatchday(form, block.rows, { ownTeams, keepOthers });
    setForm(outcome.form);
    setResult({ ...parsed, block, outcome, choose: null });
    onDone?.();
  };
  const apply = (text) => {
    const parsed = parseMatchdayPaste(text, { year });
    if (!parsed.matchdays.length) {
      setResult({ ...parsed, outcome: null, choose: null });
      return false;
    }
    const block = pickMatchday(parsed.matchdays, round);
    if (!block) {
      setResult({ ...parsed, outcome: null, choose: parsed.matchdays });
      return true;
    }
    choose(parsed, block);
    return true;
  };

  // Alle erkannten eigenen Spiele - bei mehreren eigenen Teams am selben Spieltag je Team eines (Prüfung #1931).
  const owns = result?.outcome?.owns || [];
  const own = owns[0];
  const shown = owns.map((row) => `${row.home} ${row.home_score ?? "–"}:${row.away_score ?? "–"} ${row.away}`).join(" · ");
  return (
    <div className="space-y-2">
      <PasteArea label="Begegnungsliste einfügen" testId="result-matchday-paste" onApply={apply}
        placeholder={"Termin\tHeim\tAuswärts\tErgebnis\n17.06.2026 20:30 Uhr\tTeam A\tTeam B\t2:1\n17.06.2026 21:00 Uhr\tTeam C\tTeam D\t0:2"}
        hint="Von der Seite des Veranstalters kopieren (etwa „Spieltage → Alle“): Termin, Heim, Auswärts, Ergebnis. Logo- und Link-Spalten stören nicht; mehrere Spieltage trennt ihre Überschrift. Das eigene Spiel wird erkannt und ausgefüllt.">
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input type="checkbox" checked={keepOthers} onChange={(event) => setKeepOthers(event.target.checked)} data-testid="result-matchday-keep-others" className="w-4 h-4" style={{ accentColor: "#29B6E8" }} />
          Übrige Spiele mitspeichern – sie stehen dann beim Spieltag und zählen in die eigene Tabelle
        </label>
      </PasteArea>
      <PasteErrors errors={result?.errors} testId="result-matchday-errors" />
      {result?.choose && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="result-matchday-choose">
          <span className="text-white/70">Mehrere Spieltage eingefügt – welcher gehört zu diesem Termin?</span>
          {result.choose.map((block, index) => (
            <button key={index} type="button" className={QUIET_BUTTON} onClick={() => choose(result, block)}>
              {block.number ? `${block.number}. Spieltag` : `Liste ${index + 1}`}{block.from ? ` · ${dayLabel(block.from)}` : ""}
            </button>
          ))}
        </div>
      )}
      {result?.outcome && (
        <p className={`text-sm ${own ? "text-white/75" : "text-amber-200"}`} data-testid="result-matchday-summary" role="status">
          {own
            ? <>{owns.length > 1 ? "Eigene Spiele erkannt: " : "Eigenes Spiel erkannt: "}<span className="text-white font-semibold">{shown}</span></>
            : "Kein eigenes Spiel erkannt – stehen die eigenen Teams und ihre Schreibweisen in der Saison?"}
          {result.block?.number ? ` · ${result.block.number}. Spieltag` : ""}
          {result.outcome.others ? ` · ${result.outcome.others} ${result.outcome.others === 1 ? "weiteres Spiel" : "weitere Spiele"} übernommen` : ""}
          {result.outcome.open ? ` · ${result.outcome.open} ${result.outcome.open === 1 ? "Spiel" : "Spiele"} noch ohne Ergebnis (nicht übernommen)` : ""}
        </p>
      )}
    </div>
  );
}

// Rolle im Veto (#1931) und wer: ein Feld statt zweier - gespeichert als `role` und `by` (`own`/`opponent`).
const ROLE_OPTIONS = [
  ["", "Gespielt"], ["picked:own", "Unsere Wahl"], ["picked:opponent", "Wahl Gegner"], ["decider", "Decider"],
  ["banned:own", "Unser Bann"], ["banned:opponent", "Bann Gegner"],
];

function roleValue(item) {
  if (item.role === "picked" || item.role === "banned") return item.by ? `${item.role}:${item.by}` : `${item.role}:own`;
  return item.role === "decider" ? "decider" : "";
}

function MapRow({ match, item, index, errors, onChange, onRemove }) {
  const invalid = errors?.[item.key];
  const set = (values) => onChange({ maps: match.maps.map((entry) => (entry.key === item.key ? { ...entry, ...values } : entry)) });
  const setRole = (value) => {
    const [role, by = ""] = value.split(":");
    set({ role, by, ...(role === "banned" ? { home_score: "", away_score: "", lineup: [] } : {}) });
  };
  const number = index + 1;
  const banned = isBanned(item);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1fr)_9.5rem_auto_auto] items-center gap-2" data-testid="result-map" data-role={item.role || "played"}>
      <input aria-label={`Map ${number}`} value={item.name} maxLength={80} placeholder="Map" list="result-map-names" onChange={(event) => set({ name: event.target.value })} {...invalidProps(invalid, "name")} className={`${SMALL_INPUT} min-w-0 ${invalid?.name ? INVALID : ""}`} data-testid="result-map-name" />
      <select aria-label={`Map ${number}: Rolle im Veto`} value={roleValue(item)} onChange={(event) => setRole(event.target.value)} data-testid="result-map-role"
        className={`${SMALL_INPUT} order-last col-span-3 sm:order-none sm:col-span-1`}>
        {ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {banned ? (
        <span className="w-[6.75rem] text-center text-[10px] font-bold uppercase tracking-widest text-white/40" data-testid="result-map-banned">gesperrt</span>
      ) : (
        <div className="flex items-center gap-1">
          <input aria-label={`Map ${number} Heim`} inputMode="numeric" value={item.home_score} onChange={(event) => set({ home_score: event.target.value })} {...invalidProps(invalid, "home_score")} className={`${SMALL_INPUT} !w-12 text-center tabular-nums ${invalid?.home_score ? INVALID : ""}`} data-testid="result-map-home" />
          <span className="text-white/40">:</span>
          <input aria-label={`Map ${number} Gast`} inputMode="numeric" value={item.away_score} onChange={(event) => set({ away_score: event.target.value })} {...invalidProps(invalid, "away_score")} className={`${SMALL_INPUT} !w-12 text-center tabular-nums ${invalid?.away_score ? INVALID : ""}`} data-testid="result-map-away" />
        </div>
      )}
      <button type="button" className={ICON_BUTTON} onClick={onRemove} aria-label={`Map ${number} entfernen`}><X className="w-4 h-4" /></button>
    </div>
  );
}

// Aufstellung: der Kader des eigenen Teams als Ankreuzliste (dazu, wer sonst aufgestellt ist), auf Wunsch je Map,
// eingefügt von der Match-Seite oder als Name eingetippt.
function LineupPicker({ match, roster, participants, onChange }) {
  const [person, setPerson] = useState("");
  const [pasting, setPasting] = useState(false);
  const [extra, setExtra] = useState([]);
  const [notice, setNotice] = useState(null);
  const people = useMemo(() => {
    const list = [...roster];
    const seen = (candidate) => list.some((entry) => sameEntry({ participant_id: entry.id, name: entry.name }, candidate));
    for (const entry of [...match.lineup.map((item) => ({ id: item.participant_id, name: item.name })), ...extra]) {
      if (!seen(entry)) list.push(entry);
    }
    return list;
  }, [roster, match.lineup, extra]);
  const inLineup = (candidate) => match.lineup.some((entry) => sameEntry(entry, candidate));
  const addPerson = () => {
    const name = person.trim();
    if (!name) return;
    const known = matchParticipant(name, participants);
    const entry = known ? { id: known.id, name: known.name } : { id: "", name };
    if (!inLineup(entry)) onChange({ lineup: toggleLineup(match.lineup, entry) });
    setPerson("");
  };
  const paste = (text) => {
    const parsed = parseLineupPaste(text);
    const outcome = applyLineupPaste(match, parsed, participants, roster);
    setExtra((current) => [...current, ...outcome.extra.filter((entry) => !current.some((item) => sameEntry({ participant_id: item.id, name: item.name }, entry)))]);
    if (outcome.marked) onChange({ lineup: outcome.match.lineup, maps: outcome.match.maps });
    setNotice({ marked: outcome.marked, count: parsed.rows.length, errors: parsed.errors });
    if (parsed.rows.length) setPasting(false);
    return parsed.rows.length > 0;
  };
  const named = match.maps.filter((item) => String(item.name || "").trim() && !isBanned(item));
  return (
    <div className="space-y-2" data-testid="result-lineup-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={LABEL}>Aufstellung · {match.lineup.length} {roster.length ? `von ${roster.length} im Kader` : "aufgestellt"}</span>
        <div className="flex flex-wrap items-center gap-2">
          {named.length > 0 && (
            <label className="inline-flex items-center gap-1.5 text-xs text-white/70">
              <input type="checkbox" checked={Boolean(match.perMap)} onChange={(event) => onChange({ perMap: event.target.checked })} data-testid="result-lineup-per-map" className="w-4 h-4" style={{ accentColor: "#29B6E8" }} />
              je Map
            </label>
          )}
          <button type="button" onClick={() => setPasting((value) => !value)} aria-expanded={pasting} data-testid="result-lineup-paste-toggle" className={QUIET_BUTTON}>
            <ClipboardList className="w-3.5 h-3.5" /> Aufstellung einfügen
          </button>
        </div>
      </div>
      {pasting && (
        <PasteArea label="Aufstellung von der Match-Seite" testId="result-lineup-paste" onApply={paste}
          placeholder={"Seasonteam-Mitglieder\tWarorga\nName A\t✓\nName B\t"}
          hint="Mit Spalte für das Häkchen (✓, x oder ja) wird gleich angekreuzt. Fehlt es – beim Kopieren oft ein Bild –, stehen die Namen zum Ankreuzen da." />
      )}
      {notice && (
        <p className={`text-xs ${notice.marked ? "text-white/60" : "text-amber-200"}`} role="status" data-testid="result-lineup-notice">
          {notice.marked ? `${notice.count} Namen gelesen, Häkchen übernommen.` : `${notice.count} Namen gelesen, aber kein Häkchen erkannt – bitte unten ankreuzen.`}
        </p>
      )}
      <PasteErrors errors={notice?.errors} testId="result-lineup-errors" />
      {people.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" data-testid="result-lineup" aria-label="Kader zum Ankreuzen">
          {people.map((entry) => (
            <li key={entry.id || entry.name}>
              <PersonToggle person={entry} on={inLineup(entry)} onToggle={() => onChange(toggleMatchLineup(match, entry))} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-white/50" data-testid="result-lineup-empty">Noch kein Kader für dieses Team – Namen unten eintragen oder den Kader in der Saison einfügen.</p>
      )}
      {match.perMap && named.map((item, index) => (
        <div key={item.key} className="pl-3 border-l border-white/10 space-y-1" data-testid="result-map-lineup">
          <span className="text-[11px] text-white/55">{item.name || `Map ${index + 1}`}</span>
          <ul className="flex flex-wrap gap-1" aria-label={`Aufstellung ${item.name}`}>
            {people.map((entry) => (
              <li key={entry.id || entry.name}>
                <PersonToggle size="sm" testId="result-map-lineup-person" person={entry}
                  on={(item.lineup || []).some((member) => sameEntry(member, entry))}
                  onToggle={() => onChange(setMapLineup(match, item.key, entry))} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input aria-label="Spieler zur Aufstellung" value={person} list="result-participants" maxLength={120} placeholder="Weiterer Name"
          onChange={(event) => setPerson(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addPerson(); } }}
          data-testid="result-lineup-input" className={`${SMALL_INPUT} !w-auto flex-1 min-w-0`} />
        <button type="button" onClick={addPerson} disabled={!person.trim()} data-testid="result-lineup-add" className={`${QUIET_BUTTON} disabled:opacity-50`}>
          <Plus className="w-3.5 h-3.5" /> Hinzufügen
        </button>
      </div>
    </div>
  );
}

function OwnMatch({ match, index, isOwn, participants, errors, onChange, onRemove }) {
  const invalid = errors?.[match.key];
  const team = isOwn(match.home) || isOwn(match.away);
  const roster = useMemo(() => rosterFor(participants, team, isOwn), [participants, team, isOwn]);
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 space-y-3" data-testid="result-match">
      <div className="flex items-center justify-between">
        <span className={LABEL}>{team ? `Eigenes Spiel · ${team}` : `Spiel ${index + 1}`}</span>
        <button type="button" className={ICON_BUTTON} onClick={onRemove} aria-label={`Spiel ${index + 1} entfernen`} data-testid="result-match-remove"><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
        <label className="block min-w-0"><span className={LABEL}>Heim</span>
          <input value={match.home} maxLength={120} onChange={(event) => onChange({ home: event.target.value })} data-testid="result-match-home" className={SMALL_INPUT} /></label>
        <div className="flex items-center gap-1 pb-0.5">
          <input aria-label="Ergebnis Heim" inputMode="numeric" value={match.home_score} onChange={(event) => onChange({ home_score: event.target.value })} data-testid="result-match-home-score" {...invalidProps(invalid, "home_score")} className={`${SMALL_INPUT} !w-12 text-center tabular-nums ${invalid?.home_score ? INVALID : ""}`} />
          <span className="text-white/40">:</span>
          <input aria-label="Ergebnis Gast" inputMode="numeric" value={match.away_score} onChange={(event) => onChange({ away_score: event.target.value })} data-testid="result-match-away-score" {...invalidProps(invalid, "away_score")} className={`${SMALL_INPUT} !w-12 text-center tabular-nums ${invalid?.away_score ? INVALID : ""}`} />
        </div>
        <label className="block min-w-0"><span className={LABEL}>Auswärts</span>
          <input value={match.away} maxLength={120} onChange={(event) => onChange({ away: event.target.value })} data-testid="result-match-away" className={SMALL_INPUT} /></label>
      </div>
      <FieldErrors fields={invalid} testId="result-match-invalid" />
      <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
        <label className="block"><span className={LABEL}>Tag des Spiels</span>
          <input type="date" value={match.day || ""} onChange={(event) => onChange({ day: event.target.value })} data-testid="result-match-day" className={SMALL_INPUT} /></label>
        <label className="block"><span className={LABEL}>Uhrzeit</span>
          <input type="time" value={match.time || ""} onChange={(event) => onChange({ time: event.target.value })} data-testid="result-match-time" className={SMALL_INPUT} /></label>
      </div>
      <div className="space-y-1.5">
        <span className={LABEL}>Maps · in der Reihenfolge des Vetos</span>
        {match.maps.map((item, mapIndex) => (
          <MapRow key={item.key} match={match} item={item} index={mapIndex} errors={errors} onChange={onChange} onRemove={() => onChange({ maps: match.maps.filter((entry) => entry.key !== item.key) })} />
        ))}
        <button type="button" onClick={() => onChange({ maps: [...match.maps, emptyMap()] })} data-testid="result-map-add" className={QUIET_BUTTON}>
          <Plus className="w-3.5 h-3.5" /> Map
        </button>
      </div>
      <FieldErrors fields={Object.assign({}, ...match.maps.map((item) => errors?.[item.key] || {}))} testId="result-map-invalid" />
      <LineupPicker match={match} roster={roster} participants={participants} onChange={onChange} />
    </div>
  );
}

// Die übrigen Spiele des Spieltags: kompakt, Heim - Ergebnis - Auswärts.
function OtherMatches({ matches, errors, onChange, onRemove, onAdd }) {
  return (
    <div className="space-y-1.5" data-testid="result-others">
      <span className={LABEL}>Übrige Spiele des Spieltags{matches.length ? ` · ${matches.length}` : ""}</span>
      {matches.length === 0 && <p className="text-xs text-white/45">Keine – „Spieltag einfügen“ übernimmt sie mit, sonst „Spiel“.</p>}
      {matches.map((match, index) => {
        const invalid = errors?.[match.key];
        return (
          <div key={match.key} data-testid="result-other">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
              <input aria-label={`Übriges Spiel ${index + 1}: Heim`} value={match.home} maxLength={120} onChange={(event) => onChange(match.key, { home: event.target.value })} className={`${SMALL_INPUT} min-w-0`} data-testid="result-other-home" />
              <div className="flex items-center gap-1">
                <input aria-label={`Übriges Spiel ${index + 1}: Ergebnis Heim`} inputMode="numeric" value={match.home_score} onChange={(event) => onChange(match.key, { home_score: event.target.value })} {...invalidProps(invalid, "home_score")} className={`${SMALL_INPUT} !w-11 text-center tabular-nums ${invalid?.home_score ? INVALID : ""}`} />
                <span className="text-white/40">:</span>
                <input aria-label={`Übriges Spiel ${index + 1}: Ergebnis Gast`} inputMode="numeric" value={match.away_score} onChange={(event) => onChange(match.key, { away_score: event.target.value })} {...invalidProps(invalid, "away_score")} className={`${SMALL_INPUT} !w-11 text-center tabular-nums ${invalid?.away_score ? INVALID : ""}`} />
              </div>
              <input aria-label={`Übriges Spiel ${index + 1}: Auswärts`} value={match.away} maxLength={120} onChange={(event) => onChange(match.key, { away: event.target.value })} className={`${SMALL_INPUT} min-w-0`} data-testid="result-other-away" />
              <button type="button" className={ICON_BUTTON} onClick={() => onRemove(match.key)} aria-label={`Übriges Spiel ${index + 1} entfernen`}><X className="w-4 h-4" /></button>
            </div>
            <FieldErrors fields={invalid} testId="result-other-invalid" />
          </div>
        );
      })}
      <button type="button" onClick={onAdd} data-testid="result-other-add" className={QUIET_BUTTON}><Plus className="w-3.5 h-3.5" /> Spiel</button>
    </div>
  );
}

/**
 * Der Team-Liga-Teil des Ergebnisblatts. `ownTeams`: die eigenen Teams der Saison (`[{name, aliases}]`), `round` der
 * Termin, `participants` die Teilnehmer (Kader über ihr Team), `invalid` die Feldfehler des Formulars.
 */
export function TeamLeagueEntry({ form, setForm, ownTeams, round, participants, invalid, mapNames = [] }) {
  const [pasting, setPasting] = useState(() => !form.matches.some((match) => String(match.home_score || "").trim()));
  const isOwn = useMemo(() => ownTeamMatcher(ownTeams), [ownTeams]);
  const own = form.matches.filter((match) => isOwnMatch(match, isOwn));
  // Ohne erkanntes eigenes Spiel (etwa andere Schreibweise) bleibt das erste Spiel das bearbeitbare.
  const editable = own.length ? own : form.matches.slice(0, 1);
  const others = form.matches.filter((match) => !editable.includes(match));
  const updateMatch = (key, values) => setForm((current) => ({ ...current, matches: current.matches.map((match) => (match.key === key ? { ...match, ...values } : match)) }));
  const removeMatch = (key) => setForm((current) => ({ ...current, matches: current.matches.filter((match) => match.key !== key) }));
  // „Eigenes Spiel“: für das nächste eigene Team, das an diesem Spieltag noch kein Spiel hat (#1926).
  const names = (ownTeams || []).map((team) => team.name);
  const nextOwn = names.find((name) => !own.some((match) => isOwn(match.home) === name || isOwn(match.away) === name)) || names[0] || "";
  return (
    <div className="space-y-3" data-testid="result-team-league">
      {/* Map-Namen: schon in der Saison verwendete und die im Blatt (#1931). */}
      <datalist id="result-map-names">
        {[...new Set([...mapNames, ...form.matches.flatMap((match) => match.maps.map((item) => String(item.name || "").trim()))].filter(Boolean))].map((name) => <option key={name} value={name} />)}
      </datalist>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Spieltag</h3>
        <button type="button" onClick={() => setPasting((value) => !value)} aria-expanded={pasting} data-testid="result-matchday-toggle"
          className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5" /> Spieltag einfügen
        </button>
      </div>
      {pasting && <MatchdayPaste form={form} setForm={setForm} ownTeams={ownTeams} round={round} />}
      {editable.map((match, index) => (
        <OwnMatch key={match.key} match={match} index={index} isOwn={isOwn} participants={participants} errors={invalid}
          onChange={(values) => updateMatch(match.key, values)} onRemove={() => removeMatch(match.key)} />
      ))}
      {(editable.length === 0 || (ownTeams || []).length > 1) && (
        <button type="button" onClick={() => setForm((current) => ({ ...current, matches: [emptyMatch({ home: nextOwn }), ...current.matches] }))} data-testid="result-match-add"
          className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> Eigenes Spiel
        </button>
      )}
      <OtherMatches matches={others} errors={invalid} onChange={updateMatch} onRemove={removeMatch}
        onAdd={() => setForm((current) => ({ ...current, matches: [...current.matches, emptyMatch()] }))} />
    </div>
  );
}
