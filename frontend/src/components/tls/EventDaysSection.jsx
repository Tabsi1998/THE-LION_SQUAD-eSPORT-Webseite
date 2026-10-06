import { ArrowDown, ArrowUp, CalendarDays, Plus, Trash2 } from "lucide-react";

// Mehrtägige Events (#884): ein LAN-Wochenende hat drei Tage mit eigenen Zeiten. Mit dem Schalter
// „Mehrere Tage mit eigenen Zeiten“ ersetzen die Tage die Felder Start, Ende und Einlass - der Server
// leitet Beginn und Ende aus dem ersten und letzten Tag ab. Zeiten sind Wiener Uhrzeiten („18:00“);
// eine Endzeit vor dem Beginn zählt zum nächsten Morgen (Sa 20:00 – 02:00).

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function emptyDay(date = "", start = "", end = "") {
  return { date, start, end, door: "", title: "", location_key: "" };
}

export function daysToForm(days) {
  return (days || []).map((day) => ({
    date: day.date || "",
    start: day.start || "",
    end: day.end || "",
    door: day.door || "",
    title: day.title || "",
    location_key: day.location_key || "",
  }));
}

export function formToDays(form) {
  return (form || []).map((day) => ({
    date: day.date,
    start: day.start,
    end: day.end,
    door: day.door || null,
    title: day.title?.trim() || null,
    location_key: day.location_key || null,
  }));
}

export function daysFormError(form) {
  const days = form || [];
  if (!days.length) return "";
  if (days.length < 2) return "Mehrere Tage brauchen mindestens zwei Tage – für einen Tag reichen Start und Ende.";
  const seen = new Set();
  for (const [index, day] of days.entries()) {
    const n = index + 1;
    if (!day.date) return `Tag ${n}: Das Datum fehlt.`;
    if (!day.start) return `Tag ${n}: Der Beginn fehlt.`;
    if (!day.end) return `Tag ${n}: Das Ende fehlt.`;
    if (day.start === day.end) return `Tag ${n}: Beginn und Ende sind gleich.`;
    if (day.door && day.door > day.start) return `Tag ${n}: Der Einlass liegt nach dem Beginn.`;
    if (seen.has(day.date)) return `Tag ${n}: Jeder Tag kommt nur einmal vor.`;
    seen.add(day.date);
  }
  return "";
}

