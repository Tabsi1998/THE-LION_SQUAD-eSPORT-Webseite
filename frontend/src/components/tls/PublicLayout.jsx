import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { MainNav, MobileNav } from "@/components/tls/MainNav";
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
  const closeMobile = () => setMobileOpen(false);
  const clubName = branding?.club_name || "THE LION SQUAD";
  const tagline = branding?.tagline || "eSports";

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0A0A0A]/80 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between gap-4">
          <Logo size="md" />
          <MainNav isClubMember={isClubMember} />
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
                  Mitglied werden
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
          <div className="lg:hidden border-t border-white/10 bg-[#0A0A0A] max-h-[calc(100vh-4rem)] overflow-y-auto">
            <div className="px-4 py-4 flex flex-col gap-1">
              <MobileNav isClubMember={isClubMember} onClose={closeMobile} />
              <div className="border-t border-white/10 mt-3 pt-3 space-y-0.5">
                {user && isClubMember && (
                  <Link to="/members/area" onClick={closeMobile} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#FFD700]">
                    <Crown className="w-3.5 h-3.5 inline mr-1.5" /> Mitgliederbereich
                  </Link>
                )}
                {user && isAdmin && (
                  <Link to="/admin" onClick={closeMobile} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#29B6E8]">
                    <Shield className="w-3.5 h-3.5 inline mr-1.5" /> Admin
                  </Link>
                )}
                {user ? (
                  <Link to="/dashboard" onClick={closeMobile} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-white/80">Mein Bereich</Link>
                ) : (
                  <>
                    <Link to="/login" onClick={closeMobile} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-white/80">Login</Link>
                    <Link to="/register" onClick={closeMobile} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#29B6E8]">Registrieren</Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/10 bg-[#0A0A0A] mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Reihe 1 — Brand + 4 Link-Spalten */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-12 gap-8">
            <div className="col-span-2 md:col-span-3 lg:col-span-4">
              <Logo size="lg" asLink={false} />
              <p className="mt-4 text-white/60 text-sm max-w-md">
                <strong className="text-white">{clubName} — {tagline}.</strong> Die offizielle Vereinsplattform für Community, Mitglieder, Events, Turniere und Fast-Lap-Challenges. Online &amp; offline. Ein Rudel.
              </p>
              <div className="mt-4 flex flex-wrap gap-2" data-testid="footer-socials">
                {/* Community first: Discord */}
                <a href={branding?.discord_invite_url || "https://discord.com/invite/thelionsquadesports"} target="_blank" rel="noreferrer" data-testid="footer-discord" aria-label="Discord" className="w-9 h-9 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#5865F2] hover:text-[#5865F2] text-white/70 transition">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42z"/></svg>
                </a>
                {/* Social: Facebook */}
                <a href={branding?.facebook_url || "https://www.facebook.com/thelionsquadesports"} target="_blank" rel="noreferrer" data-testid="footer-facebook" aria-label="Facebook" className="w-9 h-9 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#1877F2] hover:text-[#1877F2] text-white/70 transition">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
                {/* Social: Instagram */}
                <a href={branding?.instagram_url || "https://instagram.com/thelionsquadesports"} target="_blank" rel="noreferrer" data-testid="footer-instagram" aria-label="Instagram" className="w-9 h-9 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#E4405F] hover:text-[#E4405F] text-white/70 transition">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                </a>
                {/* Social: TikTok */}
                <a href={branding?.tiktok_url || "https://www.tiktok.com/@thelionsquadesports"} target="_blank" rel="noreferrer" data-testid="footer-tiktok" aria-label="TikTok" className="w-9 h-9 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#69C9D0] hover:text-[#69C9D0] text-white/70 transition">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005.8 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1.84-.1z"/></svg>
                </a>
                {/* Streaming last: YouTube */}
                <a href={branding?.youtube_url || "https://www.youtube.com/@TheLionSquadeSports"} target="_blank" rel="noreferrer" data-testid="footer-youtube" aria-label="YouTube" className="w-9 h-9 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#FF0000] hover:text-[#FF0000] text-white/70 transition">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                </a>
                {/* Streaming: Twitch */}
                <a href={branding?.twitch_channel ? `https://www.twitch.tv/${branding.twitch_channel}` : "https://www.twitch.tv/the_lion_squad_esports"} target="_blank" rel="noreferrer" data-testid="footer-twitch" aria-label="Twitch" className="w-9 h-9 inline-flex items-center justify-center border border-white/10 rounded-sm hover:border-[#9146FF] hover:text-[#9146FF] text-white/70 transition">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>
                </a>
              </div>
            </div>
            <div className="lg:col-span-2">
              <h4 className="font-heading font-bold text-white uppercase tracking-wider text-xs">Verein</h4>
              <ul className="mt-3 space-y-2 text-sm text-white/60">
                <li><Link to="/about" className="hover:text-[#29B6E8] transition">Über uns</Link></li>
                <li><Link to="/board" className="hover:text-[#29B6E8] transition">Vorstand</Link></li>
                <li><Link to="/values" className="hover:text-[#29B6E8] transition">Werte &amp; Ziele</Link></li>
                <li><Link to="/galerie" className="hover:text-[#29B6E8] transition">Galerie</Link></li>
              </ul>
            </div>
            <div className="lg:col-span-2">
              <h4 className="font-heading font-bold text-white uppercase tracking-wider text-xs">eSports</h4>
              <ul className="mt-3 space-y-2 text-sm text-white/60">
                <li><Link to="/tournaments" className="hover:text-[#29B6E8] transition">Turniere</Link></li>
                <li><Link to="/fastlap" className="hover:text-[#29B6E8] transition">Fast Lap</Link></li>
                <li><Link to="/events" className="hover:text-[#29B6E8] transition">Events</Link></li>
                <li><Link to="/teams" className="hover:text-[#29B6E8] transition">Teams</Link></li>
              </ul>
            </div>
            <div className="lg:col-span-2">
              <h4 className="font-heading font-bold text-white uppercase tracking-wider text-xs">Community</h4>
              <ul className="mt-3 space-y-2 text-sm text-white/60">
                <li><Link to="/members" className="hover:text-[#29B6E8] transition">Vereinsmitglieder</Link></li>
                <li><Link to="/players" className="hover:text-[#29B6E8] transition">Community-Spieler</Link></li>
                <li><Link to="/membership/join" className="hover:text-[#29B6E8] transition">Mitglied werden</Link></li>
                <li><Link to="/news" className="hover:text-[#29B6E8] transition">News</Link></li>
              </ul>
            </div>
            <div className="lg:col-span-2">
              <h4 className="font-heading font-bold text-white uppercase tracking-wider text-xs">Kontakt</h4>
              <ul className="mt-3 space-y-2 text-sm text-white/60">
                <li><Link to="/contact" className="hover:text-[#29B6E8] transition">Kontaktformular</Link></li>
                <li><Link to="/sponsors" className="hover:text-[#29B6E8] transition">Sponsoren</Link></li>
                <li><Link to="/partners" className="hover:text-[#29B6E8] transition">Partner</Link></li>
                <li><a href={branding?.discord_invite_url || "https://discord.com/invite/thelionsquadesports"} target="_blank" rel="noreferrer" className="hover:text-[#29B6E8] transition">Discord-Server</a></li>
              </ul>
            </div>
          </div>
        </div>
        {/* Reihe 2 — Bottom Bar */}
        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-white/40">
            <span>© {new Date().getFullYear()} {clubName} — {tagline}. Alle Rechte vorbehalten.</span>
            <div className="flex items-center gap-4">
              <Link to="/imprint" className="hover:text-[#29B6E8] transition" data-testid="footer-imprint">Impressum</Link>
              <Link to="/privacy" className="hover:text-[#29B6E8] transition" data-testid="footer-privacy">Datenschutz</Link>
              <span className="font-display tracking-widest hidden md:inline">v2.2</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
