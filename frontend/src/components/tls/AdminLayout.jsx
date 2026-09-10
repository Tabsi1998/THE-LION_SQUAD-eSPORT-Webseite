import { NavLink, useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import {
  LayoutDashboard, Trophy, Gamepad2, Users as UsersIcon,
  CalendarDays, Flag, Building2, Newspaper, LogOut,
  ExternalLink, Menu, X, Settings as SettingsIcon,
  ShieldCheck, Code2, Star, Crown, Gift, Image as ImageIcon,
  Award, Inbox, UserCheck, Medal,
  FolderOpen, FileText, AlertTriangle, Handshake, Bug, BellRing,
  Search, Server, QrCode, Activity, MessagesSquare, ChevronDown,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Sidebar-Gruppen für bessere Übersicht
const ADMIN_GROUPS = [
  {
    label: "Übersicht",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    ],
  },
  {
    label: "Mitglieder",
    items: [
      { to: "/admin/members", label: "Mitglieder", icon: Crown, clubOnly: true },
      { to: "/admin/member-profiles", label: "Mitgliederprofile", icon: UserCheck, clubOnly: true },
      { to: "/admin/membership-applications", label: "Bewerbungen", icon: Inbox, clubOnly: true },
      { to: "/admin/benefits", label: "Mitgliedervorteile", icon: Gift, clubOnly: true },
      { to: "/admin/documents", label: "Dokumente", icon: FileText, clubOnly: true },
      { to: "/admin/users", label: "Alle Benutzer", icon: UsersIcon, clubOnly: true },
      { to: "/admin/board", label: "Vorstand", icon: UserCheck, clubOnly: true },
    ],
  },
  {
    label: "eSports",
    items: [
      { to: "/admin/tournaments", label: "Turniere", icon: Trophy },
      { to: "/admin/f1", label: "Fast Lap", icon: Flag },
      { to: "/admin/seasons", label: "Saisons / Circuit", icon: Trophy },
      { to: "/admin/games", label: "Spiele", icon: Gamepad2 },
      { to: "/admin/stations", label: "Stationen", icon: Building2 },
      { to: "/admin/game-servers", label: "Game-Server", icon: Server, clubOnly: true },
      { to: "/admin/prizes", label: "Gewinne", icon: Award },
      { to: "/admin/penalties", label: "Strafen", icon: AlertTriangle },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/admin/events", label: "Events", icon: CalendarDays },
      { to: "/admin/news", label: "News", icon: Newspaper },
      { to: "/admin/gallery", label: "Galerie", icon: ImageIcon },
      { to: "/admin/media", label: "Medien", icon: FolderOpen },
      { to: "/admin/cms", label: "CMS-Seiten", icon: FileText },
      { to: "/admin/nav", label: "Navigation", icon: Code2 },
      { to: "/admin/achievements", label: "Achievements", icon: Medal },
    ],
  },
  {
    label: "Verein",
    items: [
      { to: "/admin/sponsors", label: "Sponsoren", icon: Star, clubOnly: true },
      { to: "/admin/partners", label: "Partner", icon: Handshake, clubOnly: true },
      { to: "/admin/references", label: "Referenzen", icon: Medal, clubOnly: true },
      { to: "/admin/contact", label: "Kontakt-Inbox", icon: Inbox, clubOnly: true },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/admin/downloads", label: "Downloads & QR", icon: QrCode },
      { to: "/admin/logs", label: "Logs", icon: Activity, clubOnly: true },
      { to: "/admin/audit", label: "Audit Logs", icon: ShieldCheck, clubOnly: true },
      { to: "/admin/moderation", label: "Moderation", icon: MessagesSquare },
      { to: "/admin/mobile-logs", label: "App-Logs", icon: Bug, clubOnly: true },
      { to: "/admin/mobile-push", label: "Push-Tests", icon: BellRing, clubOnly: true },
      { to: "/admin/settings", label: "Einstellungen", icon: SettingsIcon, clubOnly: true },
    ],
  },
];

const ADMIN_SEARCH_TERMS = {
  "/admin": ["home", "start", "control"],
  "/admin/members": ["verein", "mitgliedschaft", "beitrag"],
  "/admin/member-profiles": ["profile", "spielerprofile", "vereinsspieler"],
  "/admin/membership-applications": ["antraege", "beitritt", "join"],
  "/admin/benefits": ["vorteile", "rabatte"],
  "/admin/documents": ["dateien", "downloads"],
  "/admin/users": ["accounts", "rollen", "user"],
  "/admin/board": ["vorstand", "rollen"],
  "/admin/tournaments": ["bracket", "turnierbaum", "matches", "anmeldungen", "registrierungen"],
  "/admin/f1": ["fastlap", "racing", "challenge"],
  "/admin/seasons": ["wertung", "jahreswertung", "circuit"],
  "/admin/games": ["spiele", "games"],
  "/admin/stations": ["geraete", "setup", "event"],
  "/admin/game-servers": ["server", "communityserver"],
  "/admin/prizes": ["preise", "gewinn"],
  "/admin/penalties": ["strafen", "fairplay"],
  "/admin/events": ["termine", "lan", "veranstaltungen"],
  "/admin/news": ["beitraege", "ankuendigungen"],
  "/admin/gallery": ["bilder", "fotos", "alben"],
  "/admin/media": ["uploads", "dateien", "bilder"],
  "/admin/cms": ["seiten", "texte", "email"],
  "/admin/nav": ["menue", "navigation"],
  "/admin/achievements": ["badges", "punkte", "level"],
  "/admin/sponsors": ["unterstuetzer", "partner"],
  "/admin/partners": ["kooperationen", "netzwerk"],
  "/admin/references": ["erfolge", "platzierungen", "results"],
  "/admin/contact": ["kontakt", "inbox", "nachrichten"],
  "/admin/downloads": ["downloads", "qr", "pdf", "stationen", "turnier qr", "fastlap qr", "embed", "anzeigen"],
  "/admin/logs": ["logs", "monitoring", "upload", "mail", "app", "audit", "diagnose"],
  "/admin/audit": ["logs", "aktionen", "sicherheit"],
  "/admin/mobile-logs": ["app", "fehler", "client"],
  "/admin/mobile-push": ["push", "notifications", "app"],
  "/admin/settings": ["einstellungen", "system", "smtp", "branding", "resend", "mail", "queue", "discord", "twitch", "socials", "seo", "analytics", "indexnow", "recht", "legal"],
};

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/]/g, " ")
    .trim();
}

