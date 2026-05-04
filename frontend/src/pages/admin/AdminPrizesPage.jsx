import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { Award, CheckCircle2, Clock, XCircle, Gift, RefreshCw, AlertCircle } from "lucide-react";

const STATUS_LABEL = {
  pending: { label: "Offen", icon: Clock, color: "text-[#FFD700] bg-[#FFD700]/10 border-[#FFD700]/30" },
  ready: { label: "Bereit zur Abholung", icon: Gift, color: "text-[#29B6E8] bg-[#29B6E8]/10 border-[#29B6E8]/30" },
  picked_up: { label: "Abgeholt", icon: CheckCircle2, color: "text-[#00FF88] bg-[#00FF88]/10 border-[#00FF88]/30" },
  expired: { label: "Verfallen", icon: XCircle, color: "text-[#FF3B30] bg-[#FF3B30]/10 border-[#FF3B30]/30" },
};

export default function AdminPrizesPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(filter ? `/prizes?status=${filter}` : "/prizes");
      setItems(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filter]);

  const updateStatus = async (id, status, notes = "") => {
    try {
      await api.patch(`/prizes/${id}`, { status, notes });
      toast.success(status === "ready" ? "Markiert als bereit & E-Mail in Queue." :
                    status === "picked_up" ? "Als abgeholt markiert & E-Mail in Queue." : "Aktualisiert.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Gewinn-Eintrag wirklich löschen?")) return;
    try { await api.delete(`/prizes/${id}`); toast.success("Gelöscht."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const counts = items.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Phase 9</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-2">Preise & Gewinnabholung</h1>
      <p className="text-white/60 text-sm mb-6 max-w-2xl">
        Bei jedem auf <em>Ergebnisse veröffentlicht</em> gesetzten Turnier werden Gewinne automatisch
        anhand der hinterlegten Preisstruktur erstellt. Markiere Preise als <strong>bereit</strong>,
        sobald sie zur Abholung verfügbar sind — der Sieger bekommt automatisch eine E-Mail.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[["pending", "Offen"], ["ready", "Bereit"], ["picked_up", "Abgeholt"], ["expired", "Verfallen"]].map(([k, label]) => {
          const Icn = STATUS_LABEL[k].icon;
          return (
            <button key={k} onClick={() => setFilter(filter === k ? "" : k)} data-testid={`prize-stat-${k}`}
              className={`border rounded-sm p-3 text-left transition-all ${filter === k ? STATUS_LABEL[k].color : "border-white/10 bg-[#121212] text-white/70 hover:border-white/20"}`}>
              <Icn className="w-4 h-4 mb-1" />
              <div className="text-2xl font-black">{counts[k] || 0}</div>
              <div className="text-[10px] uppercase tracking-widest">{label}</div>
            </button>
          );
        })}
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Turnier</th>
                <th className="text-left px-4 py-3">Spieler</th>
                <th className="text-left px-4 py-3">Platz</th>
                <th className="text-left px-4 py-3">Gewinn</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Frist</th>
                <th className="text-right px-4 py-3">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr><td colSpan="7" className="text-center py-8 text-white/40">Lade…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="7" className="text-center py-12">
                  <Award className="w-10 h-10 text-white/30 mx-auto mb-2" />
                  <p className="text-white/50">Noch keine Gewinne erfasst.</p>
                  <p className="text-xs text-white/30 mt-1">Gewinne werden automatisch erstellt, sobald Turniere veröffentlicht werden.</p>
                </td></tr>
              ) : items.map((p) => {
                const s = STATUS_LABEL[p.status] || STATUS_LABEL.pending;
                const Icn = s.icon;
                return (
                  <tr key={p.id} data-testid={`prize-row-${p.id}`}>
                    <td className="px-4 py-3"><div className="font-semibold">{p.tournament_title || "—"}</div></td>
                    <td className="px-4 py-3"><div>{p.display_name}</div><div className="text-xs text-white/40">{p.email || "—"}</div></td>
                    <td className="px-4 py-3 font-bold text-[#29B6E8]">#{p.place}</td>
                    <td className="px-4 py-3"><div className="font-semibold">{p.prize_label}</div>{p.prize_value && <div className="text-xs text-white/50">{p.prize_value}</div>}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-sm border ${s.color}`}>
                        <Icn className="w-3 h-3" /> {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{p.pickup_deadline ? new Date(p.pickup_deadline).toLocaleDateString("de-DE") : "—"}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {p.status === "pending" && (
                        <button onClick={() => updateStatus(p.id, "ready")} data-testid={`prize-mark-ready-${p.id}`} className="text-[#29B6E8] hover:underline mr-3 text-xs font-semibold">Bereit ▸</button>
                      )}
                      {p.status === "ready" && (
                        <button onClick={() => updateStatus(p.id, "picked_up", window.prompt("Notiz (optional):") || "")} data-testid={`prize-pickup-${p.id}`} className="text-[#00FF88] hover:underline mr-3 text-xs font-semibold">Abgeholt ✓</button>
                      )}
                      {p.status === "picked_up" && (
                        <button onClick={() => updateStatus(p.id, "ready")} data-testid={`prize-revert-${p.id}`} className="text-white/50 hover:text-white mr-3 text-xs"><RefreshCw className="w-3 h-3 inline mr-1" />Zurück</button>
                      )}
                      <button onClick={() => remove(p.id)} className="text-[#FF3B30] hover:underline text-xs">Löschen</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-[#29B6E8] shrink-0 mt-0.5" />
        <div className="text-sm text-white/80">
          <strong>Hinweis:</strong> Die Abholfrist beträgt standardmäßig 90 Tage. Verfallene Gewinne werden automatisch markiert und eine E-Mail an den User gesendet.
        </div>
      </div>
    </AdminLayout>
  );
}
