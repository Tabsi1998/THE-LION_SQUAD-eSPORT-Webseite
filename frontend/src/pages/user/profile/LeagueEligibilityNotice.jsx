import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { eligibilityNotice } from "@/lib/leagueEligibility";

// Spielberechtigung im eigenen Profil (#2204): ob ich in meiner laufenden Season spielen darf und was ich tun muss. Nie ein Datum,
// der Server schickt keins.
export function LeagueEligibilityNotice() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get("/me/league-eligibility")
      .then(({ data }) => { if (alive) setItems(Array.isArray(data?.items) ? data.items : []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  const notices = items.map((item) => ({ item, notice: eligibilityNotice(item) })).filter((row) => row.notice);
  if (!notices.length) return null;
  return (
    <ul className="space-y-2" data-testid="profile-league-eligibility" aria-live="polite">
      {notices.map(({ item, notice }) => (
        <li key={`${item.season_id}-${item.squad_id}`} data-tone={notice.tone} data-testid={`profile-league-eligibility-${item.season_id}`}
          className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-sm ${notice.tone === "warn" ? "border-warn/40 bg-warn/5 text-white" : "border-[#29B6E8]/30 bg-[#29B6E8]/5 text-white/80"}`}>
          {notice.tone === "warn"
            ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />}
          <span className="min-w-0 [overflow-wrap:anywhere]">{notice.text}</span>
        </li>
      ))}
    </ul>
  );
}
