// Reiter „Termine“ der Season-Seite (#2267): Kalender mit Beginn, Wochen, Standardtermin und Sperrzeiten, die Antwortfrist auf
// Terminvorschläge, die Terminregeln (D.1, eigenes Speichern) und darunter die Check-in-Regeln (D.2, `SeasonCheckinRulesPanel`,
// #1652, eigenes Speichern, Sprungmarke `#checkin`), die Erinnerungen (E.5, `SeasonReminderRulesPanel`, #1647, `#erinnerungen`) und die Discord-Meldungen
// (#1642, `SeasonDiscordPanel`, `#discord`).
import { CalendarOff, Trash2 } from "lucide-react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { LEGS_OPTIONS, WEEKDAY_OPTIONS } from "@/lib/league";
import { formatWhen } from "@/lib/datetime";
import { dayNoon } from "@/lib/vienna";
import { SeasonCheckinRulesPanel } from "./SeasonCheckinRulesPanel";
import { SeasonReminderRulesPanel } from "./SeasonReminderRulesPanel";
import { SeasonDiscordPanel } from "./SeasonDiscordPanel";
import { SeasonScheduleRulesPanel } from "./SeasonScheduleRulesPanel";
import { SeasonTabForm } from "./SeasonTabForm";

const ICON_DANGER = "p-1.5 text-white/50 hover:text-live focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";

function dayText(day) {
  return day ? formatWhen(dayNoon(day), { time: false }) : "";
}

export function CalendarStrip({ calendar }) {
  if (!calendar?.weeks?.length) return null;
  return (
    <div className="space-y-2" data-testid="season-calendar">
      <p className="tls-type-body text-white/75">
        {calendar.weeks.length} Wochen, davon {calendar.blocked_weeks.length} gesperrt – <strong className="text-white">{calendar.active_weeks} Spielwochen</strong>.
        {" "}Eine Staffel fasst damit höchstens <strong className="text-white">{calendar.max_teams_per_staffel} Teams</strong>; mehr Teams brauchen eine zweite Staffel.
      </p>
      <ol className="flex flex-wrap gap-1.5" aria-label="Spielwochen">
        {calendar.weeks.map((week) => (
          <li key={week.number} title={`${dayText(week.start_day)} – ${dayText(week.end_day)}`}
            className={`rounded-sm border px-2 py-1 tls-type-small tabular-nums ${week.blocked ? "border-white/5 bg-transparent text-quiet line-through" : "border-white/10 bg-[#0A0A0A] text-white/75"}`}>
            <span className="font-bold">W{week.number}</span> {dayText(week.start_day)}
          </li>
        ))}
      </ol>
      <p className="tls-type-small text-white/45">Eine Woche ist gesperrt, wenn mehr als die Hälfte ihrer Tage in einer Sperrzeit liegt. Stand nach dem letzten Speichern.</p>
    </div>
  );
}

function BlockedPeriods({ periods, onChange }) {
  const update = (index, key, value) => onChange(periods.map((period, at) => (at === index ? { ...period, [key]: value } : period)));
  return (
    <div className="space-y-2" data-testid="season-blocked">
      <div className="tls-type-label text-white/60">Sperrzeiten</div>
      {periods.length ? periods.map((period, index) => (
        <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
          <TextField label="Von" type="date" value={period.start_date} onChange={(value) => update(index, "start_date", value)} testId={`blocked-start-${index}`} />
          <TextField label="Bis" type="date" value={period.end_date} onChange={(value) => update(index, "end_date", value)} testId={`blocked-end-${index}`} />
          <TextField label="Bezeichnung" maxLength={60} value={period.label} onChange={(value) => update(index, "label", value)} placeholder="z. B. Weihnachtspause"
            className="col-span-2 sm:col-span-1" testId={`blocked-label-${index}`} />
          <button type="button" onClick={() => onChange(periods.filter((_, at) => at !== index))} aria-label="Sperrzeit entfernen"
            className={`${ICON_DANGER} justify-self-start sm:mb-1.5`} data-testid={`blocked-remove-${index}`}>
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )) : <p className="tls-type-small text-white/50">Keine – jede Woche wird gespielt.</p>}
      <button type="button" onClick={() => onChange([...periods, { start_date: "", end_date: "", label: "" }])} data-testid="blocked-add"
        className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm tls-type-label inline-flex items-center gap-1.5">
        <CalendarOff className="w-3.5 h-3.5" aria-hidden="true" /> Sperrzeit hinzufügen
      </button>
    </div>
  );
}

