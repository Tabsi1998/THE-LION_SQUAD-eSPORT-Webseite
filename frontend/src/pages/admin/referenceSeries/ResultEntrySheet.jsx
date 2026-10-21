import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { INPUT_CLASS, TextAreaField } from "@/components/tls/FormFields";
import { roundWhen } from "@/lib/referenceCalendar";
import { qualifyingMode, roundKind, sessionLabel } from "@/lib/raceWeekend";
import { parseResultPaste, parseTablePaste } from "@/lib/resultPaste";
import {
  MARK_OPTIONS, autoPlaces, countFieldErrors, fieldErrors, hintToPoints, emptyMap, emptyMatch, emptyRow, formStamp, formToPayload, formatPoints, matchParticipant,
  pastedToRows, problemsByRow, scoredText, sheetToForm,
} from "@/lib/referenceResults";
import { ResultPreview } from "./ResultPreview";
import { VenueWithFlag } from "@/components/tls/CountryFlag";
import { ResultImageButton, ResultImageRowNote, ResultImageSummary, ocrMark, useResultImage } from "./ResultImageImport";
import { RACE_FIELD_GROUPS, afterEdit, confirmRow, imageFormFields, imageToRows, isUncertain, openImageItems, replaceRaceMarks } from "@/lib/resultImage";
import { toast } from "sonner";
import { ClipboardList, Plus, RefreshCw, SlidersHorizontal, Trash2, X } from "lucide-react";

// Ergebnis eintragen (#1744): ein Termin, eine dynamische Liste. Zeilen hinzufügen und entfernen, Platz aus der
// Reihenfolge (überschreibbar), Name mit Vorschlag aus den Teilnehmern, Team je Rennen, Punkte leer = nach Schlüssel,
// Marken und Strafpunkte unter „Mehr“. Team-Liga: Spiel mit Ergebnis, Maps und Aufstellung, dazu die Tabelle laut
// Veranstalter zum Einfügen. Erst prüft der Server (Vorschau), dann wird übernommen – als Entwurf, veröffentlicht oder,
// wenn das Blatt schon veröffentlicht ist und die Person nicht veröffentlichen darf, als Entwurf daneben.
// Rennliga (#1927): je Zeile unter „Mehr“ auch Startplatz, Zeit und Abstand, je Rennen schnellste Runde mit Zeit und
// Fahrer des Tages – das Einfügen füllt sie aus Tabellen mit diesen Spalten. Qualifying (#1930): statt der Punkte die
// Zeit in der Zeile, keine schnellste Runde und kein Fahrer des Tages; die Pole setzt der Server (Platz 1).

const SMALL_INPUT = `${INPUT_CLASS} !py-1.5 text-sm`;
const LABEL = "text-[10px] font-bold uppercase tracking-widest text-white/45";
const ICON_BUTTON = "p-1.5 rounded-sm text-white/45 hover:text-white hover:bg-white/5 transition active:scale-[0.97]";

function PasteBox({ onApply, label, placeholder, hint, testId }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState([]);
  const apply = () => {
    const result = onApply(text);
    setErrors(result.errors);
    if (result.rows.length) setText("");
  };
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 space-y-2" data-testid={testId}>
      <TextAreaField label={label} value={text} onChange={(value) => { setText(value); setErrors([]); }} rows={5} placeholder={placeholder} hint={hint} testId={`${testId}-text`} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={apply} disabled={!text.trim()} data-testid={`${testId}-apply`} className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          Liste übernehmen
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="text-xs text-red-200 space-y-0.5" data-testid={`${testId}-errors`} role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error.line ? `Zeile ${error.line}: ` : ""}{error.message}{error.text ? <span className="text-red-200/60"> – „{error.text}“</span> : null}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RowProblems({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs" data-testid="result-row-problems">
      {items.map((item, index) => (
        <li key={index} className={item.level === "error" ? "text-red-300" : "text-amber-300"}>{item.message}</li>
      ))}
    </ul>
  );
}

// Ungültige Eingabe: roter Rahmen und `aria-invalid` – die Meldung steht unter der Zeile.
function invalidProps(fields, field) {
  return fields?.[field] ? { "aria-invalid": true, "data-invalid": field } : {};
}
const INVALID = "!border-red-400/80";

function FieldErrors({ fields, testId }) {
  const messages = Object.values(fields || {});
  if (!messages.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-red-300" data-testid={testId} role="alert">
      {[...new Set(messages)].map((message) => <li key={message}>{message}</li>)}
    </ul>
  );
}

