import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { Menu, X, User, LogOut, Shield } from "lucide-react";
import { useState } from "react";

export function PublicLayout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = useNavigate();

  const items = [
    { to: "/", label: "Home", end: true },
    { to: "/tournaments", label: "Turniere" },
    { to: "/events", label: "Events" },
    { to: "/f1", label: "F1 Fast Lap" },
    { to: "/teams", label: "Teams" },
    { to: "/news", label: "News" },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0A0A0A]/80 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between gap-4">
          <Logo size="md" />
          <nav className="hidden lg:flex items-center gap-1">
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                data-testid={`nav-${it.to.replace("/", "") || "home"}`}
                className={({ isActive }) =>
                  `px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors rounded-sm ${
                    isActive ? "text-[#29B6E8] bg-[#29B6E8]/5" : "text-white/70 hover:text-white"
                  }`
                }
              >
                {it.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {isAdmin && (
                  <Link
                    to="/admin"
                    data-testid="nav-admin"
                    className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#FFD700] border border-[#FFD700]/40 rounded-sm hover:bg-[#FFD700]/10 transition"
                  >
                    <Shield className="w-3.5 h-3.5" /> Admin
                  </Link>
                )}
                <Link
                  to="/dashboard"
                  data-testid="nav-dashboard"
                  className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/80 border border-white/10 rounded-sm hover:border-[#29B6E8]/40 hover:text-[#29B6E8] transition"
                >
                  <User className="w-3.5 h-3.5" /> {user.display_name || user.username}
                </Link>
                <button
                  data-testid="nav-logout"
                  onClick={async () => { await logout(); nav("/"); }}
                  className="p-2 text-white/60 hover:text-[#FF3B30] transition"
                  aria-label="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  data-testid="nav-login"
                  className="hidden md:inline-flex px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/80 hover:text-[#29B6E8] transition"
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  data-testid="nav-register"
                  className="inline-flex px-4 py-2 text-xs font-bold uppercase tracking-wider bg-[#29B6E8] text-black hover:bg-[#1E95C2] hover:shadow-[0_0_15px_rgba(41,182,232,0.6)] transition-all rounded-sm"
                >
                  Registrieren
                </Link>
              </>
            )}
            <button
              data-testid="nav-mobile-toggle"
              className="lg:hidden p-2 text-white"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="lg:hidden border-t border-white/10 bg-[#0A0A0A]">
            <div className="px-4 py-4 flex flex-col gap-1">
              {items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `px-3 py-2 text-sm font-semibold uppercase tracking-wider rounded-sm ${
                      isActive ? "text-[#29B6E8] bg-[#29B6E8]/10" : "text-white/70"
                    }`
                  }
                >
                  {it.label}
                </NavLink>
              ))}
              {user && isAdmin && (
                <Link to="/admin" onClick={() => setMobileOpen(false)} className="px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#FFD700]">Admin</Link>
              )}
              {user && (
                <Link to="/dashboard" onClick={() => setMobileOpen(false)} className="px-3 py-2 text-sm font-semibold uppercase tracking-wider text-white/70">Dashboard</Link>
              )}
              {!user && (
                <Link to="/login" onClick={() => setMobileOpen(false)} className="px-3 py-2 text-sm font-semibold uppercase tracking-wider text-white/70">Login</Link>
              )}
            </div>
          </div>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/10 bg-[#0A0A0A] mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="md:col-span-2">
            <Logo size="lg" asLink={false} />
            <p className="mt-4 text-white/60 text-sm max-w-md">
              TLS ARENA ist das offizielle Turniersystem des THE LION SQUAD eSports Vereins — für Online-Turniere, Offline-Events und die legendäre F1 Fast Lap Championship.
            </p>
          </div>
          <div>
            <h4 className="font-heading font-bold text-white uppercase tracking-wider text-sm">Arena</h4>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><Link to="/tournaments" className="hover:text-[#29B6E8]">Turniere</Link></li>
              <li><Link to="/f1" className="hover:text-[#29B6E8]">F1 Fast Lap</Link></li>
              <li><Link to="/events" className="hover:text-[#29B6E8]">Events</Link></li>
              <li><Link to="/teams" className="hover:text-[#29B6E8]">Teams</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-heading font-bold text-white uppercase tracking-wider text-sm">Legal</h4>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><Link to="/privacy" className="hover:text-[#29B6E8]">Datenschutz</Link></li>
              <li><Link to="/imprint" className="hover:text-[#29B6E8]">Impressum</Link></li>
              <li><a href="https://discord.gg/thelionsquad" target="_blank" rel="noreferrer" className="hover:text-[#29B6E8]">Discord</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-white/40">
            <span>© {new Date().getFullYear()} THE LION SQUAD eSports. Alle Rechte vorbehalten.</span>
            <span className="font-display tracking-widest">TLS ARENA v1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
