import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Trophy, Users as UsersIcon, Flag, CalendarDays, Radio, AlertTriangle, ShieldCheck, GamepadIcon, Sparkles } from "lucide-react";

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const load = useCallback(() => {
    api.get("/admin/dashboard").then(({ data }) => setData(data));
    api.get("/setup/status").then(({ data }) => setSetupStatus(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load);

  const kpis = [
    { label: "Spieler", value: data?.player_count, icon: UsersIcon, color: "#29B6E8" },
    { label: "Teams", value: data?.team_count, icon: UsersIcon, color: "#29B6E8" },
    { label: "Aktive Turniere", value: data?.active_tournaments, icon: Trophy, color: "#FF3B30" },
    { label: "Anmeldung offen", value: data?.registration_open, icon: GamepadIcon, color: "#00FF88" },
    { label: "Matches heute", value: data?.today_matches, icon: Radio, color: "#FFD700" },
    { label: "Offene Disputes", value: data?.open_disputes, icon: AlertTriangle, color: "#FF3B30" },
    { label: "Fast Lap Live", value: data?.active_f1, icon: Flag, color: "#29B6E8" },
    { label: "Events Gesamt", value: data?.total_events, icon: CalendarDays, color: "#29B6E8" },
  ];

  return (
    <AdminLayout>
      <div className="mb-8">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Control Room</span>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Dashboard</h1>
      </div>

      {setupStatus && (!setupStatus.completed || (setupStatus.health_score || 0) < 100) && (
        <Link to="/setup" data-testid="dashboard-setup-cta" className="block mb-6 border border-[#29B6E8]/40 bg-gradient-to-r from-[#29B6E8]/10 to-transparent rounded-sm p-4 hover:border-[#29B6E8] transition group">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-[#29B6E8] shrink-0" />
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Plattform-Setup {setupStatus.health_score ?? 0}%</div>
                <div className="font-heading text-base mt-0.5">
                  {setupStatus.completed ? "Setup prüfen — es fehlen noch sinnvolle Konfigurationspunkte" : "Setup-Wizard ausführen — Branding, SMTP & Admin-Passwort in 4 Schritten"}
                </div>
                {(setupStatus.missing || []).length > 0 && (
                  <div className="text-xs text-white/45 mt-1">
                    Offen: {(setupStatus.missing || []).slice(0, 3).map((m) => m.label).join(", ")}
                  </div>
                )}
              </div>
            </div>
            <div className="text-[#29B6E8] text-2xl group-hover:translate-x-1 transition-transform">→</div>
          </div>
        </Link>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} data-testid={`kpi-${k.label}`} className="border border-white/10 rounded-sm bg-[#121212] p-4 hover:border-[#29B6E8]/40 transition">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-white/50 font-bold">{k.label}</span>
              <k.icon className="w-4 h-4" style={{ color: k.color }} />
            </div>
            <div className="mt-3 font-display font-bold text-4xl text-white">{k.value ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="mt-10 grid md:grid-cols-2 gap-6">
        <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
          <h2 className="font-heading font-bold uppercase text-lg mb-3">Schnellzugriff</h2>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/admin/tournaments/new" data-testid="quick-new-tournament" className="px-4 py-3 border border-[#29B6E8]/40 text-[#29B6E8] text-sm uppercase tracking-wider font-bold rounded-sm hover:bg-[#29B6E8]/10">+ Turnier</Link>
            <Link to="/admin/f1/new" data-testid="quick-new-f1" className="px-4 py-3 border border-[#29B6E8]/40 text-[#29B6E8] text-sm uppercase tracking-wider font-bold rounded-sm hover:bg-[#29B6E8]/10">+ Fast Lap Challenge</Link>
            <Link to="/admin/events" className="px-4 py-3 border border-white/10 text-white text-sm uppercase tracking-wider font-bold rounded-sm hover:border-[#29B6E8]/40">Events</Link>
            <Link to="/admin/stations" className="px-4 py-3 border border-white/10 text-white text-sm uppercase tracking-wider font-bold rounded-sm hover:border-[#29B6E8]/40">Stationen</Link>
          </div>
        </div>
        <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
          <h2 className="font-heading font-bold uppercase text-lg mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Letzte Adminaktionen</h2>
          <div className="space-y-2 text-sm">
            {(data?.recent_audit_logs || []).slice(0, 8).map((l, i) => (
              <div key={i} className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-white/80">{l.action}</span>
                <span className="text-white/40 text-xs">{l.created_at && new Date(l.created_at).toLocaleString("de-DE")}</span>
              </div>
            ))}
            {(!data || data.recent_audit_logs?.length === 0) && <div className="text-white/40">Keine Einträge.</div>}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
