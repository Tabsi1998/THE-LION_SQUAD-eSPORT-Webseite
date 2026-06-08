import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Flag, Settings, ShieldCheck, Trophy, Users } from "lucide-react";

const ACTION_FILTERS = [
  ["", "Alle Aktionen"],
  ["user.", "User"],
  ["user.role", "Rollen"],
  ["tournament.staff", "Turnier-Staff"],
  ["f1.staff", "Fast-Lap-Staff"],
  ["match.", "Matches"],
  ["prize.", "Gewinne"],
  ["settings.", "Settings"],
];

export default function AdminAuditPage() {
  const [params, setParams] = useSearchParams();
  const [logs, setLogs] = useState([]);
  const [q, setQ] = useState(() => params.get("action") || "");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    setQ(params.get("action") || "");
  }, [params]);

  const setActionFilter = (value) => {
    setQ(value);
    setParams(value ? { action: value } : {});
  };

  const load = useCallback(() => {
    api.get(`/audit${q ? `?action=${encodeURIComponent(q)}` : ""}`).then(({ data }) => setLogs(data));
  }, [q]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load);

  const visibleLogs = useMemo(
    () => logs.filter((log) => showSettings || !String(log.action || "").startsWith("settings.")),
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

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        {[
          { to: "/admin/users", label: "Globale Rollen", text: "Admin-, Staff- und Accountrechte", icon: Users },
          { to: "/admin/tournaments", label: "Turnier-Staff", text: "Leitung, Ergebnis, Stationen", icon: Trophy },
          { to: "/admin/f1", label: "Fast-Lap-Staff", text: "Zeitnehmer und Challenge-Rechte", icon: Flag },
          { to: "/admin/settings?tab=system", label: "Systemrechte", text: "Integrationen, Mail, Analytics", icon: Settings },
        ].map((item) => (
          <Link key={item.label} to={item.to} className="rounded-sm border border-white/10 bg-[#121212] p-4 hover:border-[#29B6E8]/45">
            <item.icon className="h-4 w-4 text-[#29B6E8]" />
            <div className="mt-3 text-xs font-bold uppercase tracking-wider text-white">{item.label}</div>
            <div className="mt-1 text-xs text-white/45">{item.text}</div>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          placeholder="Nach Aktion filtern..."
          value={q}
          onChange={(event) => setActionFilter(event.target.value)}
          data-testid="audit-filter"
          className="w-full max-w-md bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
        />
        <label className="inline-flex items-center gap-2 text-xs text-white/60 border border-white/10 px-3 py-2 rounded-sm bg-[#121212]">
          <input
            type="checkbox"
            checked={showSettings}
            onChange={(event) => setShowSettings(event.target.checked)}
            className="accent-[#29B6E8]"
          />
          Settings-Logs anzeigen
        </label>
        {!showSettings && logs.length !== visibleLogs.length && (
          <span className="text-xs text-white/40">{logs.length - visibleLogs.length} Settings-Eintraege ausgeblendet</span>
        )}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {ACTION_FILTERS.map(([value, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => setActionFilter(value)}
            className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[10px] font-bold uppercase tracking-widest ${
              q === value ? "border-[#29B6E8] bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/55 hover:text-white"
            }`}
          >
            {value === "user.role" && <ShieldCheck className="h-3.5 w-3.5" />}
            {label}
          </button>
        ))}
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
              {visibleLogs.map((log, index) => (
                <tr key={log.id || index}>
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
