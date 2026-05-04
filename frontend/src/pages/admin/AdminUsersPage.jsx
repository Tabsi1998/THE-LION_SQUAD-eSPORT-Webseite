import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";

export default function AdminUsersPage() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const load = async () => {
    const { data } = await api.get(`/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    setList(data);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [q]);

  const setRole = async (id, role) => {
    try { await api.post(`/users/${id}/role`, { role }); toast.success("Rolle aktualisiert."); load(); }
    catch { toast.error("Fehler (nur Superadmin)."); }
  };
  const toggleBan = async (u) => {
    await api.post(`/users/${u.id}/${u.is_banned ? "unban" : "ban"}`);
    toast.success(u.is_banned ? "Entbannt." : "Gebannt.");
    load();
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Spieler</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Benutzer</h1>
      <input placeholder="Suche…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="users-search" className="w-full max-w-md bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm mb-5" />
      <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-4 py-3">Username</th>
              <th className="text-left px-4 py-3">Display</th>
              <th className="text-left px-4 py-3">E-Mail</th>
              <th className="text-left px-4 py-3">Rolle</th>
              <th className="text-center px-4 py-3">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {list.map((u) => (
              <tr key={u.id} className={u.is_banned ? "opacity-50" : ""}>
                <td className="px-4 py-3 text-white/80">{u.username}</td>
                <td className="px-4 py-3">{u.display_name}</td>
                <td className="px-4 py-3 text-white/60 text-xs">{u.email}</td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)} data-testid={`user-role-${u.username}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs">
                    {["player", "team_leader", "moderator", "tournament_admin", "club_admin", "superadmin"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleBan(u)} data-testid={`user-ban-${u.username}`} className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-sm ${u.is_banned ? "text-[#00FF88] border border-[#00FF88]/40" : "text-[#FF3B30] border border-[#FF3B30]/40 hover:bg-[#FF3B30]/10"}`}>
                    {u.is_banned ? "Entbannen" : "Bannen"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </AdminLayout>
  );
}
