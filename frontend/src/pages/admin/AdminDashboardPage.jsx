import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Trophy, Users as UsersIcon, Flag, CalendarDays, Radio, AlertTriangle, ShieldCheck, GamepadIcon, Sparkles, ImageIcon, Activity, BellRing, Bug, Inbox, Award, Mail, Search } from "lucide-react";

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
    { label: "Spiele heute", value: data?.today_matches, icon: Radio, color: "#FFD700" },
    { label: "Offene Disputes", value: data?.open_disputes, icon: AlertTriangle, color: "#FF3B30" },
    { label: "Fast Lap Live", value: data?.active_f1, icon: Flag, color: "#29B6E8" },
    { label: "Events Gesamt", value: data?.total_events, icon: CalendarDays, color: "#29B6E8" },
    { label: "Mitgliedsanträge", value: data?.membership_applications?.pending, icon: Inbox, color: "#FFD700" },
    { label: "Gewinne offen", value: data?.prize_pickups?.pending, icon: Award, color: "#FFD700" },
    { label: "Push aktiv", value: data?.mobile_push?.active_tokens, icon: BellRing, color: "#00FF88" },
    { label: "Offene Logs", value: data?.client_logs?.open, icon: Bug, color: "#FFD700" },
  ];
  const pushErrors = Number(data?.mobile_push?.ticket_errors || 0) + Number(data?.mobile_push?.receipt_errors || 0);
  const pendingApplications = Number(data?.membership_applications?.pending || 0);
  const pendingPrizes = Number(data?.prize_pickups?.pending || 0);
  const readyPrizes = Number(data?.prize_pickups?.ready || 0);
  const pendingRegistrations = Number(data?.tournament_registrations?.pending || 0);
  const taskItems = [
    {
      label: "Setup prüfen",
      detail: setupStatus && (!setupStatus.completed || (setupStatus.health_score || 0) < 100)
        ? `${setupStatus.health_score ?? 0}% abgeschlossen`
        : "Grundkonfiguration sieht sauber aus",
      to: "/setup",
      icon: Sparkles,
      tone: setupStatus && (!setupStatus.completed || (setupStatus.health_score || 0) < 100) ? "#FFD700" : "#00FF88",
    },
    {
      label: "Ergebnis-Konflikte",
      detail: `${data?.open_disputes ?? 0} offene Disputes`,
      to: "/admin/tournaments?status=live",
      icon: AlertTriangle,
      tone: (data?.open_disputes || 0) > 0 ? "#FF3B30" : "#00FF88",
    },
    {
      label: "Mitgliedsanträge",
      detail: `${pendingApplications} offene Anträge`,
      to: "/admin/membership-applications?status=pending",
      icon: Inbox,
      tone: pendingApplications > 0 ? "#FFD700" : "#00FF88",
    },
    {
      label: "Turnier-Anmeldungen",
      detail: `${pendingRegistrations} warten auf Freigabe`,
      to: "/admin/tournaments?status=registration_open",
      icon: GamepadIcon,
      tone: pendingRegistrations > 0 ? "#FFD700" : "#00FF88",
    },
    {
      label: "Gewinne",
      detail: `${pendingPrizes} offen, ${readyPrizes} abholbereit`,
      to: pendingPrizes > 0 ? "/admin/prizes?status=pending" : readyPrizes > 0 ? "/admin/prizes?status=ready" : "/admin/prizes",
      icon: Award,
      tone: pendingPrizes > 0 ? "#FFD700" : readyPrizes > 0 ? "#29B6E8" : "#00FF88",
    },
    {
      label: "Push-Monitoring",
      detail: `${data?.mobile_push?.active_tokens ?? 0} aktive Tokens, ${pushErrors} Fehler`,
      to: "/admin/mobile-push",
      icon: BellRing,
      tone: pushErrors > 0 ? "#FF3B30" : (data?.mobile_push?.active_tokens || 0) > 0 ? "#00FF88" : "#FFD700",
    },
    {
      label: "Client-Logs",
      detail: `${data?.client_logs?.critical_open ?? 0} kritisch, ${data?.client_logs?.high_open ?? 0} hoch offen`,
      to: "/admin/mobile-logs",
      icon: Bug,
      tone: (data?.client_logs?.critical_open || 0) > 0 ? "#FF3B30" : (data?.client_logs?.open || 0) > 0 ? "#FFD700" : "#00FF88",
    },
    {
      label: "Medien-Check",
      detail: "Banner, Track-Bilder und ungenutzte Dateien prüfen",
      to: "/admin/media",
      icon: ImageIcon,
      tone: "#29B6E8",
    },
    {
      label: "Audit & Rollen",
      detail: "Rollenwechsel, Staff-Zuweisungen und Adminaktionen",
      to: "/admin/audit",
      icon: ShieldCheck,
      tone: "#29B6E8",
    },
    {
      label: "Systemstatus",
      detail: "Mail-Queue, Uploads, Scheduler und Integrationen",
      to: "/admin/settings?tab=system",
      icon: Activity,
      tone: "#29B6E8",
    },
    {
      label: "Mail-Queue",
      detail: "Fehler, Newsletter und Versandjobs prüfen",
      to: "/admin/settings?tab=queue",
      icon: Mail,
      tone: "#29B6E8",
    },
    {
      label: "SEO & Analytics",
      detail: "Domain, IndexNow und Tracking-IDs prüfen",
      to: "/admin/settings?tab=seo",
      icon: Search,
      tone: "#29B6E8",
    },
  ];
  const taskIsActive = (item) => {
    if (item.to === "/setup") return Boolean(setupStatus && (!setupStatus.completed || (setupStatus.health_score || 0) < 100));
    if (item.to === "/admin/tournaments?status=live") return Number(data?.open_disputes || 0) > 0;
    if (item.to === "/admin/membership-applications?status=pending") return pendingApplications > 0;
    if (item.to === "/admin/tournaments?status=registration_open") return pendingRegistrations > 0;
    if (item.to.startsWith("/admin/prizes")) return pendingPrizes > 0 || readyPrizes > 0;
    if (item.to === "/admin/mobile-push") return pushErrors > 0;
    if (item.to === "/admin/mobile-logs") return Number(data?.client_logs?.open || 0) > 0;
    return false;
  };
  const fallbackTaskRoutes = ["/admin/media", "/admin/audit", "/admin/settings?tab=system", "/admin/settings?tab=seo"];
  const activeTaskItems = taskItems.filter(taskIsActive);
  const fallbackTaskItems = taskItems.filter((item) => fallbackTaskRoutes.includes(item.to));
  const primaryTaskItems = activeTaskItems.length ? activeTaskItems : fallbackTaskItems;
  const secondaryTaskItems = taskItems.filter((item) => !primaryTaskItems.includes(item));

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

      <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-[#29B6E8] font-bold">Tageszentrale</div>
            <h2 className="font-heading font-bold uppercase text-lg mt-1">Offene Aufgaben</h2>
          </div>
          <span className="text-xs text-white/40">{new Date().toLocaleDateString("de-DE")}</span>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          {primaryTaskItems.map((item) => (
            <Link key={item.label} to={item.to} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 hover:border-[#29B6E8]/50 transition group">
              <div className="flex items-center justify-between gap-3">
                <item.icon className="w-4 h-4" style={{ color: item.tone }} />
                <span className="text-[#29B6E8] group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <div className="mt-3 text-xs font-bold uppercase tracking-wider text-white">{item.label}</div>
              <div className="mt-1 text-xs text-white/45 leading-relaxed">{item.detail}</div>
            </Link>
          ))}
        </div>
        {secondaryTaskItems.length > 0 && (
          <details className="mt-4 border-t border-white/10 pt-4 group">
            <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-[0.25em] text-white/45 hover:text-white inline-flex items-center gap-2">
              Weitere Werkzeuge <span className="text-[#29B6E8] group-open:rotate-90 transition-transform">→</span>
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {secondaryTaskItems.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className="inline-flex items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:border-[#29B6E8]/50 hover:text-white"
                >
                  <item.icon className="w-3.5 h-3.5" style={{ color: item.tone }} />
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="mt-10 grid md:grid-cols-2 gap-6">
        <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
          <h2 className="font-heading font-bold uppercase text-lg mb-3">Schnellzugriff</h2>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/admin/tournaments/new" data-testid="quick-new-tournament" className="px-4 py-3 border border-[#29B6E8]/40 text-[#29B6E8] text-sm uppercase tracking-wider font-bold rounded-sm hover:bg-[#29B6E8]/10">+ Turnier</Link>
            <Link to="/admin/f1/new" data-testid="quick-new-f1" className="px-4 py-3 border border-[#29B6E8]/40 text-[#29B6E8] text-sm uppercase tracking-wider font-bold rounded-sm hover:bg-[#29B6E8]/10">+ Fast-Lap-Challenge</Link>
            <Link to="/admin/events" className="px-4 py-3 border border-white/10 text-white text-sm uppercase tracking-wider font-bold rounded-sm hover:border-[#29B6E8]/40">Events</Link>
            <Link to="/admin/stations" className="px-4 py-3 border border-white/10 text-white text-sm uppercase tracking-wider font-bold rounded-sm hover:border-[#29B6E8]/40">Stationen</Link>
          </div>
        </div>
        <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-heading font-bold uppercase text-lg flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Letzte Adminaktionen</h2>
            <Link to="/admin/audit" className="text-[10px] font-bold uppercase tracking-widest text-[#29B6E8] hover:text-white">Alle Logs</Link>
          </div>
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
