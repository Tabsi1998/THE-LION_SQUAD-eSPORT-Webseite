import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Plus, Trash2, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { formatTournamentDisplay } from "@/lib/tournamentLabels";
import { gameLabel } from "@/lib/gameLabels";

export default function AdminTournamentsPage() {
  const { isAdmin } = useAuth();
  const [list, setList] = useState([]);
  const confirm = useConfirm();
  const load = useCallback(async () => {
    const { data } = await api.get("/tournaments?include_drafts=true");
    setList(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments"]);

  const setStatus = async (id, status) => {
    try {
      await api.post(`/tournaments/${id}/status`, { status });
      toast.success(`Status: ${status}`);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Status konnte nicht geändert werden."));
    }
  };

  const del = async (id) => {
    if (!await confirm({
      title: "Turnier löschen?",
      description: "Das Turnier wird dauerhaft gelöscht. Teilnehmer, Turnierbaum und öffentliche Detailseite sind danach nicht mehr verfügbar.",
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/tournaments/${id}`);
      toast.success("Turnier gelöscht.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Turnier konnte nicht gelöscht werden."));
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Turniere</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">Turniere verwalten</h1>
        </div>
        {isAdmin && (
          <Link to="/admin/tournaments/new" data-testid="admin-new-tournament" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">
            <Plus className="w-4 h-4" /> Neues Turnier
          </Link>
        )}
      </div>
      <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-4 py-3">Titel</th>
              <th className="text-left px-4 py-3">Spiel</th>
              <th className="text-left px-4 py-3">Format</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Teilnehmer</th>
              <th className="text-right px-4 py-3">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {list.map((t) => (
              <tr key={t.id} data-testid={`admin-tr-${t.slug}`}>
                <td className="px-4 py-3">
                  <Link to={`/admin/tournaments/${t.id}`} className="font-semibold hover:text-[#29B6E8]">{t.title}</Link>
                </td>
                <td className="px-4 py-3 text-white/70">{gameLabel(t.game) || "—"}</td>
                <td className="px-4 py-3 text-white/70">{formatTournamentDisplay(t)}</td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-right">{t.participant_count}/{t.max_participants}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {isAdmin && t.status === "draft" && <button onClick={() => setStatus(t.id, "registration_open")} title="Anmeldung öffnen" className="p-2 hover:text-[#00FF88]"><Play className="w-3.5 h-3.5" /></button>}
                    {isAdmin && t.status === "live" && <button onClick={() => setStatus(t.id, "paused")} title="Pause" className="p-2 hover:text-[#FFD700]"><Pause className="w-3.5 h-3.5" /></button>}
                    {isAdmin && <button onClick={() => del(t.id)} className="p-2 hover:text-[#FF3B30]" title="Löschen"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="6" className="text-center py-10 text-white/40">Keine Turniere</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </AdminLayout>
  );
}
