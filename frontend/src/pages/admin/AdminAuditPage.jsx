import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";

export default function AdminAuditPage() {
  const [logs, setLogs] = useState([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.get(`/audit${q ? `?action=${q}` : ""}`).then(({ data }) => setLogs(data));
  }, [q]);
  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Audit</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Audit Logs</h1>
      <input placeholder="Nach Aktion filtern …" value={q} onChange={(e)=>setQ(e.target.value)} data-testid="audit-filter" className="w-full max-w-md bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm mb-5"/>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr><th className="text-left px-4 py-3">Zeit</th><th className="text-left px-4 py-3">Aktion</th><th className="text-left px-4 py-3">Akteur</th><th className="text-left px-4 py-3">Ziel / Details</th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {logs.map((l,i) => (
              <tr key={l.id||i}>
                <td className="px-4 py-3 text-white/50 text-xs">{l.created_at && new Date(l.created_at).toLocaleString("de-DE")}</td>
                <td className="px-4 py-3 text-[#29B6E8] text-xs font-mono">{l.action}</td>
                <td className="px-4 py-3">{l.actor_display_name || l.actor_username || l.actor_id?.slice(0,8) || "—"}</td>
                <td className="px-4 py-3 text-white/60 text-xs truncate max-w-md">{l.target_id ? `target: ${l.target_id.slice(0,8)}` : ""} {l.data && JSON.stringify(l.data)}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan="4" className="text-center py-10 text-white/40">Keine Einträge</td></tr>}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
