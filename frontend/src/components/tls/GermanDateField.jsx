import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const pad = (n) => String(n).padStart(2, "0");

function parseIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  return { year: +m[1], month: +m[2] - 1, day: +m[3] };
}

export function formatGermanDate(value) {
  const p = parseIso(value);
  return p ? `${p.day}. ${MONTHS[p.month]} ${p.year}` : "";
}

export function GermanDateField({
  id,
  label,
  value,
  onChange,
  description,
  error,
  required = false,
  minYear = 1930,
  maxYear = null,
  allowFuture = false,
  testId,
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);
  const [view, setView] = useState(() => selected ? { year: selected.year, month: selected.month } : { year: new Date().getFullYear(), month: new Date().getMonth() });

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const effMaxYear = maxYear ?? (allowFuture ? today.getFullYear() + 10 : today.getFullYear());
  const years = [];
  for (let y = effMaxYear; y >= minYear; y--) years.push(y);

  const firstWeekday = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells = [...Array.from({ length: firstWeekday }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const monthShift = (delta) => {
    setView((v) => {
      let month = v.month + delta;
      let year = v.year;
      if (month < 0) { month = 11; year -= 1; }
      if (month > 11) { month = 0; year += 1; }
      if (year < minYear || year > effMaxYear) return v;
      return { year, month };
    });
  };

  const handleOpen = (next) => {
    setOpen(next);
    if (next && selected) setView({ year: selected.year, month: selected.month });
  };

  const pick = (day) => {
    onChange(`${view.year}-${pad(view.month + 1)}-${pad(day)}`);
    setOpen(false);
  };

  const selectCls = "bg-[#0A0A0A] border border-white/10 rounded-sm px-2 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-[#29B6E8] cursor-pointer";
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="block">
      {label && (
        <label htmlFor={id} className="block text-[11px] font-bold uppercase tracking-widest text-white/65 mb-1.5">
          <span className="flex items-center justify-between gap-3">
            <span>{label}</span>
            {required && <span className="text-[9px] text-[#FFD700]">Pflichtfeld</span>}
          </span>
        </label>
      )}
      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            data-testid={testId}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={`w-full bg-[#0A0A0A] border px-3 py-2.5 rounded-sm text-left flex items-center justify-between gap-2 transition focus:outline-none ${
              error ? "border-[#FF3B30] focus:border-[#FF3B30]" : "border-white/10 focus:border-[#29B6E8] hover:border-white/25"
            }`}
          >
            <span className={value ? "text-white" : "text-white/35"}>
              {value ? formatGermanDate(value) : "Datum wählen"}
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              {value && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Datum entfernen"
                  data-testid={testId ? `${testId}-clear` : undefined}
                  onClick={(e) => { e.stopPropagation(); onChange(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(""); } }}
                  className="text-white/35 hover:text-[#FF3B30] transition"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              )}
              <CalendarDays className="w-4 h-4 text-white/45" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[19.5rem] p-0 z-[130] border border-white/12 bg-[#101012] rounded-sm shadow-2xl shadow-black/70 text-white">
          <div className="flex items-center gap-2 p-3 border-b border-white/10">
            <button
              type="button"
              onClick={() => monthShift(-1)}
              aria-label="Vorheriger Monat"
              className="w-8 h-8 inline-flex items-center justify-center border border-white/10 rounded-sm text-white/55 hover:text-white hover:border-[#29B6E8]/50 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 flex items-center justify-center gap-2">
              <select
                value={view.month}
                onChange={(e) => setView((v) => ({ ...v, month: +e.target.value }))}
                aria-label="Monat"
                data-testid={testId ? `${testId}-month` : undefined}
                className={selectCls}
              >
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select
                value={view.year}
                onChange={(e) => setView((v) => ({ ...v, year: +e.target.value }))}
                aria-label="Jahr"
                data-testid={testId ? `${testId}-year` : undefined}
                className={selectCls}
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={() => monthShift(1)}
              aria-label="Nächster Monat"
              className="w-8 h-8 inline-flex items-center justify-center border border-white/10 rounded-sm text-white/55 hover:text-white hover:border-[#29B6E8]/50 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider text-white/40 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, i) => {
                if (!day) return <div key={`x${i}`} />;
                const iso = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
                const isSelected = value === iso;
                const isToday = iso === todayIso;
                const isFuture = !allowFuture && iso > todayIso;
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={isFuture}
                    onClick={() => pick(day)}
                    data-testid={testId ? `${testId}-day-${day}` : undefined}
                    className={`h-9 rounded-sm text-sm tabular-nums transition ${
                      isSelected
                        ? "bg-[#29B6E8] text-black font-black"
                        : isFuture
                          ? "text-white/15 cursor-not-allowed"
                          : `text-white/80 hover:bg-[#29B6E8]/15 hover:text-white ${isToday ? "border border-[#29B6E8]/50 text-[#29B6E8]" : ""}`
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 pt-2 border-t border-white/8 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-white/35">
                {value ? formatGermanDate(value) : "Kein Datum gewählt"}
              </span>
              {value && (
                <button
                  type="button"
                  onClick={() => { onChange(""); setOpen(false); }}
                  className="text-[10px] font-bold uppercase tracking-widest text-white/45 hover:text-[#FF3B30] transition"
                >
                  Entfernen
                </button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {description && <div id={`${id}-description`} className="mt-1 text-[10px] text-white/45">{description}</div>}
      {error && <div id={`${id}-error`} role="alert" className="mt-1 text-xs text-[#FF8A80]">{error}</div>}
    </div>
  );
}
