import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Check, MessageSquare, UserPlus, X } from "lucide-react";

export function FriendsPanel() {
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get("/friends");
      setData(res || { friends: [], incoming: [], outgoing: [] });
    } catch {
      setData({ friends: [], incoming: [], outgoing: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["friends", "admin/notifications"]);

  const act = async (row, action) => {
    try {
      if (action === "accept") {
        await api.post(`/friends/${row.id}/accept`);
        toast.success("Freundschaftsanfrage angenommen.");
      } else if (action === "decline") {
        await api.post(`/friends/${row.id}/decline`);
        toast.success("Freundschaftsanfrage abgelehnt.");
      } else if (action === "remove") {
        await api.delete(`/friends/${row.user.id}`);
        toast.success(row.status === "pending" ? "Anfrage zurückgezogen." : "Freund entfernt.");
      }
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Aktion konnte nicht ausgeführt werden."));
    }
  };

  return (
    <div className="space-y-5" data-testid="profile-friends-tab">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
        <div className="flex items-start gap-3">
          <UserPlus className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Freunde</div>
            <h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1">Freundschaftssystem</h2>
            <p className="text-sm text-white/55 mt-1">Freunde können über öffentliche Profile hinzugefügt werden. In der Privatsphäre kannst du Nachrichten auf Freunde beschränken.</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-white/40 font-display tracking-widest">LADE FREUNDE ...</div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5">
          <FriendList title="Offene Anfragen" rows={data.incoming || []} empty="Keine offenen Anfragen.">
            {(row) => (
              <>
                <button type="button" onClick={() => act(row, "accept")} className="px-3 py-1.5 bg-[#29B6E8] text-black rounded-sm text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1"><Check className="w-3 h-3" /> Annehmen</button>
                <button type="button" onClick={() => act(row, "decline")} className="px-3 py-1.5 border border-white/15 text-white/60 rounded-sm text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1"><X className="w-3 h-3" /> Ablehnen</button>
              </>
            )}
          </FriendList>
          <FriendList title="Meine Freunde" rows={data.friends || []} empty="Noch keine Freunde.">
            {(row) => (
              <>
                <Link to={`/messages/${row.user?.id}`} className="px-3 py-1.5 border border-[#29B6E8]/45 text-[#29B6E8] rounded-sm text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Schreiben</Link>
                <button type="button" onClick={() => act(row, "remove")} className="px-3 py-1.5 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] uppercase tracking-wider font-bold">Entfernen</button>
              </>
            )}
          </FriendList>
          <FriendList title="Gesendet" rows={data.outgoing || []} empty="Keine gesendeten offenen Anfragen.">
            {(row) => (
              <button type="button" onClick={() => act(row, "remove")} className="px-3 py-1.5 border border-white/15 text-white/60 rounded-sm text-[10px] uppercase tracking-wider font-bold">Zurückziehen</button>
            )}
          </FriendList>
        </div>
      )}
    </div>
  );
}

function FriendList({ title, rows, empty, children }) {
  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 font-heading font-black uppercase">{title}</div>
      <div className="divide-y divide-white/5">
        {rows.map((row) => (
          <div key={row.id} className="p-4">
            <Link to={`/u/${row.user?.username}`} className="block min-w-0">
              <div className="font-bold truncate">{row.user?.display_name || row.user?.username || "Benutzer"}</div>
              {row.user?.username && <div className="text-xs text-white/40 truncate">@{row.user.username}</div>}
            </Link>
            <div className="mt-3 flex flex-wrap gap-2">{children(row)}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="p-6 text-sm text-white/35 text-center">{empty}</div>}
      </div>
    </section>
  );
}

