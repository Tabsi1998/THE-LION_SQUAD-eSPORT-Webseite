import { useEffect, useState } from "react";
import { AlertTriangle, IdCard } from "lucide-react";
import { api } from "@/lib/api";
import { leagueIdNotice } from "@/lib/leagueIds";

// Liga-Hinweis bei den Spiel-IDs (#2108): Je laufender Season gilt die ID, die beim Zuteilen bzw. ersten Aufstellen
// festgehalten wurde. Ändert sich die ID hier im Profil, sagt der Hinweis sofort (beim Tippen), dass in der Liga weiter
// die gemeldete gilt, bis die Liga-Leitung die neue freigibt.

export function LeagueIdNotice({ gameIds }) {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get("/me/league-ids")
      .then(({ data }) => { if (alive) setEntries(Array.isArray(data?.items) ? data.items : []); })
      .catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, []);
  const notices = entries.map((entry) => ({ entry, notice: leagueIdNotice(entry, gameIds || {}) })).filter((row) => row.notice);
  if (!notices.length) return null;
  return (
    <ul className="space-y-2" data-testid="profile-league-ids" aria-live="polite">
      {notices.map(({ entry, notice }) => (
        <li key={entry.season_id} data-tone={notice.tone} data-testid={`profile-league-id-${entry.season_id}`}
          className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-sm ${notice.tone === "warn" ? "border-warn/40 bg-warn/5 text-white" : "border-[#29B6E8]/30 bg-[#29B6E8]/5 text-white/80"}`}>
          {notice.tone === "warn"
            ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            : <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />}
          <span className="min-w-0 [overflow-wrap:anywhere]">{notice.text}</span>
        </li>
      ))}
    </ul>
  );
}
