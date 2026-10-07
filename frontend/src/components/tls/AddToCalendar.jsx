import { CalendarPlus, Download, ExternalLink } from "lucide-react";
import { downloadIcs, googleCalendarUrl, outlookCalendarUrl, serverIcsPath } from "@/lib/calendarLinks";

// „Zum Kalender hinzufügen“ (#216, #580): drei Wege - Google Kalender, Outlook und die ICS-Datei für
// Apple, Thunderbird und Co. Die ICS kommt vom Server (mit Erinnerung eine Stunde vorher und, bei
// Turnieren, dem Check-in im Text); ohne Kennung des Termins wird sie im Browser gebaut.

const LINK = "inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/80 hover:text-white hover:border-[#29B6E8]/60 text-xs font-bold uppercase tracking-wider rounded-sm";

export function AddToCalendar({ item, days = null, className = "" }) {
  if (!item?.start) return null;
  const google = googleCalendarUrl(item);
  const outlook = outlookCalendarUrl(item);
  const ics = serverIcsPath(item);
  if (days?.length > 1) {
    // Mehrtägig (#884): Google und Outlook nehmen je Tag einen Termin, die ICS-Datei vom Server hat alle Tage.
    return (
      <div className={`space-y-2 ${className}`} data-testid="add-to-calendar">
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/40 inline-flex items-center gap-2"><CalendarPlus className="w-3.5 h-3.5" /> Zum Kalender hinzufügen</div>
        <ul className="space-y-1.5 text-xs text-white/70" data-testid="add-to-calendar-days">
          {days.map((day) => {
            const dayItem = { ...item, title: `${item.title} – Tag ${day.index}/${days.length}${day.title ? ` · ${day.title}` : ""}`, start: day.start_at, end: day.end_at };
            return (
              <li key={day.index} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-[11rem] text-white/80">{day.label} · {day.time_label}</span>
                <a href={googleCalendarUrl(dayItem)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white underline-offset-2 hover:underline" data-testid={`add-to-calendar-google-${day.index}`}><ExternalLink className="w-3 h-3" /> Google</a>
                <a href={outlookCalendarUrl(dayItem)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white underline-offset-2 hover:underline" data-testid={`add-to-calendar-outlook-${day.index}`}><ExternalLink className="w-3 h-3" /> Outlook</a>
              </li>
            );
          })}
        </ul>
        {ics && (
          <a href={ics} download className={LINK} data-testid="add-to-calendar-ics">
            <Download className="w-3.5 h-3.5" /> ICS-Datei mit allen {days.length} Tagen (Apple, Thunderbird …)
          </a>
        )}
      </div>
    );
  }
  return (
    <div className={`space-y-2 ${className}`} data-testid="add-to-calendar">
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/40 inline-flex items-center gap-2"><CalendarPlus className="w-3.5 h-3.5" /> Zum Kalender hinzufügen</div>
      <div className="flex flex-wrap items-center gap-2">
        {google && (
          <a href={google} target="_blank" rel="noreferrer" className={LINK} data-testid="add-to-calendar-google">
            <ExternalLink className="w-3.5 h-3.5" /> Google Kalender
          </a>
        )}
        {outlook && (
          <a href={outlook} target="_blank" rel="noreferrer" className={LINK} data-testid="add-to-calendar-outlook">
            <ExternalLink className="w-3.5 h-3.5" /> Outlook
          </a>
        )}
        {ics ? (
          <a href={ics} download className={LINK} data-testid="add-to-calendar-ics">
            <Download className="w-3.5 h-3.5" /> ICS-Datei (Apple, Thunderbird …)
          </a>
        ) : (
          <button type="button" onClick={() => downloadIcs(item)} className={LINK} data-testid="add-to-calendar-ics">
            <Download className="w-3.5 h-3.5" /> ICS-Datei (Apple, Thunderbird …)
          </button>
        )}
      </div>
    </div>
  );
}
