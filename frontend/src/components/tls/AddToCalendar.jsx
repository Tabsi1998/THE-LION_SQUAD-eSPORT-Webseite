import { CalendarPlus, Download, ExternalLink } from "lucide-react";
import { downloadIcs, googleCalendarUrl, outlookCalendarUrl, serverIcsPath } from "@/lib/calendarLinks";

// „Zum Kalender hinzufügen“ (#216, #580): drei Wege - Google Kalender, Outlook und die ICS-Datei für
// Apple, Thunderbird und Co. Die ICS kommt vom Server (mit Erinnerung eine Stunde vorher und, bei
// Turnieren, dem Check-in im Text); ohne Kennung des Termins wird sie im Browser gebaut.

const LINK = "inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/80 hover:text-white hover:border-[#29B6E8]/60 text-xs font-bold uppercase tracking-wider rounded-sm";

export function AddToCalendar({ item, className = "" }) {
  if (!item?.start) return null;
  const google = googleCalendarUrl(item);
  const outlook = outlookCalendarUrl(item);
  const ics = serverIcsPath(item);
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
