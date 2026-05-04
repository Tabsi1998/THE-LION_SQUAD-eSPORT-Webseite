/**
 * Phase C — Admin Mitgliedsbewerbungen Inbox.
 */
import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { Crown, Check, X as XIcon, Inbox, Eye } from "lucide-react";

const TABS = [
  { key: "pending",  label: "Offen",      color: "#29B6E8" },
  { key: "approved", label: "Akzeptiert", color: "#00FF88" },
  { key: "rejected", label: "Abgelehnt",  color: "#FF3B30" },
];

const PREF_LABEL = { full: "Vollmitglied", supporter: "Unterstützer", youth: "Jugend", honorary: "Ehren" };

export default function AdminMembershipApplicationsPage() {
  const [tab, setTab] = useState("pending");
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = () => api.get(`/membership/applications?status=${tab}`).then(({ data }) => setList(data));
  useEffect(() => { load(); }, [tab]);

  const decide = async (a, decision) => {
    const note = decision === "reject" ? window.prompt("Begründung (wird per Mail gesendet):") : window.prompt("Optionale Notiz:") || "";
    if (decision === "reject" && !note) return;
    try {
      await api.patch(`/membership/applications/${a.id}`, { decision, note: note || undefined });
      toast.success(decision === "approve" ? "Akzeptiert" : "Abgelehnt");
      setSelected(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Phase C</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 flex items-center gap-3"><Inbox className="w-6 h-6" /> Mitgliedsbewerbungen</h1>

      <div className="mt-6 flex gap-1 border-b border-white/10">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`apps-tab-${t.key}`} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition ${tab === t.key ? "" : "border-transparent text-white/50 hover:text-white"}`} style={tab === t.key ? { borderColor: t.color, color: t.color } : {}}>{t.label}</button>
        ))}
      </div>

      <div className="mt-6 border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]" data-testid="apps-table">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Eingereicht</th>
                <th className="text-left px-4 py-3">Spieler</th>
                <th className="text-left px-4 py-3">Wunsch</th>
                <th className="text-left px-4 py-3">Motivation</th>
                <th className="text-right px-4 py-3">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map(a => (
                <tr key={a.id} data-testid={`app-row-${a.id}`}>
                  <td className="px-4 py-3 text-xs text-white/45 whitespace-nowrap">{new Date(a.created_at).toLocaleDateString("de-DE")}</td>
                  <td className="px-4 py-3"><div className="font-semibold">{a.user_display_name || a.user_username}</div><div className="text-xs text-white/40">@{a.user_username}</div></td>
                  <td className="px-4 py-3 text-xs uppercase tracking-wider">{PREF_LABEL[a.contribution_pref] || a.contribution_pref}</td>
                  <td className="px-4 py-3 max-w-md text-white/60 truncate">{a.motivation}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setSelected(a)} className="text-[#29B6E8] hover:underline text-xs mr-3 inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Detail</button>
                    {a.status === "pending" && <>
                      <button onClick={() => decide(a, "approve")} data-testid={`app-approve-${a.id}`} className="text-[#00FF88] hover:underline text-xs mr-3 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Annehmen</button>
                      <button onClick={() => decide(a, "reject")} data-testid={`app-reject-${a.id}`} className="text-[#FF3B30] hover:underline text-xs inline-flex items-center gap-1"><XIcon className="w-3 h-3" /> Ablehnen</button>
                    </>}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan="5" className="px-4 py-12 text-center text-white/40 text-sm">Keine Bewerbungen.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4 overflow-y-auto" onClick={() => setSelected(null)}>
          <div className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-heading text-xl font-black uppercase flex items-center gap-2"><Crown className="w-5 h-5 text-[#FFD700]" /> Bewerbung Detail</h3>
              <button onClick={() => setSelected(null)} className="text-white/50 hover:text-white"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 text-sm">
              <Row k="Spieler" v={`${selected.user_display_name || selected.user_username} (@${selected.user_username})`} />
              <Row k="E-Mail" v={selected.user_email} />
              <Row k="Wunsch" v={PREF_LABEL[selected.contribution_pref]} />
              <Row k="Eingereicht" v={new Date(selected.created_at).toLocaleString("de-DE")} />
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Motivation</div>
                <p className="mt-1 whitespace-pre-wrap text-white/80">{selected.motivation}</p>
              </div>
              {selected.notes && <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Anmerkungen</div>
                <p className="mt-1 whitespace-pre-wrap text-white/80">{selected.notes}</p>
              </div>}
              {selected.decision_note && <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Admin-Notiz</div>
                <p className="mt-1 text-white/80">{selected.decision_note}</p>
              </div>}
            </div>
            {selected.status === "pending" && (
              <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-white/10">
                <button onClick={() => decide(selected, "reject")} className="px-4 py-2 border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 rounded-sm text-xs font-bold uppercase">Ablehnen</button>
                <button onClick={() => decide(selected, "approve")} className="px-4 py-2 bg-[#FFD700] text-black rounded-sm text-xs font-bold uppercase">Annehmen</button>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Row({ k, v }) {
  return <div className="flex justify-between gap-4 border-b border-white/5 pb-2"><span className="text-white/50 text-xs uppercase tracking-wider">{k}</span><span className="text-white text-right">{v}</span></div>;
}
