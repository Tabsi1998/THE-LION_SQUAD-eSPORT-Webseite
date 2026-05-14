import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { MainNav, MobileNav } from "@/components/tls/MainNav";
import { NotificationBell } from "@/components/tls/NotificationBell";
import { SponsorTicker } from "@/components/tls/SponsorTicker";
import { openCookieSettings } from "@/components/tls/CookieConsent";
import { api } from "@/lib/api";
import { getCachedBranding, onBrandingUpdated, setCachedBranding } from "@/lib/brandingEvents";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Menu, X, User, LogOut, Shield, Crown, Megaphone, ArrowUp } from "lucide-react";
import { useCallback, useMemo, useState, useEffect } from "react";

export function PublicLayout({ children }) {
  const { user, logout, isAdmin, isClubMember } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [branding, setBranding] = useState(getCachedBranding());
  const [siteBanners, setSiteBanners] = useState([]);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const loadBranding = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/public");
      setCachedBranding(data || {});
      setBranding(data || {});
    } catch {}
  }, []);
  const loadSiteBanner = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/site-banners");
      setSiteBanners(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setSiteBanners([]);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onBrandingUpdated((next) => setBranding(next || {}));
    loadBranding();
    return unsubscribe;
  }, [loadBranding]);
  useApiInvalidation(loadBranding, ["settings", "branding"]);
  useEffect(() => { loadSiteBanner(); }, [loadSiteBanner, user?.id, isClubMember, isAdmin]);
  useApiInvalidation(loadSiteBanner, ["settings", "branding"]);
  useEffect(() => {
    const updateScrollTopVisibility = () => setShowScrollTop(window.scrollY > 520);
    updateScrollTopVisibility();
    window.addEventListener("scroll", updateScrollTopVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollTopVisibility);
  }, []);
  const nav = useNavigate();
  const closeMobile = () => setMobileOpen(false);
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const clubName = branding?.club_name || "THE LION SQUAD";
  const tagline = branding?.tagline || "eSports";
  const twitchUrl = getTwitchUrl(branding?.twitch_channel);
  const socialLinks = getFooterSocialLinks(branding, twitchUrl);

  return (
    <div className="min-h-screen max-w-full overflow-x-clip bg-[#0A0A0A] text-white flex flex-col">
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
                <NotificationBell />
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
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#FF3B30]/35 text-[#FF3B30] hover:bg-[#FF3B30]/10 transition rounded-sm text-xs font-bold uppercase tracking-wider"
                  aria-label="Logout"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Logout</span>
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
                  <>
                    <Link to="/dashboard" onClick={closeMobile} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-white/80">Mein Bereich</Link>
                    <button
                      type="button"
                      onClick={async () => { await logout(); closeMobile(); nav("/"); }}
                      className="w-full text-left px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#FF3B30]"
                    >
                      <LogOut className="w-3.5 h-3.5 inline mr-1.5" /> Logout
                    </button>
                  </>
                ) : (
                  <>
                    <Link to="/login" onClick={closeMobile} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-white/80">Login</Link>
                    <Link to="/register" onClick={closeMobile} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#29B6E8]">Registrieren</Link>
                  </>
                )}
              </div>
              <div className="mt-8">
                <SponsorTicker compact placement="footer" />
              </div>
            </div>
          </div>
        )}
      </header>
      <SiteBannerSlot banners={siteBanners} pathname={location.pathname} slot="below_nav" />
      <main className="flex-1 min-w-0 max-w-full overflow-x-clip">{children}</main>
      <SiteBannerSlot banners={siteBanners} pathname={location.pathname} slot="above_footer" />
      <SiteBannerSlot banners={siteBanners} pathname={location.pathname} slot="bottom_fixed" />
      <footer className="border-t border-white/10 bg-[#0A0A0A] mt-24 min-w-0 max-w-full overflow-x-clip">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <Logo size="lg" asLink={false} />
            <div className="flex flex-wrap gap-2 md:justify-end" data-testid="footer-socials">
              {socialLinks.map((social, index) => (
                <a key={`${social.platform}-${index}`} href={social.url} target="_blank" rel="noreferrer" data-testid={`footer-${social.platform}`} aria-label={social.label} title={social.label} className={`w-9 h-9 inline-flex items-center justify-center border border-white/10 rounded-sm text-white/70 transition ${social.hoverClass}`}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d={social.path} /></svg>
                </a>
              ))}
            </div>
          </div>
          <SponsorTicker compact placement="footer" className="mt-10 pt-8 border-t border-white/5" />
        </div>
        {/* Reihe 2 — Bottom Bar */}
        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-white/40 min-w-0">
            <span>© {new Date().getFullYear()} {clubName} — {tagline}. Alle Rechte vorbehalten.</span>
            <div className="flex flex-wrap items-center justify-center md:justify-end gap-4">
              <Link to="/imprint" className="hover:text-[#29B6E8] transition" data-testid="footer-imprint">Impressum</Link>
              <Link to="/privacy" className="hover:text-[#29B6E8] transition" data-testid="footer-privacy">Datenschutz</Link>
              <button type="button" onClick={openCookieSettings} className="hover:text-[#29B6E8] transition">Cookies</button>
              <span className="font-display tracking-widest hidden md:inline">v2.2</span>
            </div>
          </div>
        </div>
      </footer>
      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="md:hidden fixed bottom-5 right-4 z-50 inline-flex h-11 w-11 items-center justify-center rounded-sm border border-[#29B6E8]/45 bg-[#0A0A0A]/90 text-[#29B6E8] shadow-[0_0_18px_rgba(41,182,232,0.22)] backdrop-blur transition hover:bg-[#29B6E8] hover:text-black"
          aria-label="Nach oben"
          title="Nach oben"
          data-testid="mobile-scroll-top"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function bannerMatchesPath(banner, pathname) {
  const path = pathname || "/";
  const scope = banner?.scope || "all";
  if (scope === "all") return true;
  if (scope === "tournaments") return path.startsWith("/tournaments") || path.startsWith("/tournament");
  if (scope === "fastlap") return path.startsWith("/fastlap") || path.startsWith("/f1");
  if (scope === "events") return path.startsWith("/events") || path.startsWith("/event");
  if (scope === "news") return path.startsWith("/news");
  if (scope === "community") return ["/community", "/players", "/teams", "/servers"].some((prefix) => path.startsWith(prefix));
  if (scope === "servers") return path.startsWith("/servers");
  if (scope === "members") return ["/members", "/membership", "/about", "/board", "/values", "/references"].some((prefix) => path.startsWith(prefix));
  if (scope === "custom") {
    const custom = String(banner?.path || "").trim();
    if (!custom) return false;
    const normalized = custom.startsWith("/") ? custom : `/${custom}`;
    return path === normalized || path.startsWith(`${normalized.replace(/\/+$/, "")}/`);
  }
  return false;
}