export function SeasonDatesTab({ seasonId, data, form, set, canSeason, formProps }) {
  if (!canSeason) {
    return (
      <FormSection title="Kalender" testId="season-calendar-readonly">
        <CalendarStrip calendar={data.calendar} />
      </FormSection>
    );
  }
  return (
    <div className="space-y-6">
      <SeasonTabForm {...formProps}>
        <FormSection title="Kalender" id="kalender" className="scroll-mt-24" testId="season-calendar-settings"
          hint="Spielwochen laufen ab dem Beginn jeweils so viele Tage. Ohne Einigung gilt der Standardtermin der Woche.">
          <FormGrid cols={3}>
            <TextField label="Beginn" type="date" required value={form.start_day} onChange={(value) => set("start_day", value)} hint="00:00 Uhr Wiener Zeit" testId="season-form-start" />
            <TextField label="Wochen gesamt" type="number" min={1} max={52} value={form.weeks_total} onChange={(value) => set("weeks_total", value)} hint="mit Sperrwochen" testId="season-form-weeks" />
            <TextField label="Spielwoche (Tage)" type="number" min={1} max={31} value={form.matchday_days} onChange={(value) => set("matchday_days", value)} testId="season-form-days" />
            <SelectField label="Standardtag" value={form.default_match_weekday} onChange={(value) => set("default_match_weekday", value)} options={WEEKDAY_OPTIONS} testId="season-form-weekday" />
            <TextField label="Standardzeit" type="time" value={form.default_match_time} onChange={(value) => set("default_match_time", value)} testId="season-form-time" />
            <SelectField label="Runden" value={form.round_robin_legs} onChange={(value) => set("round_robin_legs", value)} options={LEGS_OPTIONS} testId="season-form-legs" />
          </FormGrid>
          <BlockedPeriods periods={form.blocked_periods} onChange={(value) => set("blocked_periods", value)} />
          <CalendarStrip calendar={data.calendar} />
        </FormSection>
        <FormSection title="Terminvorschläge" testId="season-response">
          {/* Antwortfrist (#2106, F3): früher je Staffel; leer bei älteren Seasons - dann behält jede Staffel ihre. */}
          <TextField label="Antwort auf Terminvorschlag (Stunden)" type="number" min={1} max={720} value={form.match_schedule_response_hours}
            onChange={(value) => set("match_schedule_response_hours", value)} placeholder="leer: je Staffel wie bisher"
            hint="So lange hat die Gegenseite Zeit; gilt für neue Vorschläge" testId="season-form-response" className="max-w-sm" />
        </FormSection>
      </SeasonTabForm>
      <div id="terminregeln" className="scroll-mt-24">
        <SeasonScheduleRulesPanel seasonId={seasonId} />
      </div>
      <div id="checkin" className="scroll-mt-24">
        <SeasonCheckinRulesPanel seasonId={seasonId} />
      </div>
      <div id="erinnerungen" className="scroll-mt-24">
        <SeasonReminderRulesPanel seasonId={seasonId} canEdit={canSeason !== false} />
      </div>
      {/* Liga im Discord (#1642): Spieltag-Zusammenfassung und Saisonende-Meldung - gleich neben den Erinnerungen. */}
      <div id="discord" className="scroll-mt-24">
        <SeasonDiscordPanel seasonId={seasonId} canEdit={canSeason !== false} />
      </div>
    </div>
  );
}
