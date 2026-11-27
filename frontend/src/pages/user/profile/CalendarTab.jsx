import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { PersonalFeedCard } from "@/components/calendar/PersonalFeedCard";
import { MY_CALENDAR_PATH } from "@/lib/myCalendar";

// Mein Kalender-Abo (#1788): der feste Ort in den Einstellungen - derselbe Kasten wie unter „Mein Kalender“, dazu der Weg
// zur Ansicht der eigenen Termine (die gibt es auch ohne Abo).

export function CalendarTab() {
  return (
    <div className="space-y-5" data-testid="settings-calendar">
      <PersonalFeedCard testId="settings-calendar-personal" />
      <section className="border border-white/10 rounded-sm bg-[#0A0A0A] p-5">
        <h2 className="tls-type-section">Deine Termine ansehen</h2>
        <p className="mt-2 tls-type-body text-white/60">Auch ohne Abo: Alles, wofür du angemeldet bist, mit deinem Stand – als Liste oder Monat.</p>
        <Link to={MY_CALENDAR_PATH} data-testid="settings-calendar-open" className="mt-3 inline-flex items-center gap-2 text-[#29B6E8] tls-type-label hover:underline">
          <CalendarDays className="w-3.5 h-3.5" /> Mein Kalender öffnen
        </Link>
      </section>
    </div>
  );
}