export function dayLabel(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${WEEKDAYS[parsed.getDay()]} ${String(parsed.getDate()).padStart(2, "0")}.${String(parsed.getMonth() + 1).padStart(2, "0")}.`;
}

export function shiftDate(date, days) {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + days);
  return [parsed.getFullYear(), String(parsed.getMonth() + 1).padStart(2, "0"), String(parsed.getDate()).padStart(2, "0")].join("-");
}

// Beim Einschalten: zwei Tage aus Start und Ende des Formulars (Datum und Uhrzeit), sonst leer.
export function suggestedDays(startLocal, endLocal) {
  const [startDate = "", startTime = ""] = (startLocal || "").split("T");
  const [endDate = "", endTime = ""] = (endLocal || "").split("T");
  const start = startTime.slice(0, 5);
  const end = endDate && endDate !== startDate ? "" : endTime.slice(0, 5);
  return [emptyDay(startDate, start, end), emptyDay(shiftDate(startDate, 1), start, end)];
}

export function EventDaysSection({ value, onChange, locations, startDate, endDate, accent = "#9F7AEA" }) {
  const days = value || [];
  const enabled = days.length > 0;
  const places = (locations || []).map((place, index) => ({ key: place.key || `ort-${index + 1}`, name: place.name || place.city || `Standort ${index + 1}` }));
  const setDay = (index, patch) => onChange(days.map((day, i) => (i === index ? { ...day, ...patch } : day)));
  const move = (index, delta) => {
    const next = [...days];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const add = () => {
    const last = days[days.length - 1];
    onChange([...days, emptyDay(shiftDate(last?.date, 1), last?.start || "", last?.end || "")]);
  };
  const error = daysFormError(days);
  const input = "w-full bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm min-w-0";
  const label = "uppercase tracking-widest text-white/45 font-bold mb-1 text-[10px]";

  return (
    <div className="space-y-3" data-testid="event-days">
      <label className="flex items-start gap-2 text-sm text-white/75">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(ev) => onChange(ev.target.checked ? suggestedDays(startDate, endDate) : [])}
          data-testid="event-days-toggle"
          style={{ accentColor: accent }}
          className="mt-1 shrink-0"
        />
        <span>
          Mehrere Tage mit eigenen Zeiten
          <span className="block text-xs text-white/45">Für ein Wochenende oder eine Woche: jeder Tag mit Beginn, Ende und Einlass. Start und Ende des Events ergeben sich aus dem ersten und letzten Tag.</span>
        </span>
      </label>
      {enabled && (
        <>
          {days.map((day, index) => (
            <div key={index} className="border border-white/10 rounded-sm p-3 space-y-2" data-testid={`event-day-${index}`}>
              <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-widest text-white/45 font-bold">
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" style={{ color: accent }} /> Tag {index + 1}{dayLabel(day.date) ? ` · ${dayLabel(day.date)}` : ""}</span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="p-1.5 border border-white/10 rounded-sm disabled:opacity-30" aria-label={`Tag ${index + 1} nach oben`}><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === days.length - 1} className="p-1.5 border border-white/10 rounded-sm disabled:opacity-30" aria-label={`Tag ${index + 1} nach unten`}><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => onChange(days.filter((_, i) => i !== index))} className="p-1.5 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm" aria-label={`Tag ${index + 1} entfernen`} data-testid={`event-day-remove-${index}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs col-span-3"><div className={label}>Datum</div><input type="date" value={day.date} onChange={(ev) => setDay(index, { date: ev.target.value })} className={input} data-testid={`event-day-date-${index}`} /></label>
                <label className="text-xs"><div className={label}>Beginn</div><input type="time" value={day.start} onChange={(ev) => setDay(index, { start: ev.target.value })} className={input} data-testid={`event-day-start-${index}`} /></label>
                <label className="text-xs"><div className={label}>Ende</div><input type="time" value={day.end} onChange={(ev) => setDay(index, { end: ev.target.value })} className={input} data-testid={`event-day-end-${index}`} /></label>
                <label className="text-xs"><div className={label}>Einlass</div><input type="time" value={day.door} onChange={(ev) => setDay(index, { door: ev.target.value })} className={input} data-testid={`event-day-door-${index}`} /></label>
                <label className={`text-xs ${places.length ? "col-span-2" : "col-span-3"}`}><div className={label}>Titel (optional)</div><input value={day.title} onChange={(ev) => setDay(index, { title: ev.target.value })} className={input} placeholder="Warm-up, Finaltag" data-testid={`event-day-title-${index}`} /></label>
                {places.length > 0 && (
                  <label className="text-xs"><div className={label}>Standort</div>
                    <select value={day.location_key} onChange={(ev) => setDay(index, { location_key: ev.target.value })} className={input} data-testid={`event-day-location-${index}`}>
                      <option value="">Hauptort</option>
                      {places.map((place) => <option key={place.key} value={place.key}>{place.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={add} className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/70 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-days-add">
              <Plus className="w-3.5 h-3.5" /> Tag
            </button>
            {error && <div className="text-xs text-[#FF3B30]" data-testid="event-days-error">{error}</div>}
          </div>
          <p className="text-xs text-white/45">Endet ein Tag nach Mitternacht, trage die Endzeit einfach ein (z. B. 02:00) – sie zählt zum nächsten Morgen. Kalender und Discord bekommen je Tag einen Termin.</p>
        </>
      )}
    </div>
  );
}