function ResultRow({ row, index, autoPlace, organizerMode, qualifying = false, problems, info, invalid, onChange, onHint, onRemove, onConfirmImage }) {
  const scored = info?.scored;
  // Offen von selbst nur, wo etwas Ungewöhnliches steht (Strafe, Gesamtstand, „zählen statt Schlüssel“) oder eine Eingabe
  // ungültig ist. Startnummer, Startplatz, Zeit und Abstand (#1927) stehen zugeklappt kurz unter der Zeile - so bleibt
  // eine eingefügte Liste mit 20 Fahrern überschaubar. Aus dem Bild (#1756) auch, wenn ein Feld darunter gelb ist - offen
  // ab dem Anlegen, damit es beim Korrigieren nicht zuklappt.
  const [opened, setOpen] = useState(() => Boolean(row.penalty_points || row.penalty_seconds || row.official_total || row.override
    || ["start_number", "grid", "time", "gap"].some((field) => isUncertain(row, field))));
  const open = opened || Boolean(invalid?.grid || invalid?.penalty_points || invalid?.penalty_seconds || invalid?.official_total);
  const raceLine = [row.start_number && `Nr. ${row.start_number}`, row.grid && `Startplatz ${row.grid}`, row.time, row.gap, row.penalty_seconds && `+${row.penalty_seconds} s Strafe`].filter(Boolean).join(" · ");
  const mark = (field) => ocrMark(row, field, index);
  const level = invalid || problems?.some((item) => item.level === "error") ? "error" : problems?.length || row.ocr ? "warning" : null;
  const toggleMark = (mark) => onChange({ marks: row.marks.includes(mark) ? row.marks.filter((item) => item !== mark) : [...row.marks, mark] });
  const number = index + 1;
  return (
    <li data-testid="result-row" data-level={level || undefined}
      className={`py-2.5 pl-2 border-l-2 ${level === "error" ? "border-red-400/70" : level === "warning" ? "border-amber-400/60" : "border-transparent"}`}>
      {/* Handy: Platz, Name, Punkte und Knöpfe in einer Zeile, das Team darunter; ab sm alles in einer Zeile. */}
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem_auto_auto] sm:grid-cols-[3.5rem_minmax(0,1fr)_9rem_5rem_auto_auto] items-center gap-2">
        <input aria-label={`Platz Zeile ${number}`} inputMode="numeric" value={row.place} placeholder={autoPlace ? String(autoPlace) : "–"}
          onChange={(event) => onChange({ place: event.target.value })} data-testid="result-row-place" {...invalidProps(invalid, "place")} {...mark("place").props} className={`${SMALL_INPUT} text-center tabular-nums ${mark("place").className} ${invalid?.place ? INVALID : ""}`} />
        <input aria-label={`Name Zeile ${number}`} value={row.name} list="result-participants" placeholder="Name wie beim Veranstalter" maxLength={120}
          onChange={(event) => onChange({ name: event.target.value, participant_id: "" })} data-testid="result-row-name" {...mark("name").props} className={`${SMALL_INPUT} ${mark("name").className}`} />
        <input aria-label={`Team Zeile ${number}`} value={row.team} list="result-teams" placeholder="Team" maxLength={120}
          onChange={(event) => onChange({ team: event.target.value })} data-testid="result-row-team" {...mark("team").props} className={`${SMALL_INPUT} ${mark("team").className} order-last col-start-2 col-end-6 sm:order-none sm:col-start-auto sm:col-end-auto`} />
        {/* Qualifying (#1930): die Zeit statt der Punkte in der Zeile. */}
        {qualifying ? (
          <input aria-label={`Zeit Zeile ${number}`} value={row.time} placeholder="Zeit" maxLength={20} title="Rundenzeit; leer oder „--:--.---“: ohne Zeit"
            onChange={(event) => onChange({ time: event.target.value })} data-testid="result-row-quali-time" {...mark("time").props} className={`${SMALL_INPUT} text-right tabular-nums ${mark("time").className}`} />
        ) : (
          <input aria-label={`Punkte Zeile ${number}`} inputMode="decimal" value={row.points} placeholder="Pkt"
            title={organizerMode ? "Punkte laut Veranstalter" : "Leer: nach Schlüssel. Eingetragen: laut Veranstalter (wird geprüft)."}
            onChange={(event) => onChange({ points: event.target.value })} data-testid="result-row-points" {...invalidProps(invalid, "points")} {...mark("points").props} className={`${SMALL_INPUT} text-right tabular-nums ${mark("points").className} ${invalid?.points ? INVALID : ""}`} />
        )}
        <button type="button" className={`${ICON_BUTTON} ${open ? "text-[#29B6E8]" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`Mehr zu Zeile ${number}`} title="Marken, Strafpunkte, Startnummer, Startplatz, Zeit, Abstand" data-testid="result-row-more">
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        <button type="button" className={ICON_BUTTON} onClick={onRemove} aria-label={`Zeile ${number} entfernen`} title="Entfernen" data-testid="result-row-remove">
          <X className="w-4 h-4" />
        </button>
      </div>
      {(open || row.marks.length > 0) && (
        <div className={`mt-2 flex flex-wrap gap-1.5 ${isUncertain(row, "marks") ? "rounded-sm ring-1 ring-amber-400/60 p-1" : ""}`} role="group" aria-label={`Marken Zeile ${number}`}>
          {MARK_OPTIONS.map(([mark, label]) => {
            const active = row.marks.includes(mark);
            if (!open && !active) return null;
            return (
              <button key={mark} type="button" aria-pressed={active} onClick={() => toggleMark(mark)} data-testid={`result-row-mark-${mark}`}
                className={`px-2 py-1 rounded-sm border text-[10px] font-bold uppercase tracking-wider transition-colors active:scale-[0.97] ${active ? "border-[#29B6E8] bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/10 text-white/50 hover:text-white"}`}>
                {label}
              </button>
            );
          })}
        </div>
      )}
      {open && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="result-row-details">
          <label className="block"><span className={LABEL}>Strafpunkte</span>
            <input inputMode="decimal" value={row.penalty_points} onChange={(event) => onChange({ penalty_points: event.target.value })} data-testid="result-row-penalty" {...invalidProps(invalid, "penalty_points")} className={`${SMALL_INPUT} ${invalid?.penalty_points ? INVALID : ""}`} /></label>
          <label className="block"><span className={LABEL}>Startnummer</span>
            <input value={row.start_number} maxLength={10} onChange={(event) => onChange({ start_number: event.target.value })} data-testid="result-row-start" {...mark("start_number").props} className={`${SMALL_INPUT} ${mark("start_number").className}`} /></label>
          <label className="block"><span className={LABEL}>Startplatz</span>
            <input inputMode="numeric" value={row.grid} onChange={(event) => onChange({ grid: event.target.value })} data-testid="result-row-grid" {...invalidProps(invalid, "grid")} {...mark("grid").props} className={`${SMALL_INPUT} tabular-nums ${mark("grid").className} ${invalid?.grid ? INVALID : ""}`} /></label>
          <label className="block"><span className={LABEL}>Zeit</span>
            <input value={row.time} maxLength={20} onChange={(event) => onChange({ time: event.target.value })} data-testid="result-row-time" {...mark("time").props} className={`${SMALL_INPUT} tabular-nums ${mark("time").className}`} /></label>
          <label className="block"><span className={LABEL}>Abstand</span>
            <input value={row.gap} maxLength={20} onChange={(event) => onChange({ gap: event.target.value })} data-testid="result-row-gap" {...mark("gap").props} className={`${SMALL_INPUT} tabular-nums ${mark("gap").className}`} /></label>
          <label className="block"><span className={LABEL}>Strafsekunden</span>
            <input inputMode="decimal" value={row.penalty_seconds} title="Zeitstrafe in Sekunden – nur Anzeige in der Ergebnistabelle" onChange={(event) => onChange({ penalty_seconds: event.target.value })} data-testid="result-row-penalty-seconds" {...invalidProps(invalid, "penalty_seconds")} className={`${SMALL_INPUT} tabular-nums ${invalid?.penalty_seconds ? INVALID : ""}`} /></label>
          <label className="block"><span className={LABEL}>Gesamt laut Veranst.</span>
            <input inputMode="decimal" value={row.official_total} onChange={(event) => onChange({ official_total: event.target.value })} data-testid="result-row-total" {...invalidProps(invalid, "official_total")} className={`${SMALL_INPUT} ${invalid?.official_total ? INVALID : ""}`} /></label>
          {!organizerMode && (
            <label className="flex items-end gap-2 pb-2 text-xs text-white/70">
              <input type="checkbox" checked={row.override} onChange={(event) => onChange({ override: event.target.checked })} data-testid="result-row-override" className="accent-[#29B6E8]" />
              Punkte zählen statt Schlüssel
            </label>
          )}
        </div>
      )}
      {!open && raceLine && <div className="mt-1 text-[11px] text-white/55 tabular-nums" data-testid="result-row-race">{raceLine}</div>}
      {info && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-white/45 tabular-nums">
          {/* Bekannt oder neu sagt die Vorschau jedem; ob jemand Vereinsmitglied ist, nur dem Vorstand. */}
          <span data-testid="result-row-known" className={info.is_new ? "font-bold uppercase tracking-widest text-amber-300" : undefined}>{info.is_new ? "neu" : "bekannt"}</span>
          {scored && <span data-testid="result-row-scored">= {scoredText(scored)}</span>}
        </div>
      )}
      {row.points_hint && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-300" data-testid="result-row-hint">
          <span>„{row.points_hint.text}“ am Ende: Teil des Namens oder Punkte?</span>
          <button type="button" onClick={onHint} data-testid="result-row-hint-points" className="underline underline-offset-2 hover:text-amber-100">Letzte Zahl = Punkte</button>
          <button type="button" onClick={() => onChange({ points_hint: null })} data-testid="result-row-hint-name" className="underline underline-offset-2 text-amber-300/70 hover:text-amber-100">Gehört zum Namen</button>
        </div>
      )}
      <FieldErrors fields={invalid} testId="result-row-invalid" />
      <ResultImageRowNote row={row} onConfirm={onConfirmImage} />
      <RowProblems items={problems} />
    </li>
  );
}

// Je Rennen (#1927): schnellste Runde mit Zeit und Fahrer des Tages - Namen aus der Liste oben (Vorschläge). Feldfehler
// (Zeit ohne Fahrer) und Meldungen der Vorschau zu diesen Feldern stehen direkt darunter. Aus dem Bild (#1756) sind
// unsichere Felder gelb wie an den Zeilen: Ändern nimmt die Markierung weg, „Passt so“ bestätigt alle.
function RaceExtras({ form, onChange, invalid, problems = {} }) {
  const imageMarks = { ocr: form.raceOcr };
  const mark = (field) => ocrMark(imageMarks, field);
  const set = (key, values, field) => onChange({ [key]: values, ...(form.raceOcr ? { raceOcr: afterEdit(imageMarks, [field]).ocr } : {}) });
  const lapInvalid = Boolean(invalid?.fastest_lap || problems.fastest_lap?.some((item) => item.level === "error"));
  const dayInvalid = Boolean(problems.driver_of_the_day?.some((item) => item.level === "error"));
  const messages = [
    ...(invalid?.fastest_lap ? [{ level: "error", message: invalid.fastest_lap }] : []),
    ...(problems.fastest_lap || []), ...(problems.driver_of_the_day || []),
  ];
  return (
    <section className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)] items-end" data-testid="result-race">
      <label className="block min-w-0"><span className={LABEL}>Schnellste Runde</span>
        <input value={form.fastestLap.name} list="result-row-names" maxLength={120} placeholder="Name aus der Liste"
          onChange={(event) => set("fastestLap", { ...form.fastestLap, name: event.target.value }, "fastest_lap_name")} data-testid="result-fastest-name"
          aria-invalid={lapInvalid || undefined} {...mark("fastest_lap_name").props} className={`${SMALL_INPUT} ${mark("fastest_lap_name").className} ${lapInvalid ? INVALID : ""}`} /></label>
      <label className="block"><span className={LABEL}>Rundenzeit</span>
        <input value={form.fastestLap.time} maxLength={20} placeholder="1:31.456"
          onChange={(event) => set("fastestLap", { ...form.fastestLap, time: event.target.value }, "fastest_lap_time")} data-testid="result-fastest-time"
          {...mark("fastest_lap_time").props} className={`${SMALL_INPUT} tabular-nums ${mark("fastest_lap_time").className}`} /></label>
      <label className="block min-w-0"><span className={LABEL}>Fahrer des Tages</span>
        <input value={form.driverOfTheDay} list="result-row-names" maxLength={120} placeholder="Name aus der Liste"
          onChange={(event) => set("driverOfTheDay", event.target.value, "driver_of_the_day")} data-testid="result-dotd"
          aria-invalid={dayInvalid || undefined} {...mark("driver_of_the_day").props} className={`${SMALL_INPUT} ${mark("driver_of_the_day").className} ${dayInvalid ? INVALID : ""}`} /></label>
      {form.raceOcr && (
        <div className="sm:col-span-3">
          <ResultImageRowNote row={imageMarks} onConfirm={() => onChange({ raceOcr: null })} testId="result-race-ocr" />
        </div>
      )}
      {messages.length > 0 && (
        <ul className="sm:col-span-3 space-y-0.5 text-xs" data-testid="result-race-problems" role="alert">
          {messages.map((item, index) => (
            <li key={index} className={item.level === "error" ? "text-red-300" : "text-amber-300"}>{item.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MatchEditor({ match, index, participants, errors, onChange, onRemove }) {
  const invalid = errors?.[match.key];
  const [person, setPerson] = useState("");
  const setMap = (key, values) => onChange({ maps: match.maps.map((item) => (item.key === key ? { ...item, ...values } : item)) });
  const addPerson = () => {
    const name = person.trim();
    if (!name) return;
    const known = matchParticipant(name, participants);
    const entry = known ? { participant_id: known.id, name: known.name } : { participant_id: "", name };
    if (!match.lineup.some((item) => (entry.participant_id ? item.participant_id === entry.participant_id : item.name === name))) {
      onChange({ lineup: [...match.lineup, entry] });
    }
    setPerson("");
  };
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 space-y-3" data-testid="result-match">
      <div className="flex items-center justify-between">
        <span className={LABEL}>Spiel {index + 1}</span>
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
        <label className="block min-w-0"><span className={LABEL}>Gegner</span>
          <input value={match.away} maxLength={120} onChange={(event) => onChange({ away: event.target.value })} data-testid="result-match-away" className={SMALL_INPUT} /></label>
      </div>
      <FieldErrors fields={invalid} testId="result-match-invalid" />
      <div className="space-y-1.5">
        <span className={LABEL}>Maps</span>
        {match.maps.map((item, mapIndex) => (
          <div key={item.key} className="flex items-center gap-2" data-testid="result-map">
            <input aria-label={`Map ${mapIndex + 1}`} value={item.name} maxLength={80} placeholder="Map" onChange={(event) => setMap(item.key, { name: event.target.value })} {...invalidProps(errors?.[item.key], "name")} className={`${SMALL_INPUT} !w-auto flex-1 min-w-0 ${errors?.[item.key]?.name ? INVALID : ""}`} data-testid="result-map-name" />
            <input aria-label={`Map ${mapIndex + 1} Heim`} inputMode="numeric" value={item.home_score} onChange={(event) => setMap(item.key, { home_score: event.target.value })} {...invalidProps(errors?.[item.key], "home_score")} className={`${SMALL_INPUT} !w-12 text-center tabular-nums ${errors?.[item.key]?.home_score ? INVALID : ""}`} data-testid="result-map-home" />
            <span className="text-white/40">:</span>
            <input aria-label={`Map ${mapIndex + 1} Gast`} inputMode="numeric" value={item.away_score} onChange={(event) => setMap(item.key, { away_score: event.target.value })} {...invalidProps(errors?.[item.key], "away_score")} className={`${SMALL_INPUT} !w-12 text-center tabular-nums ${errors?.[item.key]?.away_score ? INVALID : ""}`} data-testid="result-map-away" />
            <button type="button" className={ICON_BUTTON} onClick={() => onChange({ maps: match.maps.filter((entry) => entry.key !== item.key) })} aria-label={`Map ${mapIndex + 1} entfernen`}><X className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => onChange({ maps: [...match.maps, emptyMap()] })} data-testid="result-map-add" className="tls-btn tls-btn--quiet px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Map
        </button>
      </div>
      <FieldErrors fields={Object.assign({}, ...match.maps.map((item) => errors?.[item.key] || {}))} testId="result-map-invalid" />
      <div className="space-y-1.5">
        <span className={LABEL}>Aufstellung</span>
        {match.lineup.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" data-testid="result-lineup">
            {match.lineup.map((item, personIndex) => (
              <li key={item.participant_id || item.name} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 border border-white/10 rounded-sm text-xs text-white/80">
                {item.name || "Teilnehmer"}
                <button type="button" onClick={() => onChange({ lineup: match.lineup.filter((_, position) => position !== personIndex) })} aria-label={`${item.name} aus der Aufstellung nehmen`} className="p-0.5 text-white/40 hover:text-white"><X className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <input aria-label="Spieler zur Aufstellung" value={person} list="result-participants" maxLength={120} placeholder="Name"
            onChange={(event) => setPerson(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addPerson(); } }}
            data-testid="result-lineup-input" className={`${SMALL_INPUT} !w-auto flex-1 min-w-0`} />
          <button type="button" onClick={addPerson} disabled={!person.trim()} data-testid="result-lineup-add" className="tls-btn tls-btn--quiet px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Hinzufügen
          </button>
        </div>
      </div>
    </div>
  );
}

function OfficialTable({ rows, onPaste, onClear }) {
  return (
    <section className="space-y-2" data-testid="result-table">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Tabelle laut Veranstalter</h3>
        {rows.length > 0 && <button type="button" onClick={onClear} data-testid="result-table-clear" className="tls-btn tls-btn--quiet px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider">Leeren</button>}
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-white/45">
                <th className="py-1 pr-2 font-bold">#</th><th className="py-1 pr-2 font-bold">Team</th><th className="py-1 pr-2 font-bold">Sp</th>
                <th className="py-1 pr-2 font-bold">S-U-N</th><th className="py-1 pr-2 font-bold">Maps</th><th className="py-1 font-bold text-right">Pkt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.team}-${index}`} className="border-t border-white/5" data-testid="result-table-row">
                  <td className="py-1 pr-2">{row.rank ?? "–"}</td>
                  <td className="py-1 pr-2 font-bold break-words">{row.team}</td>
                  <td className="py-1 pr-2">{row.played ?? "–"}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{[row.won, row.drawn, row.lost].map((value) => value ?? "–").join("-")}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{row.score_for !== null && row.score_for !== undefined ? `${row.score_for}:${row.score_against}` : "–"}</td>
                  <td className="py-1 text-right font-bold">{row.points !== null && row.points !== undefined ? formatPoints(row.points) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <PasteBox onApply={onPaste} label="Tabelle einfügen" testId="result-table-paste" placeholder={"1. Team A 10 7 1 2 22\n2. Team B 10 6 0 4 18"}
          hint="Von der Seite des Veranstalters kopieren – mit Tab, „|“ oder „;“ getrennt, gern mit Kopfzeile (Pl, Team, Sp, S, U, N, Maps, Pkt)." />
      )}
    </section>
  );
}

