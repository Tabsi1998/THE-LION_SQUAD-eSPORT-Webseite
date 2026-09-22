import { CalendarPlus, ExternalLink } from "lucide-react";
import { downloadIcs, googleCalendarUrl } from "@/lib/calendarLinks";

// „In meinen Kalender“ (#216): .ics für Outlook, Apple und Co., dazu der Link zu Google Kalender.

export function AddToCalendar({ item, className = "" }) {
  if (!item?.start) return null;
  const google = googleCalendarUrl(item);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="add-to-calendar">
      <button type="button" onClick={() => downloadIcs(item)} className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/80 hover:text-white hover:border-[#29B6E8]/60 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="add-to-calendar-ics">
        <CalendarPlus className="w-3.5 h-3.5" /> In meinen Kalender (.ics)
      </button>
      {google && (
        <a href={google} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/80 hover:text-white hover:border-[#29B6E8]/60 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="add-to-calendar-google">
          <ExternalLink className="w-3.5 h-3.5" /> Google Kalender
        </a>
      )}
    </div>
  );
}