function SiteBannerSlot({ banners, pathname, slot }) {
  const visible = useMemo(
    () => (banners || []).filter((banner) => (banner.position || "below_nav") === slot && bannerMatchesPath(banner, pathname)).slice(0, slot === "bottom_fixed" ? 1 : 3),
    [banners, pathname, slot],
  );
  useEffect(() => {
    visible.forEach((banner) => {
      const key = `tls-banner-seen:${banner.id}`;
      if (!banner.id || sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      api.post("/settings/site-banners/impression", { banner_id: banner.id }).catch(() => {});
    });
  }, [visible]);
  if (!visible.length) return null;
  return (
    <div className={slot === "bottom_fixed" ? "" : "space-y-0"}>
      {visible.map((banner) => <SiteBanner key={banner.id || banner.text} banner={banner} />)}
    </div>
  );
}

function SiteBanner({ banner, pathname, slot }) {
  if (!banner?.enabled || !banner?.text) return null;
  const position = banner.position || "below_nav";
  const tone = banner.tone || "info";
  const style = banner.style || "neon";
  const isTicker = (banner.mode || "ticker") === "ticker";
  const text = String(banner.text || "").trim();
  const repeated = `${text}  •  `;
  const content = repeated.repeat(8);
  const speed = bannerTickerDuration(text, banner.speed_seconds);
  const linkUrl = String(banner.link_url || "");
  const linkLabel = banner.link_label || "Mehr";
  const trackClick = () => {
    if (banner.id) api.post("/settings/site-banners/click", { banner_id: banner.id }).catch(() => {});
  };
  const link = linkUrl
    ? /^https?:\/\//i.test(linkUrl)
      ? <a href={linkUrl} target="_blank" rel="noreferrer" onClick={trackClick} className="tls-site-banner__link">{linkLabel}</a>
      : <Link to={linkUrl} onClick={trackClick} className="tls-site-banner__link">{linkLabel}</Link>
    : null;
  return (
    <div className={`tls-site-banner tls-site-banner--${tone} tls-site-banner--${style} tls-site-banner--pos-${position}`} style={{ "--tls-marquee-duration": `${speed}s` }}>
      <div className="tls-site-banner__inner">
        <Megaphone className="w-4 h-4 shrink-0" />
        <div className={`tls-site-banner__text ${isTicker ? "tls-site-banner__text--ticker" : ""}`}>
          {isTicker ? (
            <span className="tls-marquee-track" aria-label={text}>
              <span>{content}</span>
              <span aria-hidden="true">{content}</span>
            </span>
          ) : (
            <span>{text}</span>
          )}
        </div>
        {link}
      </div>
    </div>
  );
}

function bannerTickerDuration(text, configuredSpeed) {
  const saved = Number(configuredSpeed || 22);
  const automatic = Math.ceil(String(text || "").length / 3.6);
  return Math.max(8, Math.min(180, Math.max(saved, automatic)));
}

const SOCIAL_ICONS = {
  discord: {
    hoverClass: "hover:border-[#5865F2] hover:text-[#5865F2]",
    path: "M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42z",
  },
  whatsapp: {
    hoverClass: "hover:border-[#25D366] hover:text-[#25D366]",
    path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.224-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.06 12.06 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.413-.074-.124-.272-.198-.57-.347M12.051 21.8h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.437-9.884 9.889-9.884 2.64.001 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.886 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.946L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.398",
  },
  facebook: { hoverClass: "hover:border-[#1877F2] hover:text-[#1877F2]", path: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" },
  instagram: { hoverClass: "hover:border-[#E4405F] hover:text-[#E4405F]", path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" },
  tiktok: { hoverClass: "hover:border-[#69C9D0] hover:text-[#69C9D0]", path: "M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005.8 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1.84-.1z" },
  youtube: { hoverClass: "hover:border-[#FF0000] hover:text-[#FF0000]", path: "M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" },
  twitch: { hoverClass: "hover:border-[#9146FF] hover:text-[#9146FF]", path: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" },
  custom: { hoverClass: "hover:border-[#29B6E8] hover:text-[#29B6E8]", path: "M10.59 13.41a1.996 1.996 0 010-2.82l3.59-3.59a2 2 0 112.83 2.83l-1.24 1.24h2.67l.69-.69a4 4 0 00-5.66-5.66l-3.59 3.59a4 4 0 000 5.66 1 1 0 001.41-1.41zM13.41 10.59a1.996 1.996 0 010 2.82l-3.59 3.59a2 2 0 11-2.83-2.83l1.24-1.24H5.56l-.69.69a4 4 0 005.66 5.66l3.59-3.59a4 4 0 000-5.66 1 1 0 00-1.41 1.41z" },
};

const DEFAULT_SOCIAL_LINKS = [
  { platform: "discord", label: "Discord", url: "https://discord.com/invite/thelionsquadesports" },
  { platform: "whatsapp", label: "WhatsApp Kanal", url: "https://whatsapp.com/channel/0029VaaWufTGU3BNG6VOxo1I" },
  { platform: "facebook", label: "Facebook", url: "https://www.facebook.com/thelionsquadesports" },
  { platform: "instagram", label: "Instagram", url: "https://instagram.com/thelionsquadesports" },
  { platform: "tiktok", label: "TikTok", url: "https://www.tiktok.com/@thelionsquadesports" },
  { platform: "youtube", label: "YouTube", url: "https://www.youtube.com/@TheLionSquadeSports" },
  { platform: "twitch", label: "Twitch", url: "https://www.twitch.tv/the_lion_squad_esports" },
];

function getFooterSocialLinks(branding, twitchUrl) {
  const source = Array.isArray(branding?.social_links) && branding.social_links.length
    ? branding.social_links
    : DEFAULT_SOCIAL_LINKS.map((social) => ({
      ...social,
      url:
        social.platform === "discord" ? branding?.discord_invite_url || social.url :
        social.platform === "whatsapp" ? branding?.whatsapp_channel_url || social.url :
        social.platform === "facebook" ? branding?.facebook_url || social.url :
        social.platform === "instagram" ? branding?.instagram_url || social.url :
        social.platform === "tiktok" ? branding?.tiktok_url || social.url :
        social.platform === "youtube" ? branding?.youtube_url || social.url :
        social.platform === "twitch" ? twitchUrl :
        social.url,
    }));
  return source
    .filter((social) => social?.enabled !== false && social?.url)
    .map((social) => {
      const platform = String(social.platform || "custom").toLowerCase();
      const icon = SOCIAL_ICONS[platform] || SOCIAL_ICONS.custom;
      return { ...icon, ...social, platform, label: social.label || platform };
    });
}

function getTwitchUrl(value) {
  const fallback = "https://www.twitch.tv/the_lion_squad_esports";
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.twitch.tv/${raw.replace(/^@/, "")}`;
}
