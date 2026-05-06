import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

export default function AdminAuditPage() {
  const [logs, setLogs] = useState([]);
  const [q, setQ] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(() => {
    api.get(`/audit${q ? `?action=${encodeURIComponent(q)}` : ""}`).then(({ data }) => setLogs(data));
  }, [q]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load);

  const visibleLogs = useMemo(
    () => logs.filter((l) => showSettings || !String(l.action || "").startsWith("settings.")),
    [logs, showSettings],
  );

  const details = (log) => {
    const parts = [];
    if (log.target_id) parts.push(`target: ${String(log.target_id).slice(0, 24)}`);
    if (Array.isArray(log.data?.changed_fields)) parts.push(`felder: ${log.data.changed_fields.join(", ")}`);
    else if (log.data) parts.push(JSON.stringify(log.data));
    return parts.join(" | ");
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Audit</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Audit Logs</h1>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          placeholder="Nach Aktion filtern..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="audit-filter"
          className="w-full max-w-md bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
        />
        <label className="inline-flex items-center gap-2 text-xs text-white/60 border border-white/10 px-3 py-2 rounded-sm bg-[#121212]">
          <input
            type="checkbox"
            checked={showSettings}
            onChange={(e) => setShowSettings(e.target.checked)}
            className="accent-[#29B6E8]"
          />
          Settings-Logs anzeigen
        </label>
        {!showSettings && logs.length !== visibleLogs.length && (
          <span className="text-xs text-white/40">{logs.length - visibleLogs.length} Settings-Eintraege ausgeblendet</span>
        )}
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Zeit</th>
                <th className="text-left px-4 py-3">Aktion</th>
                <th className="text-left px-4 py-3">Akteur</th>
                <th className="text-left px-4 py-3">Ziel / Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleLogs.map((log, i) => (
                <tr key={log.id || i}>
                  <td className="px-4 py-3 text-white/50 text-xs">
                    {log.created_at && new Date(log.created_at).toLocaleString("de-DE")}
                  </td>
                  <td className="px-4 py-3 text-[#29B6E8] text-xs font-mono">{log.action}</td>
                  <td className="px-4 py-3">
                    {log.actor_display_name || log.actor_username || log.actor_id?.slice(0, 8) || "-"}
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs truncate max-w-md">{details(log)}</td>
                </tr>
              ))}
              {visibleLogs.length === 0 && (
                <tr>
                  <td colSpan="4" className="text-center py-10 text-white/40">Keine Eintraege</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
