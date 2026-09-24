import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Send, X as XIcon } from "lucide-react";
import { api, formatApiError } from "@/lib/api";

// Einladungen zum Mitgliedsantrag (#507): wen der Vorstand eingeladen hat, seit wann, ob der Antrag schon
// gestellt ist; offene Einladungen lassen sich zurückziehen. Einladen selbst geht bei Alle Benutzer.
const STATUS_LABEL = { open: "offen", applied: "Antrag gestellt", withdrawn: "zurückgezogen", expired: "abgelaufen" };

function formatDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("de-DE");
}

export function InvitationsBox() {
  const [rows, setRows] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(() => {
    api.get(`/admin/membership-invitations${showAll ? "" : "?status=open"}`).then(({ data }) => setRows(Array.isArray(data) ? data : [])).catch(() => setRows([]));
  }, [showAll]);
  useEffect(() => { load(); }, [load]);

  const withdraw = async (row) => {
    try {
      await api.post(`/admin/membership-invitations/${row.id}/withdraw`);
      toast.success("Einladung zurückgezogen.");
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Zurückziehen hat nicht geklappt.");
    }
  };

  return (
    <div className="mt-6 border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="invitations-box">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-heading font-bold uppercase text-sm inline-flex items-center gap-2"><Send className="w-4 h-4 text-[#FFD700]" /> Einladungen zum Antrag</div>
          <p className="text-xs text-white/45 mt-1">Ein Konto einladen: Mitglieder → Alle Benutzer → „Einladen“. Die Person sieht den Hinweis beim nächsten Besuch und füllt den Antrag direkt aus.</p>
        </div>
        <label className="text-xs inline-flex items-center gap-2 text-white/60">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} data-testid="invitations-show-all" className="accent-[#FFD700]" /> auch erledigte
        </label>
      </div>
      {rows === null ? <div className="text-xs text-white/40 mt-3">Lade …</div> : !rows.length ? (
        <div className="text-sm text-white/45 mt-3" data-testid="invitations-empty">Keine {showAll ? "" : "offenen "}Einladungen. <Link to="/admin/users" className="text-[#29B6E8] hover:text-white">Zu Alle Benutzer</Link></div>
      ) : (
        <ul className="divide-y divide-white/5 mt-3 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={`invitation-${row.id}`}>
              <span className="font-bold">{row.user?.display_name || row.user?.username || row.user_id}</span>
              <span className="text-xs text-white/45">@{row.user?.username}</span>
              <span className="text-xs text-white/45">eingeladen am {formatDay(row.created_at)}{row.invited_by_name ? ` von ${row.invited_by_name}` : ""}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${row.status === "open" ? "border-[#FFD700]/50 text-[#FFD700]" : row.status === "applied" ? "border-[#00FF88]/40 text-[#00FF88]" : "border-white/15 text-white/45"}`}>{STATUS_LABEL[row.status] || row.status}</span>
              {row.note ? <span className="basis-full text-xs text-white/50 italic">„{row.note}“</span> : null}
              {row.status === "open" ? (
                <button type="button" onClick={() => withdraw(row)} data-testid={`invitation-withdraw-${row.id}`} className="ml-auto inline-flex items-center gap-1 text-xs text-white/60 hover:text-[#FF3B30]"><XIcon className="w-3.5 h-3.5" /> zurückziehen</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default InvitationsBox;
