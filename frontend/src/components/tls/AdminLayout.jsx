import { NavLink, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import {
  LayoutDashboard, Trophy, Gamepad2, Users as UsersIcon,
  CalendarDays, Flag, Building2, Newspaper, LogOut,
  ExternalLink, Menu, X, Settings as SettingsIcon,
  ShieldCheck, Code2, Star, Crown, Gift, Image as ImageIcon,
  Award, Inbox, UserCheck, Medal,
  FolderOpen, AlertTriangle, Handshake,
} from "lucide-react";
import { useState } from "react";

export function AdminLayout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const nav = useNavigate();
  const [openMobile, setOpenMobile] = useState(false);

  const items = [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/admin/members", label: "Mitglieder", icon: Crown },
    { to: "/admin/benefits", label: "Mitgliedervorteile", icon: Gift },
    { to: "/admin/users", label: "Benutzer", icon: UsersIcon },
    { to: "/admin/tournaments", label: "Turniere", icon: Trophy },
    { to: "/admin/f1", label: "Fast Lap", icon: Flag },
    { to: "/admin/events", label: "Events", icon: CalendarDays },
    { to: "/admin/seasons", label: "Saisons / Circuit", icon: Trophy },
    { to: "/admin/games", label: "Spiele", icon: Gamepad2 },
    { to: "/admin/game-servers", label: "Game-Server", icon: Building2 },
    { to: "/admin/stations", label: "Stationen", icon: Building2 },
    { to: "/admin/news", label: "News", icon: Newspaper },
    { to: "/admin/gallery", label: "Galerie", icon: ImageIcon },
    { to: "/admin/sponsors", label: "Sponsoren", icon: Star },
    { to: "/admin/partners", label: "Partner", icon: Handshake },
    { to: "/admin/references", label: "Referenzen", icon: Medal },
    { to: "/admin/achievements", label: "Achievements", icon: Medal },
    { to: "/admin/board", label: "Vorstand", icon: UserCheck },
    { to: "/admin/membership-applications", label: "Bewerbungen", icon: Inbox },
    { to: "/admin/media", label: "Medien", icon: FolderOpen },
    { to: "/admin/contact", label: "Inbox", icon: Inbox },
    { to: "/admin/prizes", label: "Gewinne", icon: Award },
    { to: "/admin/penalties", label: "Strafen", icon: AlertTriangle },
    { to: "/admin/widgets", label: "Widgets", icon: Code2 },
    { to: "/admin/audit", label: "Audit Logs", icon: ShieldCheck },
    { to: "/admin/settings", label: "Einstellungen", icon: SettingsIcon },
  ];
  const visibleItems = isAdmin
    ? items
    : items.filter((it) => ["/admin/tournaments", "/admin/f1"].includes(it.to));

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex">
      {/* Sidebar — Flex column with scrollable nav */}
      <aside className={`fixed md:sticky top-0 left-0 h-screen w-64 bg-[#0A0A0A] border-r border-white/10 z-40 transform transition-transform flex flex-col ${openMobile ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <Logo size="sm" />
          <button className="md:hidden p-1" onClick={() => setOpenMobile(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1 admin-scroll">
          {visibleItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={() => setOpenMobile(false)}
              data-testid={`admin-nav-${it.to.split("/").pop() || "dashboard"}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-semibold transition-all ${
                  isActive
                    ? "bg-[#29B6E8]/15 text-[#29B6E8] border-l-2 border-[#29B6E8]"
                    : "text-white/70 hover:text-white hover:bg-white/5"
                }`
              }
            >
              <it.icon className="w-4 h-4" />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="shrink-0 p-3 border-t border-white/10 space-y-2 bg-[#0A0A0A]">
          <Link
            to="/"
            data-testid="admin-exit-link"
            className="flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-[#29B6E8]"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Public Seite
          </Link>
          <div className="px-3 pt-2 flex items-center justify-between">
            <div className="text-xs">
              <div className="text-white font-semibold truncate max-w-[130px]">{user?.display_name || user?.username}</div>
              <div className="text-[10px] text-[#29B6E8] uppercase tracking-widest">{user?.role}</div>
            </div>
            <button
              onClick={async () => { await logout(); nav("/"); }}
              data-testid="admin-logout"
              className="inline-flex items-center gap-1.5 px-2 py-2 text-[#FF3B30] border border-[#FF3B30]/30 hover:bg-[#FF3B30]/10 rounded-sm text-[10px] font-bold uppercase tracking-wider"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
        <style>{`.admin-scroll::-webkit-scrollbar{width:6px}.admin-scroll::-webkit-scrollbar-track{background:transparent}.admin-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}.admin-scroll::-webkit-scrollbar-thumb:hover{background:rgba(41,182,232,0.4)}`}</style>
      </aside>
      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-30 bg-[#0A0A0A] border-b border-white/10 p-3 flex items-center justify-between">
          <button onClick={() => setOpenMobile(true)} className="p-2" data-testid="admin-menu-open">
            <Menu className="w-5 h-5" />
          </button>
          <Logo size="sm" />
          <div className="w-9" />
        </div>
        <main className="p-4 md:p-8 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
