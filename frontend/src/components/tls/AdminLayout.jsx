import { NavLink, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import {
  LayoutDashboard, Trophy, Gamepad2, Users as UsersIcon,
  CalendarDays, Flag, Building2, Newspaper, LogOut,
  ExternalLink, Menu, X, Settings as SettingsIcon,
  ShieldCheck, Code2, Star, Crown, Gift, Image as ImageIcon, FileText,
} from "lucide-react";
import { useState } from "react";

export function AdminLayout({ children }) {
  const { user, logout } = useAuth();
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
    { to: "/admin/stations", label: "Stationen", icon: Building2 },
    { to: "/admin/news", label: "News", icon: Newspaper },
    { to: "/admin/gallery", label: "Galerie", icon: ImageIcon },
    { to: "/admin/sponsors", label: "Sponsoren", icon: Star },
    { to: "/admin/widgets", label: "Widgets", icon: Code2 },
    { to: "/admin/audit", label: "Audit Logs", icon: ShieldCheck },
    { to: "/admin/settings", label: "Einstellungen", icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex">
      {/* Sidebar */}
      <aside className={`fixed md:sticky top-0 left-0 h-screen w-64 bg-[#0A0A0A] border-r border-white/10 z-40 transform transition-transform ${openMobile ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <Logo size="sm" />
          <button className="md:hidden p-1" onClick={() => setOpenMobile(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav className="p-3 space-y-1">
          {items.map((it) => (
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
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-white/10 space-y-2">
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
              className="p-2 text-white/60 hover:text-[#FF3B30]"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
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
