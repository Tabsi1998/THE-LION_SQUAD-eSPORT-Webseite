import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { Menu, X, User, LogOut, Shield, Crown } from "lucide-react";
import { useState, useEffect } from "react";

export function PublicLayout({ children }) {
  const { user, logout, isAdmin, isClubMember } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [branding, setBranding] = useState(null);
  useEffect(() => {
    import("@/lib/api").then(({ api }) => {
      api.get("/settings/public").then(({ data }) => setBranding(data)).catch(() => {});
    });
  }, []);
  const nav = useNavigate();

  const items = [
    { to: "/", label: "Home", end: true },
    { to: "/about", label: "Verein" },
    { to: "/news", label: "News" },
    { to: "/events", label: "Events" },
    { to: "/tournaments", label: "Turniere" },
    { to: "/f1", label: "Fast Lap" },
    { to: "/teams", label: "Teams" },
    { to: "/gallery", label: "Galerie" },
    { to: "/members", label: "Mitglieder" },
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
                {isClubMember && (
                  <Link
                    to="/members/area"
                    data-testid="nav-member-area"
                    className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#FFD700] border border-[#FFD700]/40 rounded-sm hover:bg-[#FFD700]/10 transition"
                  >
                    <Crown className="w-3.5 h-3.5" /> Mitgliederbereich
                  </Link>
                )}
                {isAdmin && (
                  <Link
                    to="/admin"
                    data-testid="nav-admin"
                    className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#29B6E8] border border-[#29B6E8]/40 rounded-sm hover:bg-[#29B6E8]/10 transition"
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
              {user && isClubMember && (
                <Link to="/members/area" onClick={() => setMobileOpen(false)} className="px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#FFD700]">Mitgliederbereich</Link>
              )}
              {user && isAdmin && (
                <Link to="/admin" onClick={() => setMobileOpen(false)} className="px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#29B6E8]">Admin</Link>
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
              THE LION SQUAD — eSports. Die zentrale Plattform unseres Vereins für Community, Mitglieder, Turniere, Events und Fast Lap Challenges. Online & offline. Ein Rudel.
            </p>
          </div>
          <div>
            <h4 className="font-heading font-bold text-white uppercase tracking-wider text-sm">Verein</h4>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><Link to="/about" className="hover:text-[#29B6E8]">Über uns</Link></li>
              <li><Link to="/news" className="hover:text-[#29B6E8]">News</Link></li>
              <li><Link to="/members" className="hover:text-[#29B6E8]">Mitglieder</Link></li>
              <li><Link to="/membership/join" className="hover:text-[#29B6E8]">Mitglied werden</Link></li>
              <li><Link to="/contact" className="hover:text-[#29B6E8]">Kontakt</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-heading font-bold text-white uppercase tracking-wider text-sm">Arena</h4>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><Link to="/tournaments" className="hover:text-[#29B6E8]">Turniere</Link></li>
              <li><Link to="/f1" className="hover:text-[#29B6E8]">Fast Lap</Link></li>
              <li><Link to="/events" className="hover:text-[#29B6E8]">Events</Link></li>
              <li><Link to="/teams" className="hover:text-[#29B6E8]">Teams</Link></li>
              <li><Link to="/badges" className="hover:text-[#29B6E8]">Achievements</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-heading font-bold text-white uppercase tracking-wider text-sm">Community</h4>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><a href={branding?.discord_invite_url || "https://discord.com/invite/thelionsquadesports"} target="_blank" rel="noreferrer" data-testid="footer-discord" className="hover:text-[#29B6E8] inline-flex items-center gap-1.5"><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42z"/></svg> Discord</a></li>
              <li><a href={branding?.twitch_channel ? `https://www.twitch.tv/${branding.twitch_channel}` : "https://www.twitch.tv/the_lion_squad_esports"} target="_blank" rel="noreferrer" data-testid="footer-twitch" className="hover:text-[#9146FF] inline-flex items-center gap-1.5"><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg> Twitch</a></li>
              <li><Link to="/sponsors" className="hover:text-[#29B6E8]">Sponsoren</Link></li>
              <li><Link to="/partners" className="hover:text-[#29B6E8]">Partner</Link></li>
              <li><Link to="/privacy" className="hover:text-[#29B6E8]">Datenschutz</Link></li>
              <li><Link to="/imprint" className="hover:text-[#29B6E8]">Impressum</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-white/40">
            <span>© {new Date().getFullYear()} THE LION SQUAD — eSports. Alle Rechte vorbehalten.</span>
            <span className="font-display tracking-widest">VEREINSPLATTFORM v2.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