function itemMatchesQuery(item, groupLabel, query) {
  if (!query) return true;
  const haystack = normalizeSearch([
    groupLabel,
    item.label,
    item.to,
    ...(ADMIN_SEARCH_TERMS[item.to] || []),
  ].join(" "));
  return haystack.includes(query);
}

// Moderatoren sehen nur diese Routen
const MODERATOR_ROUTES = [
  "/admin/tournaments",
  "/admin/f1",
  "/admin/stations",
  "/admin/moderation",
];

// 34 Einträge ergaben eine 1689 Pixel hohe Liste, von der bei 1440x900 genau
// zwölf gleichzeitig sichtbar waren. Wer auf "Push-Tests" stand, sah im Menü
// nicht, wo er ist: die Liste blieb oben stehen. Gruppen lassen sich deshalb
// zuklappen, und die Gruppe der aktuellen Seite geht beim Navigieren auf.
const NAV_GROUPS_STORAGE_KEY = "tls_admin_nav_collapsed_v1";

function readCollapsedGroups() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY));
    return Array.isArray(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeCollapsedGroups(labels) {
  try {
    window.localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // Privates Fenster oder gesperrter Speicher: dann wird es eben nicht gemerkt.
  }
}

// Der längste passende Eintrag gewinnt, damit "/admin" nicht jede Unterseite
// für sich beansprucht.
function groupLabelForPath(pathname) {
  let best = null;
  for (const group of ADMIN_GROUPS) {
    for (const item of group.items) {
      const hit = pathname === item.to || (!item.end && pathname.startsWith(`${item.to}/`));
      if (hit && (!best || item.to.length > best.route.length)) {
        best = { route: item.to, label: group.label };
      }
    }
  }
  return best ? best.label : null;
}

export function AdminLayout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [openMobile, setOpenMobile] = useState(false);
  const [navQuery, setNavQuery] = useState("");

  const searchQuery = normalizeSearch(navQuery);

  useEffect(() => {
    setNavQuery("");
  }, [location.pathname]);

  useEffect(() => {
    if (/@|https?:\/\//i.test(navQuery)) {
      setNavQuery("");
    }
  }, [navQuery]);

  const visibleGroups = useMemo(() => {
    const roleGroups = isAdmin
      ? ADMIN_GROUPS
      : ADMIN_GROUPS.map((group) => ({
          ...group,
          items: group.items.filter((it) => MODERATOR_ROUTES.includes(it.to)),
        })).filter((group) => group.items.length > 0);
    const canSeeClub = ["club_admin", "superadmin"].includes(user?.role);
    return roleGroups.map((group) => ({
      ...group,
      items: group.items.filter((item) => (!item.clubOnly || canSeeClub) && itemMatchesQuery(item, group.label, searchQuery)),
    })).filter((group) => group.items.length > 0);
  }, [isAdmin, searchQuery, user?.role]);

  const activeGroup = groupLabelForPath(location.pathname);
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    const stored = readCollapsedGroups();
    if (stored) return new Set(stored);
    // Beim ersten Mal ist nur die Gruppe offen, in der man gerade steht.
    const current = groupLabelForPath(location.pathname);
    return new Set(ADMIN_GROUPS.map((group) => group.label).filter((label) => label !== current));
  });

  const toggleGroup = useCallback((label) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      writeCollapsedGroups([...next]);
      return next;
    });
  }, []);

  // Beim Seitenwechsel geht die zugehörige Gruppe auf. Zuklappen darf man sie
  // danach wieder - beim nächsten Wechsel dorthin steht sie erneut offen.
  useEffect(() => {
    if (!activeGroup) return;
    setCollapsedGroups((current) => {
      if (!current.has(activeGroup)) return current;
      const next = new Set(current);
      next.delete(activeGroup);
      writeCollapsedGroups([...next]);
      return next;
    });
  }, [activeGroup]);

  // Während einer Suche sind alle Treffer offen, sonst zählt der gemerkte Zustand.
  const groupIsOpen = (label) => Boolean(searchQuery) || !collapsedGroups.has(label);

  // Ohne das blieb die Liste beim Seitenwechsel oben stehen: man war auf
  // "Push-Tests" und sah im Menü nur die Gruppe "Übersicht".
  const navRef = useRef(null);
  useEffect(() => {
    navRef.current?.querySelector("[aria-current='page']")?.scrollIntoView({ block: "nearest" });
  }, [location.pathname, collapsedGroups, searchQuery]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex">
      <a href="#main-content" className="tls-skip-link">Zum Inhalt springen</a>
      {/* Sidebar */}
      <aside className={`fixed md:sticky top-0 left-0 h-screen w-64 bg-[#0A0A0A] border-r border-white/10 z-40 transform transition-transform flex flex-col ${openMobile ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <Logo size="sm" />
          <button className="md:hidden p-1" onClick={() => setOpenMobile(false)} aria-label="Admin-Menü schließen">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 border-b border-white/10">
          <label className="relative block">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              type="search"
              name="tls-admin-navigation-search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Admin suchen..."
              className="w-full h-10 rounded-sm border border-white/10 bg-black/30 pl-9 pr-9 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#29B6E8]/70"
              data-testid="admin-nav-search"
            />
            {navQuery && (
              <button
                type="button"
                onClick={() => setNavQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/35 hover:text-white"
                aria-label="Suche leeren"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
        </div>

        <nav ref={navRef} className="flex-1 overflow-y-auto p-3 admin-scroll">
          {visibleGroups.map((group) => {
            const open = groupIsOpen(group.label);
            return (
              <div key={group.label} className="mb-3">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={open}
                  data-testid={`admin-nav-group-${group.label}`}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-white/25 hover:text-white/60 transition-colors"
                >
                  <span className="truncate">{group.label}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {!open && <span className="tabular-nums tracking-normal text-white/20">{group.items.length}</span>}
                    {group.label === activeGroup && !open && <span className="w-1.5 h-1.5 rounded-full bg-[#29B6E8]" />}
                    <ChevronDown className={`w-3 h-3 transition-transform ${open ? "" : "-rotate-90"}`} />
                  </span>
                </button>
                {open && (
                  <div className="space-y-0.5">
                    {group.items.map((it) => (
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
                        <it.icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{it.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {visibleGroups.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-white/40">
              <div>Keine Admin-Seite gefunden.</div>
              <button
                type="button"
                onClick={() => setNavQuery("")}
                className="mt-3 rounded-sm border border-[#29B6E8]/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#29B6E8] hover:bg-[#29B6E8]/10"
              >
                Suche leeren
              </button>
            </div>
          )}
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
            <div className="text-xs min-w-0">
              <div className="text-white font-semibold truncate max-w-[130px]">{user?.display_name || user?.username}</div>
              <div className="text-[10px] text-[#29B6E8] uppercase tracking-widest">{user?.role}</div>
            </div>
            <button
              onClick={async () => { if (await logout()) nav("/"); }}
              data-testid="admin-logout"
              className="inline-flex items-center gap-1.5 px-2 py-2 text-[#FF3B30] border border-[#FF3B30]/30 hover:bg-[#FF3B30]/10 rounded-sm text-[10px] font-bold uppercase tracking-wider shrink-0"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
        <style>{`.admin-scroll::-webkit-scrollbar{width:4px}.admin-scroll::-webkit-scrollbar-track{background:transparent}.admin-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}.admin-scroll::-webkit-scrollbar-thumb:hover{background:rgba(41,182,232,0.4)}`}</style>
      </aside>

      {/* Mobile overlay */}
      {openMobile && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-30"
          onClick={() => setOpenMobile(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-30 bg-[#0A0A0A] border-b border-white/10 p-3 flex items-center justify-between">
          <button onClick={() => setOpenMobile(true)} className="p-2" data-testid="admin-menu-open" aria-label="Admin-Menü öffnen" aria-expanded={openMobile}>
            <Menu className="w-5 h-5" />
          </button>
          <Logo size="sm" />
          <div className="w-9" />
        </div>
        <main id="main-content" tabIndex={-1} className="p-4 md:p-8 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