function PendingDraft({ draft, participants, busy, onApprove, onDiscard }) {
  const names = Object.fromEntries((participants || []).map((person) => [person.id, person.name]));
  const rows = draft.rows || [];
  return (
    <div className="border border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm p-3 space-y-2" data-testid="result-pending">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Entwurf daneben wartet auf Freigabe</div>
      <p className="text-xs text-white/60">Das veröffentlichte Ergebnis bleibt sichtbar, bis du den Entwurf freigibst.</p>
      {rows.length > 0 && (
        <ol className="text-sm text-white/80 space-y-0.5" data-testid="result-pending-rows">
          {rows.slice(0, 30).map((row, index) => (
            <li key={`${row.participant_id}-${index}`} className="tabular-nums">
              {row.place ?? "–"}. {names[row.participant_id] || "Neuer Name"}{row.points !== null && row.points !== undefined && row.points_source !== "scheme" ? ` · ${formatPoints(row.points)} Pkt` : ""}{row.marks?.length ? ` · ${row.marks.join(", ").toUpperCase()}` : ""}
            </li>
          ))}
        </ol>
      )}
      {(draft.matches || []).map((match, index) => (
        <div key={index} className="text-sm text-white/80">{match.home} {match.home_score}:{match.away_score} {match.away}</div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onApprove} data-testid="result-pending-approve" className="tls-btn tls-btn--primary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">Freigeben</button>
        <button type="button" disabled={busy} onClick={onDiscard} data-testid="result-pending-discard" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">Verwerfen</button>
      </div>
    </div>
  );
}

function mineSummary(form) {
  const names = form.rows.map((row) => String(row.name || "").trim()).filter(Boolean);
  const parts = [];
  if (names.length) parts.push(`${names.length} ${names.length === 1 ? "Zeile" : "Zeilen"}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? " …" : ""}`);
  const matches = form.matches.filter((match) => String(match.home || "").trim() || String(match.away || "").trim());
  if (matches.length) parts.push(matches.map((match) => `${match.home} ${match.home_score || 0}:${match.away_score || 0} ${match.away}`).join(" · "));
  if (form.table.length) parts.push(`Tabelle mit ${form.table.length} Teams`);
  return parts.join(" · ") || "Keine Einträge.";
}

export function ResultEntrySheet({ series, round, onClose, onSaved }) {
  const base = `/reference-series/admin/series/${series.id}/rounds/${round.id}/results`;
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  // Eigene Eingaben, die beim Neuladen nach einem 409 nicht still im neuen Stand landen dürfen.
  const [mine, setMine] = useState(null);
  const [pasting, setPasting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get(base);
      setData(result);
      setStale(false);
      const sheet = result.sheet;
      const source = result.target === "pending_draft" && sheet?.pending_draft ? sheet.pending_draft : sheet;
      setForm(sheetToForm(source, result.participants, { kind: result.series?.kind, teamName: result.series?.team_name, opponent: result.round?.opponent }));
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Ergebnis nicht geladen.");
      onClose();
    }
  }, [base, onClose]);

  useEffect(() => { load(); }, [load]);

  const rules = useMemo(() => data?.series?.rules || {}, [data]);
  const kind = data?.series?.kind;
  const teamLeague = kind === "team_league";
  const organizerMode = rules.points_mode === "organizer";
  // Qualifying (#1930): Zeit statt Punkte, ohne schnellste Runde und Fahrer des Tages.
  const qualifying = kind === "racing" && roundKind(data?.round || round) === "qualifying";
  const access = data?.access || {};
  const board = access.role === "board";
  const participants = useMemo(() => data?.participants || [], [data]);
  // Vorschläge fürs Team: zuerst die eigenen Teams der Saison (#1926), dann die Standard-Teams der Teilnehmer.
  const teams = useMemo(() => [...new Set([...(data?.series?.own_teams || []), ...participants.map((person) => person.default_team)].filter(Boolean))], [data, participants]);
  // Ergebnis-Bild (#1756): die gelesenen Zeilen ersetzen die Liste wie „Liste einfügen“, danach prüft die Vorschau.
  const [checkImage, setCheckImage] = useState(false);
  const image = useResultImage({
    base,
    onRead: (result) => {
      // Schnellste Runde und Fahrer des Tages gehen in die Felder des Rennens (#1927); was das Bild nicht ersetzt,
      // bleibt – mit seiner gelben Markierung.
      setForm((current) => ({ ...current, ...imageFormFields(result, current.raceOcr), rows: imageToRows(result, participants) }));
      setPasting(false);
      setCheckImage(true);
    },
  });

  const built = useMemo(() => (form ? formToPayload(form) : null), [form]);
  const stamp = built ? formStamp(built.payload) : "";
  const fresh = Boolean(preview && preview.stamp === stamp);
  const problems = useMemo(() => problemsByRow(fresh ? preview : null, built?.rowKeys), [fresh, preview, built]);
  const infoByKey = useMemo(() => {
    if (!fresh || !built) return {};
    return Object.fromEntries((preview.rows || []).map((row) => [built.rowKeys[row.index], row]));
  }, [fresh, preview, built]);
  const auto = useMemo(() => (form ? autoPlaces(form.rows) : {}), [form]);

  const update = (changes) => setForm((current) => ({ ...current, ...changes }));
  const updateRow = (key, values) => setForm((current) => ({
    ...current,
    rows: current.rows.map((row) => {
      if (row.key !== key) return row;
      const next = { ...row, ...values };
      if ("name" in values && !("points_hint" in values) && next.points_hint && !next.name.endsWith(` ${next.points_hint.text}`)) next.points_hint = null;
      if ("name" in values && !("participant_id" in values && values.participant_id)) {
        // Bekannter Name: gleich mit Kennung und – wenn das Feld leer ist – dem Standard-Team.
        const known = matchParticipant(values.name, participants);
        if (known) {
          next.participant_id = known.id;
          if (!next.team && known.default_team) next.team = known.default_team;
        }
      }
      // Was jemand ändert, ist geprüft: die gelbe Markierung aus dem Bild fällt für diese Felder weg.
      return afterEdit(next, Object.keys(values));
    }),
  }));
  const confirmImageRow = (key) => setForm((current) => ({ ...current, rows: current.rows.map((row) => (row.key === key ? confirmRow(row) : row)) }));
  const imageOpen = form ? openImageItems(form) : 0;
  const hinted = form ? form.rows.filter((row) => row.points_hint).length : 0;
  const allHintsToPoints = () => setForm((current) => ({
    ...current,
    rows: current.rows.map((row) => (row.points_hint ? { ...row, ...hintToPoints(row, participants) } : row)),
  }));
  const removeRow = (key) => setForm((current) => ({ ...current, rows: current.rows.filter((row) => row.key !== key) }));
  const addRow = () => setForm((current) => ({ ...current, rows: [...current.rows, emptyRow()] }));
  const updateMatch = (key, values) => setForm((current) => ({ ...current, matches: current.matches.map((match) => (match.key === key ? { ...match, ...values } : match)) }));

  const runPreview = async (payload, currentStamp) => {
    const { data: result } = await api.post(`${base}/preview`, payload);
    setPreview({ ...result, stamp: currentStamp });
    return result;
  };

  useEffect(() => {
    if (!checkImage || !built) return;
    setCheckImage(false);
    runPreview(built.payload, stamp).catch((err) => toast.error(formatApiError(err.response?.data?.detail)));
    // runPreview ist je Darstellung neu, ändert aber nichts am Ablauf - entscheidend ist der Stand des Formulars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkImage, built, stamp]);

  const pasteRows = (text) => {
    const result = parseResultPaste(text);
    if (result.rows.length) {
      const rows = pastedToRows(result.rows, participants);
      const next = {
        ...form, rows,
        // Schnellste Runde und Fahrer des Tages aus der Liste (#1927) - sonst bleibt, was schon eingetragen ist. Gelb
        // aus einem Bild verlieren nur die Felder, die die Liste ersetzt; was stehen bleibt, ist weiter ungeprüft.
        ...(result.fastest_lap ? { fastestLap: { name: result.fastest_lap.name || "", time: result.fastest_lap.time || "" } } : {}),
        ...(result.driver_of_the_day ? { driverOfTheDay: result.driver_of_the_day.name || "" } : {}),
        raceOcr: replaceRaceMarks(form.raceOcr, [
          ...(result.fastest_lap ? RACE_FIELD_GROUPS.fastestLap : []),
          ...(result.driver_of_the_day ? RACE_FIELD_GROUPS.driverOfTheDay : []),
        ]),
      };
      setForm(next);
      setPasting(result.errors.length > 0);
      // Danach gleich prüfen lassen – so stehen Fehler und Punkte sofort an den Zeilen.
      const pasted = formToPayload(next);
      runPreview(pasted.payload, formStamp(pasted.payload)).catch((err) => toast.error(formatApiError(err.response?.data?.detail)));
    }
    return result;
  };
  const pasteTable = (text) => {
    const result = parseTablePaste(text);
    if (result.rows.length) update({ table: result.rows.map(({ line, ...row }) => row) });
    return result;
  };

  const reloadCurrent = () => {
    setMine(form);
    setPreview(null);
    load();
  };
  const applyMine = () => {
    // Bewusst übernehmen: die eigenen Eingaben auf den neuen Stand (die Version kommt vom Neuladen), danach neu prüfen.
    setForm(mine);
    setMine(null);
    setPreview(null);
  };

  const stalePrompt = () => {
    setStale(true);
    toast.error("Das Ergebnis wurde inzwischen geändert – bitte neu laden.");
  };

  // Gelbe Zeilen aus dem Bild: erst prüfen, dann übernehmen – „Gelbe Zeilen prüfen“ springt zur ersten.
  const showImageOpen = () => {
    toast.error(`${imageOpen === 1 ? "Eine Zeile aus dem Bild ist" : `${imageOpen} Zeilen aus dem Bild sind`} noch gelb – bitte prüfen oder mit „Passt so“ bestätigen.`);
    const first = document.querySelector('[data-testid="result-sheet"] [data-ocr-uncertain], [data-testid="result-sheet"] [data-testid="result-row-ocr-confirm"]');
    first?.scrollIntoView?.({ block: "center" });
    first?.focus?.();
  };

  const save = async (status) => {
    if (imageOpen) {
      showImageOpen();
      return;
    }
    setSaving(true);
    try {
      const { data: result } = await api.put(base, { ...built.payload, status, expected_version: data.version });
      const created = result.created_participants || [];
      toast.success(result.target === "pending_draft" ? "Als Entwurf zur Freigabe gespeichert." : status === "published" ? "Ergebnis veröffentlicht." : "Als Entwurf gespeichert.");
      onSaved({ openUnknown: board && created.some((person) => person.link_status === "open") });
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (err.response?.status === 409) stalePrompt();
      else if (detail?.errors) setPreview({ ...(preview || {}), errors: detail.errors, warnings: detail.warnings || [], can_save: false, stamp });
      else toast.error(formatApiError(detail));
    } finally {
      setSaving(false);
    }
  };

  const decide = async (action) => {
    setSaving(true);
    try {
      const { data: result } = await api.post(`${base}/${action}`, { expected_version: data.version });
      // Offene Namen, die nur der Entwurf angelegt hatte, nimmt der Server wieder mit - kurz sagen, wie viele.
      const removed = (result?.removed_participants || []).length;
      const done = action === "approve" ? "Entwurf freigegeben." : "Entwurf verworfen.";
      toast.success(removed ? `${done} ${removed === 1 ? "1 offener Name" : `${removed} offene Namen`} entfernt.` : done);
      onSaved({});
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (err.response?.status === 409) stalePrompt();
      else toast.error(detail?.message || formatApiError(detail));
    } finally {
      setSaving(false);
    }
  };

  const target = preview?.target || data?.target;
  const toPendingDraft = target === "pending_draft";
  const canPublish = Boolean(access.can_publish) && !toPendingDraft;
  const invalid = useMemo(() => (form ? fieldErrors(form) : {}), [form]);
  const invalidCount = countFieldErrors(invalid);
  const ready = fresh && preview.can_save && !stale && invalidCount === 0;

  const submit = async (event) => {
    event.preventDefault();
    if (stale) return;
    if (invalidCount) {
      toast.error("Bitte zuerst die rot markierten Eingaben korrigieren.");
      return;
    }
    if (ready) {
      save(canPublish ? "published" : "draft");
      return;
    }
    // Die Vorschau prüft auch mit gelben Zeilen - übernommen wird erst danach (siehe save).
    setSaving(true);
    try {
      await runPreview(built.payload, stamp);
    } catch (err) {
      if (err.response?.status === 409) stalePrompt();
      else toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const submitLabel = !ready ? (fresh ? "Erneut prüfen" : "Vorschau") : imageOpen ? "Gelbe Zeilen prüfen" : toPendingDraft ? "Entwurf zur Freigabe" : canPublish ? "Veröffentlichen" : "Als Entwurf speichern";
  const sheetStatus = data?.sheet?.status;
  const pending = board ? data?.sheet?.pending_draft : null;
  const filledRows = built?.payload.rows.length || 0;

  return (
    <AdminSheet title={`Ergebnis ${round ? sessionLabel(round) : ""}`} eyebrow={series.lineage?.title} size="xl" onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel={submitLabel} savingLabel={ready ? "Übernehme …" : "Prüfe …"} submitTestId="result-submit" testId="result-sheet" noValidate
      footer={ready && canPublish && !imageOpen ? (
        <button type="button" disabled={saving} onClick={() => save("draft")} data-testid="result-save-draft" className="tls-btn tls-btn--secondary px-4 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          Nur als Entwurf
        </button>
      ) : null}>
      {!data || !form ? <div className="text-sm text-white/40">Lädt …</div> : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/60" data-testid="result-round">
            <span className="tabular-nums">{roundWhen(data.round)}</span>
            {(data.round.venue || data.round.country_code) && <span>· <VenueWithFlag round={{ venue: data.round.venue, country_code: data.round.country_code }} /></span>}
            {sheetStatus && <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">{sheetStatus === "published" ? "veröffentlicht" : "Entwurf"} · Stand {data.version}</span>}
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/45" data-testid="result-mode">{qualifying ? qualifyingMode(data.round) : organizerMode ? "Punkte laut Veranstalter" : "Punkte nach Schlüssel"}</span>
          </div>

          {stale && (
            <div className="border border-amber-400/40 bg-amber-400/10 rounded-sm p-3 text-sm text-amber-100 flex flex-wrap items-center gap-3" role="alert" data-testid="result-stale">
              <span className="flex-1 min-w-[12rem]">Inzwischen hat jemand anderes das Ergebnis geändert. Neu laden zeigt den aktuellen Stand; deine Eingaben bleiben daneben aufgehoben.</span>
              <button type="button" onClick={reloadCurrent} data-testid="result-reload" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Neu laden
              </button>
            </div>
          )}

          {mine && (
            <div className="border border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm p-3 text-sm text-white/80 space-y-2" data-testid="result-mine">
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Deine nicht gespeicherten Änderungen</div>
              <p className="text-xs text-white/60">Das Blatt zeigt jetzt den aktuellen Stand. Deine Eingaben sind nicht gespeichert – übernimm sie bewusst oder verwirf sie.</p>
              <div className="text-xs text-white/70" data-testid="result-mine-summary">{mineSummary(mine)}</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={applyMine} data-testid="result-mine-apply" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">Meine Eingaben erneut anwenden</button>
                <button type="button" onClick={() => setMine(null)} data-testid="result-mine-discard" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">Verwerfen</button>
              </div>
            </div>
          )}

          {toPendingDraft && (
            <p className="border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm px-3 py-2 text-sm text-white/75" data-testid="result-pending-note">
              Das Ergebnis ist schon veröffentlicht. Deine Änderung wird ein Entwurf daneben – sichtbar wird sie, wenn der Vorstand sie freigibt.
            </p>
          )}

          {pending && <PendingDraft draft={pending} participants={participants} busy={saving || stale} onApprove={() => decide("approve")} onDiscard={() => decide("discard")} />}
          {board && !pending && sheetStatus === "draft" && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-white/60" data-testid="result-draft-note">
              <span>Gespeichert als Entwurf – noch nicht öffentlich.</span>
              <button type="button" disabled={saving || stale} onClick={() => decide("approve")} data-testid="result-draft-approve" className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">Gespeicherten Entwurf veröffentlichen</button>
            </div>
          )}

          <datalist id="result-participants">
            {participants.map((person) => <option key={person.id} value={person.name}>{person.start_number ? `Nr. ${person.start_number}` : undefined}</option>)}
          </datalist>
          <datalist id="result-teams">{teams.map((team) => <option key={team} value={team} />)}</datalist>
          <datalist id="result-row-names">{[...new Set(form.rows.map((row) => String(row.name || "").trim()).filter(Boolean))].map((name) => <option key={name} value={name} />)}</datalist>

          {teamLeague && (
            <section className="space-y-3" data-testid="result-matches">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Spiel</h3>
              {form.matches.map((match, index) => (
                <MatchEditor key={match.key} match={match} index={index} participants={participants} errors={invalid}
                  onChange={(values) => updateMatch(match.key, values)} onRemove={() => update({ matches: form.matches.filter((item) => item.key !== match.key) })} />
              ))}
              <button type="button" onClick={() => update({ matches: [...form.matches, emptyMatch({ home: data.series?.team_name || "" })] })} data-testid="result-match-add" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" /> Spiel
              </button>
              <OfficialTable rows={form.table} onPaste={pasteTable} onClear={() => update({ table: [] })} />
            </section>
          )}

          {(!teamLeague || form.rows.length > 0) && (
            <section className="space-y-2" data-testid="result-rows-section">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Ergebnisliste{filledRows ? ` · ${filledRows}` : ""}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setPasting((value) => !value)} aria-expanded={pasting} data-testid="result-paste-toggle" className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5" /> Liste einfügen
                  </button>
                  <ResultImageButton image={image} />
                </div>
              </div>
              <ResultImageSummary image={image} rows={form.rows} raceOcr={form.raceOcr} />
              {hinted > 1 && (
                <div className="flex flex-wrap items-center gap-2 border border-amber-400/40 bg-amber-400/10 rounded-sm px-3 py-2 text-xs text-amber-100" data-testid="result-hints">
                  <span className="flex-1 min-w-[12rem]">{hinted} Zeilen enden auf eine Zahl – Teil des Namens oder Punkte?</span>
                  <button type="button" onClick={allHintsToPoints} data-testid="result-hints-points" className="tls-btn tls-btn--quiet px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider">Bei allen: letzte Zahl = Punkte</button>
                </div>
              )}
              {pasting && (
                <PasteBox onApply={pasteRows} label="Ergebnisliste einfügen" testId="result-paste" placeholder={"1. Name  25\n2. Name 18 Pkt\n3. Name DNF"}
                  hint="Je Zeile ein Teilnehmer: „1. Name  25“ (Punkte mit zwei Leerzeichen oder „Pkt“ abgesetzt), nur Namen in Reihenfolge oder eine Tabelle aus Excel oder einer Website (Tab, „|“, „;“) – gern mit Spalten Nr, Start, Zeit, Abstand und Beste Runde. Dazu „Schnellste Runde: Name 1:31.456“ und „Fahrer des Tages: Name“. Ersetzt die Liste unten." />
              )}
              <ol className="divide-y divide-white/5" data-testid="result-rows">
                {form.rows.map((row, index) => (
                  <ResultRow key={row.key} row={row} index={index} autoPlace={auto[row.key]} organizerMode={organizerMode} qualifying={qualifying} invalid={invalid[row.key]}
                    problems={problems.byRow[row.key]} info={infoByKey[row.key]}
                    onChange={(values) => updateRow(row.key, values)} onHint={() => updateRow(row.key, hintToPoints(row, participants))} onRemove={() => removeRow(row.key)}
                    onConfirmImage={() => confirmImageRow(row.key)} />
                ))}
              </ol>
              <button type="button" onClick={addRow} data-testid="result-row-add" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" /> Teilnehmer
              </button>
            </section>
          )}
          {kind === "racing" && !qualifying && <RaceExtras form={form} onChange={update} invalid={invalid.race} problems={problems.byField} />}

          {teamLeague && form.rows.length === 0 && (
            <button type="button" onClick={addRow} data-testid="result-row-add" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <Plus className="w-3.5 h-3.5" /> Einzelwertung (optional)
            </button>
          )}

          <TextAreaField label="Notiz" value={form.note} onChange={(value) => update({ note: value })} rows={2} hint="Optional, etwa „Wertung laut Veranstalter vorläufig“." testId="result-note" />

          {invalidCount > 0 && (
            <p className="border border-red-400/40 bg-red-400/10 rounded-sm px-3 py-2 text-sm text-red-100" role="alert" data-testid="result-invalid">
              {invalidCount === 1 ? "Eine Eingabe ist ungültig" : `${invalidCount} Eingaben sind ungültig`} – rot markiert. Geprüft und gespeichert wird erst, wenn alles stimmt.
            </p>
          )}
          {imageOpen > 0 && (
            <p className="border border-amber-400/40 bg-amber-400/10 rounded-sm px-3 py-2 text-sm text-amber-100" role="status" data-testid="result-image-open">
              {imageOpen === 1 ? "Eine Zeile aus dem Bild ist" : `${imageOpen} Zeilen aus dem Bild sind`} noch gelb – prüfen, korrigieren oder mit „Passt so“ bestätigen. Übernommen wird erst danach.
            </p>
          )}
          {fresh && <ResultPreview preview={preview} general={problems.general} board={board} />}
          {!fresh && preview && <p className="text-xs text-white/45" data-testid="result-preview-outdated">Geändert – „Vorschau“ prüft neu.</p>}
        </>
      )}
    </AdminSheet>
  );
}
