import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Trophy, Users as UsersIcon, Flag, CalendarDays, Radio, AlertTriangle, ShieldCheck, GamepadIcon, Sparkles, ImageIcon, Activity, BellRing, Bug, Inbox, Award, Mail, Search, Settings as SettingsIcon, LogIn, Palette, MessageSquare, Database, Server, RefreshCw, Share2, TrendingUp } from "lucide-react";

function StatusDot({ ok }) {
  const color = ok === true ? "#00FF88" : ok === false ? "#FF3B30" : "#FFD700";
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />;
}

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [sys, setSys] = useState(null);
  const [authFlags, setAuthFlags] = useState(null);
  const [publicCfg, setPublicCfg] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const load = useCallback(() => {
    api.get("/admin/dashboard").then(({ data }) => { setData(data); setRefreshedAt(new Date()); });
    api.get("/setup/status").then(({ data }) => setSetupStatus(data)).catch(() => {});
    api.get("/admin/system-status").then(({ data }) => setSys(data)).catch(() => {});
    api.get("/settings/auth").then(({ data }) => setAuthFlags(data)).catch(() => {});
    api.get("/settings/public").then(({ data }) => setPublicCfg(data)).catch(() => {});
    api.get("/admin/growth-stats?days=30").then(({ data }) => setGrowth(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
  }, [load]);
  useApiInvalidation(load);

  const queuePending = Number(sys?.mail_queue?.pending || 0);
  const queueFailed = Number(sys?.mail_queue?.failed || 0);
  const liveChips = [
    { label: "Datenbank", ok: sys?.database?.ok, detail: sys?.database?.ok ? "verbunden" : "Problem", icon: Database, to: "/admin/settings?tab=system" },
    { label: "Mail / SMTP", ok: sys?.smtp?.ok, detail: sys?.smtp?.ok ? (sys?.smtp?.provider || "aktiv") : "nicht konfiguriert", icon: Mail, to: "/admin/settings?tab=smtp" },
    { label: "Discord", ok: sys?.discord?.ok, detail: sys?.discord?.ok ? "aktiv" : "aus", icon: MessageSquare, to: "/admin/settings?tab=discord" },
    { label: "Scheduler", ok: sys?.scheduler?.running, detail: sys?.scheduler?.running ? `${(sys?.scheduler?.jobs || []).length} Jobs` : "gestoppt", icon: Activity, to: "/admin/settings?tab=system" },
    { label: "Mail-Queue", ok: queueFailed ? false : queuePending ? null : true, detail: `${queuePending} offen · ${queueFailed} Fehler`, icon: Server, to: "/admin/settings?tab=queue" },
    { label: "Push-Tokens", ok: Number(data?.mobile_push?.active_tokens || 0) > 0 ? true : null, detail: `${data?.mobile_push?.active_tokens ?? 0} aktiv`, icon: BellRing, to: "/admin/mobile-push" },
  ];

  const onFlag = (v) => v === true ? "an" : v === false ? "aus" : "—";
  const settingsHub = [
    { label: "Login & Google", detail: authFlags ? `${onFlag(authFlags.google_login_enabled)} · Reg. ${onFlag(authFlags.registration_enabled)}` : "Login-Optionen", to: "/admin/settings?tab=auth", icon: LogIn, ok: authFlags ? (authFlags.password_login_enabled || authFlags.google_login_enabled) : undefined },
    { label: "Branding", detail: publicCfg?.club_name || "Logo, Farben, Name", to: "/admin/settings?tab=brand", icon: Palette, ok: undefined },
    { label: "E-Mail (Resend)", detail: sys?.smtp?.provider === "resend" && sys?.smtp?.ok ? "konfiguriert" : "prüfen", to: "/admin/settings?tab=email", icon: Mail, ok: sys?.smtp?.provider === "resend" ? sys?.smtp?.ok : undefined },
    { label: "SMTP-Server", detail: sys?.smtp?.host || "eigener Mailserver", to: "/admin/settings?tab=smtp", icon: Server, ok: sys?.smtp?.provider === "smtp" ? sys?.smtp?.ok : undefined },
    { label: "Newsletter", detail: "News & Event-Mails", to: "/admin/settings?tab=newsletter", icon: Mail, ok: undefined },
    { label: "Discord", detail: sys?.discord?.ok ? "Webhook aktiv" : "nicht verbunden", to: "/admin/settings?tab=discord", icon: MessageSquare, ok: sys?.discord?.ok },
    { label: "Twitch", detail: publicCfg?.twitch_channel ? `@${publicCfg.twitch_channel}` : "Live-Erkennung", to: "/admin/settings?tab=twitch", icon: Radio, ok: undefined },
    { label: "Socials", detail: "Kanäle & Links", to: "/admin/settings?tab=socials", icon: Share2, ok: undefined },
    { label: "SEO & Analytics", detail: publicCfg?.analytics_provider ? publicCfg.analytics_provider : "Tracking & IndexNow", to: "/admin/settings?tab=seo", icon: Search, ok: publicCfg?.analytics_provider ? true : undefined },
    { label: "Rechtliches", detail: "Impressum & Datenschutz", to: "/admin/settings?tab=legal", icon: ShieldCheck, ok: undefined },
    { label: "Navigation", detail: "Menüs steuern", to: "/admin/nav", icon: SettingsIcon, ok: undefined },
    { label: "Systemstatus", detail: "Queue, Uploads, Scheduler", to: "/admin/settings?tab=system", icon: Activity, ok: undefined },
  ];


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

  const growthData = (growth?.days || []).map((d) => ({
    ...d,
    label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}.`,
  }));
  const totalLogins30d = growthData.reduce((sum, d) => sum + (d.logins || 0), 0);
  const newUsers30d = growthData.reduce((sum, d) => sum + (d.new_users || 0), 0);

  return (
    <AdminLayout>
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Control Room</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Kommandozentrale</h1>
        </div>
        <button
          type="button"
          onClick={load}
          data-testid="dashboard-refresh"
          className="inline-flex items-center gap-2 rounded-sm border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:border-[#29B6E8]/50 hover:text-white transition"
          title="Live-Zahlen aktualisieren"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#29B6E8]" />
          {refreshedAt ? refreshedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "Aktualisieren"}
        </button>
      </div>

      {/* Live system health strip */}
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="dashboard-live-status">
        {liveChips.map((c) => (
          <Link key={c.label} to={c.to} className="border border-white/10 bg-[#121212] rounded-sm p-3 hover:border-[#29B6E8]/40 transition group">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/55">
                <c.icon className="w-3.5 h-3.5 text-white/45 group-hover:text-[#29B6E8] transition" />{c.label}
              </span>
              <StatusDot ok={c.ok} />
            </div>
            <div className="mt-2 text-xs text-white/70 truncate">{c.detail}</div>
          </Link>
        ))}
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

      <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="dashboard-growth-widget">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-[#29B6E8] font-bold inline-flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" /> Wachstum · letzte 30 Tage
            </div>
            <h2 className="font-heading font-bold uppercase text-lg mt-1">Logins & Mitglieder</h2>
          </div>
          <div className="flex gap-5 text-right">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">Logins</div>
              <div className="font-display font-bold text-2xl text-[#29B6E8] tabular-nums">{totalLogins30d}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">Neue Mitglieder</div>
              <div className="font-display font-bold text-2xl text-[#00FF88] tabular-nums">{newUsers30d}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">Gesamt</div>
              <div className="font-display font-bold text-2xl text-[#FFD700] tabular-nums">{growthData.length ? growthData[growthData.length - 1].total_users : "—"}</div>
            </div>
          </div>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={growthData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="growthLogins" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#29B6E8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#29B6E8" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="growthUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00FF88" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#00FF88" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} interval="preserveStartEnd" minTickGap={26} />
              <YAxis yAxisId="left" allowDecimals={false} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fill: "rgba(255,215,0,0.55)", fontSize: 10 }} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#0A0A0A", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: "rgba(255,255,255,0.6)", fontWeight: 700 }}
                formatter={(value, name) => [value, name === "logins" ? "Logins" : name === "new_users" ? "Neue Mitglieder" : "Mitglieder gesamt"]}
              />
              <Area yAxisId="left" type="monotone" dataKey="logins" name="logins" stroke="#29B6E8" strokeWidth={2} fill="url(#growthLogins)" />
              <Area yAxisId="left" type="monotone" dataKey="new_users" name="new_users" stroke="#00FF88" strokeWidth={1.5} fill="url(#growthUsers)" />
              <Line yAxisId="right" type="monotone" dataKey="total_users" name="total_users" stroke="#FFD700" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[10px] uppercase tracking-widest font-bold">
          <span className="inline-flex items-center gap-1.5 text-white/55"><span className="w-2.5 h-2.5 rounded-full bg-[#29B6E8]" /> Logins / Tag</span>
          <span className="inline-flex items-center gap-1.5 text-white/55"><span className="w-2.5 h-2.5 rounded-full bg-[#00FF88]" /> Neue Mitglieder / Tag</span>
          <span className="inline-flex items-center gap-1.5 text-white/55"><span className="w-2.5 h-2.5 rounded-full bg-[#FFD700]" /> Mitglieder gesamt</span>
        </div>
      </div>

      <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="dashboard-settings-hub">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-[#29B6E8] font-bold">Einstellungen-Zentrale</div>
            <h2 className="font-heading font-bold uppercase text-lg mt-1">Alles konfigurieren</h2>
          </div>
          <Link to="/admin/settings" className="text-[10px] font-bold uppercase tracking-widest text-[#29B6E8] hover:text-white">Alle Einstellungen</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {settingsHub.map((s) => (
            <Link key={s.label} to={s.to} data-testid={`settings-hub-${s.label}`} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 hover:border-[#29B6E8]/50 transition group">
              <div className="flex items-center justify-between gap-2">
                <s.icon className="w-4 h-4 text-[#29B6E8]" />
                {s.ok !== undefined ? <StatusDot ok={s.ok} /> : <span className="text-[#29B6E8] opacity-0 group-hover:opacity-100 transition">→</span>}
              </div>
              <div className="mt-3 text-xs font-bold uppercase tracking-wider text-white">{s.label}</div>
              <div className="mt-1 text-xs text-white/45 leading-relaxed truncate">{s.detail}</div>
            </Link>
          ))}
        </div>
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
            <Link to="/admin/logs" className="text-[10px] font-bold uppercase tracking-widest text-[#29B6E8] hover:text-white">Alle Logs</Link>
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
