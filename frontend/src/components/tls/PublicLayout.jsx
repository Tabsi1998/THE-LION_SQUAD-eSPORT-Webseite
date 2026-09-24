import { Link, useLocation, useNavigate } from "react-router-dom";
import { SOCIAL_ICONS, socialIconFor } from "@/lib/socialIcons";
import { ChannelIcon } from "@/components/tls/ChannelIcon";
import { useAuth } from "@/context/AuthContext";
import { userMenuEntries, userMenuTestId } from "@/pages/user/profile/constants";
import { useAccountBadges } from "@/hooks/useAccountBadges";
import { Logo } from "@/components/tls/Logo";
import { MainNav, MobileNav } from "@/components/tls/MainNav";
import { NotificationBell } from "@/components/tls/NotificationBell";
import { InvitationBanner } from "@/components/tls/InvitationBanner";
import { CrownCelebration } from "@/components/tls/CrownCelebration";
import { LevelUpCelebration } from "@/components/tls/LevelUpCelebration";
import { SponsorTicker } from "@/components/tls/SponsorTicker";
import { GlobalSearch } from "@/components/tls/GlobalSearch";
import { openCookieSettings } from "@/components/tls/CookieConsent";
import { api } from "@/lib/api";
import { getCachedBranding, onBrandingUpdated, setCachedBranding } from "@/lib/brandingEvents";
import { PLAY_BADGE_SRC, contactLines, footerButtons, footerColumns } from "@/lib/siteFooter";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Menu, X, LogOut, Shield, Crown, Megaphone, ArrowUp, MessageSquare, Smartphone } from "lucide-react";
import { UserMenu } from "@/components/tls/UserMenu";
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
  const mobileBadges = useAccountBadges(user?.id, mobileOpen);
  const closeMobile = () => setMobileOpen(false);
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const clubName = branding?.club_name || "THE LION SQUAD";
  const tagline = branding?.tagline || "eSports";
  const footerContact = contactLines(branding);
  const footerCta = footerButtons(branding);
  const twitchUrl = getTwitchUrl(branding?.twitch_channel);
  const socialLinks = getFooterSocialLinks(branding, twitchUrl);

  return (
    <div className="min-h-screen max-w-full overflow-x-clip bg-[#0A0A0A] text-white flex flex-col">
      <a href="#main-content" className="tls-skip-link">Zum Inhalt springen</a>
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0A0A0A]/80 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between gap-4">
          <Logo size="lg" />
          <MainNav isClubMember={isClubMember} />
          <div className="flex items-center gap-2">
            <GlobalSearch />
            {user ? (
              <>
                <NotificationBell />
                <Link
                  to="/messages"
                  data-testid="nav-messages"
                  aria-label="Nachrichten"
                  title="Nachrichten"
                  className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/80 border border-white/10 rounded-sm hover:border-[#29B6E8]/40 hover:text-[#29B6E8] transition"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </Link>
                {/* Benutzermenü statt sechs Knöpfen: Dashboard, Profil,
                    Nachrichten, Mitgliederbereich, Admin, Abmelden (#282).
                    Der blaue Admin-Knopf ist auf Wunsch des Betreibers weg. */}
                <UserMenu />
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
              aria-label={mobileOpen ? "Menü schließen" : "Menü öffnen"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div id="mobile-navigation" className="lg:hidden border-t border-white/10 bg-[#0A0A0A] max-h-[calc(100vh-4rem)] overflow-y-auto">
            <div className="px-4 py-4 flex flex-col gap-1">
              <MobileNav isClubMember={isClubMember} onClose={closeMobile} />
              <div className="border-t border-white/10 mt-3 pt-3 space-y-0.5">
                {user && isClubMember && (
                  <Link to="/members/area" onClick={closeMobile} data-testid="nav-member-area-mobile" className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#FFD700]">
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
                    {userMenuEntries({ username: user.username, isClubMember, badges: mobileBadges }).map((entry) => (
                      <Link key={entry.key} to={entry.to} onClick={closeMobile} data-testid={userMenuTestId(entry.key, "-mobile")} className="block px-3 py-2 text-sm font-semibold uppercase tracking-wider text-white/80">
                        <entry.icon className="w-3.5 h-3.5 inline mr-1.5" /> {entry.label}
                      </Link>
                    ))}
                    <button
                      type="button"
                      data-testid="nav-logout-mobile"
                      onClick={async () => {
                        if (await logout()) {
                          closeMobile();
                          nav("/");
                        }
                      }}
                      className="w-full text-left px-3 py-2 text-sm font-semibold uppercase tracking-wider text-[#FF3B30]"
                    >
                      <LogOut className="w-3.5 h-3.5 inline mr-1.5" /> Abmelden
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
      {/* Einladung zum Verein (#507): nur für angemeldete Konten, die noch nicht Mitglied sind. */}
      {user && !isClubMember ? <InvitationBanner pathname={location.pathname} /> : null}
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 max-w-full overflow-x-clip">{children}</main>
      <CrownCelebration />
      <LevelUpCelebration />
      <SiteBannerSlot banners={siteBanners} pathname={location.pathname} slot="above_footer" />
      <SiteBannerSlot banners={siteBanners} pathname={location.pathname} slot="bottom_fixed" />
      {/* Footer (#403, #431): Mitmach-Streifen mit Discord-Knopf und Play-Badge über den Sponsoren,
          Sponsoren-Streifen, drei Spalten mit den Hauptbereichen, Kontakt aus den Vereinsdaten,
          Bottom-Bar ohne Versionsnummer (die steht im Admin unter System). */}
      <footer className="border-t border-white/10 bg-[#0A0A0A] mt-24 min-w-0 max-w-full overflow-x-clip pb-16 lg:pb-0">
        <div className="border-b border-white/5 bg-[#0D0D0E]" data-testid="footer-cta">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Dabei sein</div>
              <div className="mt-1 text-sm text-white/65">Auf Discord ist das Rudel jeden Tag da — mit der LionsAPP hast du Termine, Turniere und Chat am Handy.</div>
            </div>
            {/* Knopfleiste (#425): Discord als offizieller Knopf, Google Play als offizieller Badge (erst mit Link). */}
            <div className="flex flex-wrap items-center gap-3 shrink-0" data-testid="footer-buttons">
              {footerCta.discord && (
                <a href={footerCta.discord} target="_blank" rel="noreferrer" data-testid="footer-discord-button" className="inline-flex items-center gap-2 rounded-md bg-[#5865F2] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#4752C4] transition">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={SOCIAL_ICONS.discord.path} /></svg> Discord beitreten
                </a>
              )}
              {footerCta.playStoreUrl ? (
                <a href={footerCta.playStoreUrl} target="_blank" rel="noreferrer" data-testid="footer-play-badge" className="inline-flex">
                  <img src={PLAY_BADGE_SRC} alt="Jetzt bei Google Play" className="h-11 w-auto" />
                </a>
              ) : (
                <span data-testid="footer-play-soon" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-4 py-2.5 text-sm text-white/55">
                  <Smartphone className="w-4 h-4" /> {footerCta.playSoonLabel}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <SponsorTicker compact placement="footer" className="pb-8 border-b border-white/5" />
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-8 min-w-0" data-testid="footer-columns">
            {footerColumns(branding, { isClubMember }).map((column) => (
              <nav key={column.key} aria-label={column.title} data-testid={`footer-column-${column.key}`} className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{column.title}</div>
                <ul className="mt-4 space-y-2 text-sm text-white/65">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a href={link.href} target="_blank" rel="noreferrer" className="hover:text-white transition">{link.label}</a>
                      ) : (
                        <Link to={link.to} className="hover:text-white transition">{link.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
            <div className="col-span-2 md:col-span-1 min-w-0" data-testid="footer-contact">
              <Logo size="lg" asLink={false} />
              {footerContact.any && (
                <address className="mt-4 not-italic text-sm text-white/65 space-y-1">
                  {footerContact.name && <div className="font-bold text-white/85">{footerContact.name}</div>}
                  {footerContact.address.map((line) => <div key={line}>{line}</div>)}
                  {footerContact.email && <div><a href={`mailto:${footerContact.email}`} className="hover:text-white transition">{footerContact.email}</a></div>}
                  {footerContact.zvr && <div className="text-white/45">{footerContact.zvr}</div>}
                </address>
              )}
              <div className="mt-4 flex flex-wrap gap-2" data-testid="footer-socials">
                {socialLinks.map((social, index) => (
                  <a key={`${social.platform}-${index}`} href={social.url} target="_blank" rel="noreferrer" data-testid={`footer-${social.platform}`} aria-label={social.label} title={social.label} className={`w-9 h-9 inline-flex items-center justify-center border border-white/10 rounded-sm text-white/70 transition ${social.hoverClass}`}>
                    <ChannelIcon kind={social.platform} className="w-4 h-4" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* Reihe 2 — Bottom Bar */}
        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-white/40 min-w-0">
            <span>© {new Date().getFullYear()} {clubName} — {tagline}. Alle Rechte vorbehalten.</span>
            <div className="flex flex-wrap items-center justify-center md:justify-end gap-4">
              <Link to="/imprint" className="hover:text-[#29B6E8] transition" data-testid="footer-imprint">Impressum</Link>
              <Link to="/privacy" className="hover:text-[#29B6E8] transition" data-testid="footer-privacy">Datenschutz</Link>
              <Link to="/terms" className="hover:text-[#29B6E8] transition">Nutzungsbedingungen</Link>
              <button type="button" onClick={openCookieSettings} className="hover:text-[#29B6E8] transition">Cookies</button>
            </div>
          </div>
        </div>
      </footer>
      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+8px)] lg:bottom-5 right-4 z-50 inline-flex h-11 w-11 items-center justify-center rounded-sm border border-[#29B6E8]/45 bg-[#0A0A0A]/90 text-[#29B6E8] shadow-[0_0_18px_rgba(41,182,232,0.22)] backdrop-blur transition hover:bg-[#29B6E8] hover:text-black"
          aria-label="Nach oben"
          title="Nach oben"
          data-testid="scroll-top-btn"
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
  if (scope === "tournaments") return path.startsWith("/esports") || path.startsWith("/tournaments") || path.startsWith("/tournament");
  if (scope === "fastlap") return path.startsWith("/esports") || path.startsWith("/fastlap") || path.startsWith("/f1");
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

function SiteBanner({ banner }) {
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
      const icon = socialIconFor(platform);
      return { color: icon.color, hoverClass: icon.hoverClass, ...social, platform, label: social.label || platform };
    });
}

function getTwitchUrl(value) {
  const fallback = "https://www.twitch.tv/the_lion_squad_esports";
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.twitch.tv/${raw.replace(/^@/, "")}`;
}
