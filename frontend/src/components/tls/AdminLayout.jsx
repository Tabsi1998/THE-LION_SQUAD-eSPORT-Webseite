import { hasArea, roleLabel } from "@/lib/permissions";
import { INTEGRATIONS, MENU_INTEGRATIONS } from "@/lib/integrations";
import { NavLink, useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { LayoutDashboard, Trophy, Gamepad2, Users as UsersIcon, CalendarDays, Flag, Building2, Newspaper, LogOut, ExternalLink, Menu, X, Code2, Star, Crown, Gift, Image as ImageIcon, Award, Inbox, UserCheck, Medal, FolderOpen, FileText, AlertTriangle, Handshake, BellRing, Search, Server, QrCode, Activity, MessagesSquare, ChevronDown, Sticker, Smartphone, Link2, Wallet, BookOpen, Mail, Palette, Share2, LogIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";

// Sidebar-Gruppen (#408, #512): Verein (Vereinsdaten, Vorstand, Sponsoren, Partner, Referenzen,
// Kontakt-Inbox), Mitglieder (mit Dolibarr - die Seite nennt sich Mitgliederverwaltung), Finanzen,
// eSports, Content (mit Downloads & QR), Verbindungen, System. Rechte bleiben je Eintrag wie vorher.
// Regel seit #512: Menüname = Seitentitel, jede Adresse genau einmal.
export const ADMIN_GROUPS = [
  {
    label: "Übersicht",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true, areas: ["tournaments", "content", "club", "system"] },
    ],
  },
  {
    label: "Verein",
    items: [
      // Vereinsdaten sind der Reiter „Rechtliches“ der Einstellungen (Stammdaten, Dolibarr-Schalter, Rechtstexte).
      { to: "/admin/club", label: "Vereinsdaten", icon: Building2, areas: ["system"] },
      // Über uns (#406): die Leitbild-Texte der Seite „Über den Verein“; Zahlen, Spiele, Vorstand kommen aus den Daten.
      { to: "/admin/about", label: "Über uns", icon: BookOpen, areas: ["content"] },
      { to: "/admin/board", label: "Vorstand", icon: UserCheck, areas: ["club"] },
      { to: "/admin/sponsors", label: "Sponsoren", icon: Star, areas: ["content"] },
      { to: "/admin/partners", label: "Partner", icon: Handshake, areas: ["content"] },
      { to: "/admin/references", label: "Referenzen", icon: Medal, areas: ["content"] },
      { to: "/admin/contact", label: "Kontakt-Inbox", icon: Inbox, areas: ["club"] },
    ],
  },
  {
    label: "Mitglieder",
    items: [
      { to: "/admin/members", label: "Mitglieder", icon: Crown, areas: ["club"] },
      { to: "/admin/member-profiles", label: "Mitgliederprofile", icon: UserCheck, areas: ["club"] },
      { to: "/admin/membership-applications", label: "Bewerbungen", icon: Inbox, areas: ["club"] },
      { to: "/admin/benefits", label: "Mitgliedervorteile", icon: Gift, areas: ["club"] },
      { to: "/admin/documents", label: "Dokumente", icon: FileText, areas: ["club"] },
      { to: "/admin/users", label: "Alle Benutzer", icon: UsersIcon, areas: ["club"] },
      // Dolibarr ist Mitgliederverwaltung, nicht Finanzen (#512) - die Rechnungen hängen nur mit dran.
      { to: "/admin/dolibarr", label: "Dolibarr", icon: Link2, areas: ["club", "system"] },
      // Die Dolibarr-Verbindung stand bis #546 in der Gruppe Verbindungen; jetzt ist sie ein Wegweiser wie die anderen Reiter.
      { to: "/admin/dolibarr?tab=connection", label: "Dolibarr: Verbindung", icon: Link2, areas: ["club", "system"], searchOnly: true },
      { to: "/admin/dolibarr?tab=features", label: "Dolibarr: Funktionen (Schalter)", icon: Link2, areas: ["club", "system"], searchOnly: true },
      { to: "/admin/dolibarr?tab=preview", label: "Dolibarr: Umstellung", icon: Link2, areas: ["club"], searchOnly: true },
      { to: "/admin/dolibarr?tab=links", label: "Dolibarr: Zuordnungen", icon: Link2, areas: ["club"], searchOnly: true },
      { to: "/admin/dolibarr?tab=policy", label: "Dolibarr: Bereiche (Vorstand → Rechte)", icon: Link2, areas: ["club", "system"], searchOnly: true },
    ],
  },
  {
    label: "Finanzen",
    items: [
      { to: "/admin/finance", label: "Finanzübersicht", icon: Wallet, areas: ["finance"] },
    ],
  },
  {
    label: "eSports",
    items: [
      { to: "/admin/tournaments", label: "Turniere", icon: Trophy, areas: ["tournaments", "moderation"], staff: true },
      { to: "/admin/tournament-guide", label: "Turnier-Leitfaden", icon: BookOpen, areas: ["tournaments"] },
      { to: "/admin/f1", label: "Fast Lap", icon: Flag, areas: ["tournaments", "moderation"], staff: true },
      { to: "/admin/seasons", label: "Jahreswertung", icon: Trophy, areas: ["tournaments"] },
      { to: "/admin/games", label: "Spiele", icon: Gamepad2, areas: ["tournaments"] },
      { to: "/admin/stations", label: "Stationen", icon: Building2, areas: ["tournaments", "moderation"], staff: true },
      { to: "/admin/game-servers", label: "Game-Server", icon: Server, areas: ["system"] },
      { to: "/admin/prizes", label: "Gewinne", icon: Award, areas: ["tournaments"] },
      { to: "/admin/penalties", label: "Strafen", icon: AlertTriangle, areas: ["tournaments"] },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/admin/events", label: "Events", icon: CalendarDays, areas: ["tournaments"] },
      { to: "/admin/news", label: "News", icon: Newspaper, areas: ["content"] },
      { to: "/admin/gallery", label: "Galerie", icon: ImageIcon, areas: ["content"] },
      { to: "/admin/media", label: "Medien", icon: FolderOpen, areas: ["content"] },
      { to: "/admin/nav", label: "Navigation", icon: Code2, areas: ["content"] },
      { to: "/admin/achievements", label: "Achievements", icon: Medal, areas: ["content"] },
      { to: "/admin/stickers", label: "Sticker", icon: Sticker, areas: ["content"] },
      { to: "/admin/downloads", label: "Downloads & QR", icon: QrCode, areas: ["tournaments", "content", "club", "system"] },
    ],
  },
  {
    // Wunsch des Vorstands (24.09., #546): Verbindungen sind Menüeinträge, keine Reiter - ganz oben die
    // Übersicht mit dem Zustand aller Verbindungen, darunter je Dienst eine Seite.
    label: "Verbindungen",
    items: [
      { to: "/admin/integrations", label: "Alle Verbindungen", icon: Link2, end: true, areas: ["system"] },
      ...MENU_INTEGRATIONS.map((integration) => ({ to: integration.tab || `/admin/integrations/${integration.key}`, label: integration.label, icon: Link2, platform: integration.app || null, areas: ["system"] })),
    ],
  },
  {
    label: "E-Mail",
    items: [
      { to: "/admin/settings/newsletter", label: "Newsletter", icon: Mail, areas: ["system"] },
      { to: "/admin/settings/mail-queue", label: "Mail-Queue", icon: Inbox, areas: ["system"] },
      { to: "/admin/email-templates", label: "E-Mail-Vorlagen", icon: FileText, areas: ["system"] },
    ],
  },
  {
    label: "Auftritt",
    items: [
      { to: "/admin/settings/branding", label: "Branding", icon: Palette, areas: ["system"] },
      { to: "/admin/settings/socials", label: "Socials", icon: Share2, areas: ["system"] },
      { to: "/admin/settings/seo", label: "SEO & Analytics", icon: Search, areas: ["system"] },
    ],
  },
  {
    label: "System",
    items: [
      // Betrieb & Logs (#517 Teil 2): Überblick, Ereignisse aller Quellen, Fehler, Tempo, Vitals, Checks, App-Logs, Alarme.
      { to: "/admin/ops", label: "Betrieb & Logs", icon: AlertTriangle, areas: ["system"] },
      { to: "/admin/settings/status", label: "Status", icon: Activity, areas: ["system"] },
      { to: "/admin/moderation", label: "Moderation", icon: MessagesSquare, areas: ["moderation"], staff: true },
      { to: "/admin/mobile-push", label: "Push-Tests", icon: BellRing, areas: ["system"] },
      { to: "/admin/app-releases", label: "App-Versionen", icon: Smartphone, areas: ["system"] },
      { to: "/admin/settings/zugang", label: "Zugang", icon: LogIn, areas: ["system"] },
      { to: "/admin/setup", label: "Einrichtung & FAQ", icon: BookOpen, areas: ["system"] },
    ],
  },
];

const ADMIN_SEARCH_TERMS = {
  "/admin/integrations": ["verbindungen", "alle verbindungen", "übersicht", "aktiv", "fehlt", "nicht lesbar", "schlüssel", "schluessel", "encryption", "settings_encryption_key", "verbindung weg"],
  "/admin": ["home", "start", "control"],
  "/admin/ops": ["fehler", "tempo", "langsam", "monitoring", "betrieb", "errors", "vitals", "checks", "ampel", "alarme", "logs", "ereignisse", "audit", "audit logs", "aktionen", "adminaktionen", "app-logs", "client-logs", "abstuerze", "abstürze", "versandlogs", "mail logs", "zugestellt", "bounce", "csv", "export", "aufbewahrung", "diagnose"],
  "/admin/app-releases": ["app", "apk", "release", "version", "update", "build", "lionsapp"],
  "/admin/members": ["verein", "mitgliedschaft", "beitrag", "verzeichnis", "einwilligung", "dolibarr", "mitgliedsnummer"],
  "/admin/moderation": ["moderation", "wortfilter", "sperre", "gesperrt", "meldungen", "gemeldet", "blockiert", "strikes", "chat"],
  "/admin/member-profiles": ["profile", "spielerprofile", "vereinsspieler"],
  "/admin/membership-applications": ["antraege", "beitritt", "join"],
  "/admin/benefits": ["vorteile", "rabatte"],
  "/admin/documents": ["dateien", "downloads"],
  "/admin/users": ["accounts", "rollen", "user"],
  "/admin/board": ["vorstand", "rollen"],
  "/admin/about": ["über uns", "verein", "leitbild", "werte", "texte", "about", "gruendung", "gründung", "zweck", "gemeinnuetzig", "gemeinnützig", "zahlen", "dolibarr"],
  "/admin/tournaments": ["bracket", "turnierbaum", "matches", "anmeldungen", "registrierungen"],
  "/admin/tournament-guide": ["leitfaden", "anleitung", "voreinstellung", "format", "check-in", "best of"],
  "/admin/f1": ["fastlap", "racing", "challenge", "challenges"],
  "/admin/seasons": ["wertung", "jahreswertung", "circuit", "saisons", "saison"],
  "/admin/games": ["spiele", "games"],
  "/admin/stations": ["geraete", "setup", "event"],
  "/admin/game-servers": ["server", "communityserver"],
  "/admin/prizes": ["preise", "gewinn", "gewinnabholung", "abholung"],
  "/admin/penalties": ["strafen", "fairplay"],
  "/admin/events": ["termine", "lan", "veranstaltungen"],
  "/admin/news": ["beitraege", "ankuendigungen"],
  "/admin/gallery": ["bilder", "fotos", "alben"],
  "/admin/media": ["uploads", "dateien", "bilder"],
  "/admin/email-templates": ["email", "e-mail", "vorlagen", "templates", "betreff", "mail-text", "testmail"],
  "/admin/nav": ["menue", "navigation"],
  "/admin/achievements": ["badges", "punkte", "level"],
  "/admin/stickers": ["chat", "emoji", "fluent"],
  "/admin/sponsors": ["unterstuetzer", "partner", "dolibarr", "kategorie", "stufe", "laufzeit", "ehemalige"],
  "/admin/partners": ["kooperationen", "netzwerk", "dolibarr", "kategorie"],
  "/admin/references": ["erfolge", "platzierungen", "results"],
  "/admin/contact": ["kontakt", "inbox", "nachrichten"],
  "/admin/downloads": ["downloads", "qr", "pdf", "stationen", "turnier qr", "fastlap qr", "embed", "anzeigen"],
  "/admin/mobile-push": ["push", "notifications", "app", "push-monitoring", "testnachricht"],
  "/admin/setup": ["einrichtung", "anleitung", "anleitungen", "setup", "einrichten", "discord app", "twitch app", "google login", "resend", "smtp", "analytics", "search console", "play store", "schritt für schritt", "howto", "how to"],
  "/admin/club": ["vereinsdaten", "impressum", "datenschutz", "zvr", "anschrift", "obmann", "dolibarr", "recht", "legal", "vereinsdaten aus dolibarr"],
  "/admin/settings/google": ["login", "anmeldung", "google", "google login", "oauth", "client id", "web-client-id"],
  "/admin/settings/zugang": ["zugang", "login", "anmeldung", "registrierung", "registrierung offen", "passwort login", "passkey", "passkeys", "fingerabdruck", "zwei-faktor", "2fa"],
  "/admin/settings/resend": ["resend", "absender", "api key", "mail", "e-mail", "versand"],
  "/admin/settings/smtp": ["smtp", "mailserver", "postausgang", "port", "tls"],
  "/admin/settings/newsletter": ["newsletter", "rundmail", "empfänger", "abo"],
  "/admin/settings/mail-queue": ["mail-queue", "warteschlange", "versand", "haengt", "hängt", "failed"],
  "/admin/settings/branding": ["branding", "logo", "favicon", "farbe", "akzentfarbe", "maskottchen", "banner", "share bild", "marke", "play store", "play-store-link"],
  "/admin/settings/socials": ["socials", "instagram", "tiktok", "youtube", "facebook", "whatsapp", "discord link", "social links", "x", "twitter", "threads", "bluesky", "mastodon", "telegram", "kick", "linkedin", "steam", "kanäle", "kanaele"],
  "/admin/settings/seo": ["seo", "google analytics", "measurement id", "plausible", "analytics", "indexnow", "sitemap", "suchmaschine", "bing", "site verification", "meta"],
  "/admin/settings/status": ["systemstatus", "status", "datenbank", "scheduler", "uploads", "mail-queue", "smtp test"],
  "/admin/dolibarr?tab=connection": ["dolibarr verbindung", "api schluessel", "api schlüssel", "modus", "vorschau", "live", "schreibzugriff", "rechnungen freigeben", "steuersaetze", "steuersätze", "konditionen", "webhook", "beitrittsantraege", "beitrittsanträge", "e-mail zuordnen", "erp"],
  "/admin/dolibarr?tab=preview": ["umstellung", "vorschau", "trockenlauf", "mitgliedsarten", "konten bestätigen", "ohne konto"],
  "/admin/dolibarr?tab=links": ["zuordnungen", "konto mitglied", "verknuepfung", "verknüpfung", "loesen", "lösen"],
  "/admin/dolibarr?tab=policy": ["bereiche", "bereich", "vorstand rechte", "freigabe", "vereinsverwaltung", "obmann", "kassier"],
  "/admin/dolibarr?tab=features": ["funktionen", "schalter", "aus dolibarr", "vereinsdaten aus dolibarr", "kanaele aus dolibarr", "sponsoren aus dolibarr", "beitrittsantraege", "verzeichnis", "einwilligung", "schreibzugriff"],
  "/admin/finance": ["finanzen", "rechnungen", "belege", "zahlungen", "prueffaelle", "erstattung", "auftraege"],
  "/admin/dolibarr": ["dolibarr", "erp", "anbindung", "mitgliederverwaltung", "schreibzugriff", "konditionen", "steuersaetze", "abgleich"],
};
for (const integration of INTEGRATIONS) {
  const path = integration.tab || `/admin/integrations/${integration.key}`;
  ADMIN_SEARCH_TERMS[path] = [...(ADMIN_SEARCH_TERMS[path] || []), integration.label.toLowerCase(), integration.key, "verbindung", "verknüpfen", "anleitung", "einrichten", "app", "client id", "secret", ...(integration.searchTerms || [])];
}

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

// Was jemand im Menü sieht: nur seine Bereiche (#287); Wegweiser-Einträge (searchOnly)
// nur, wenn die Suche sie trifft.
export function navGroupsFor(user, query, disabledPlatforms = []) {
  const searchQuery = normalizeSearch(query);
  // Abgehakte Plattformen (#558) fehlen im Menü - einschalten geht unter Alle Verbindungen.
  const off = new Set(Array.isArray(disabledPlatforms) ? disabledPlatforms : []);
  return ADMIN_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.platform && off.has(item.platform)) return false;
      const allowed = hasArea(user, ...(item.areas || [])) || (item.staff && Boolean(user?.is_tournament_staff));
      if (item.searchOnly && !searchQuery) return false;
      return allowed && itemMatchesQuery(item, group.label, searchQuery);
    }),
  })).filter((group) => group.items.length > 0);
}

// Moderatoren sehen nur diese Routen
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
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [openMobile, setOpenMobile] = useState(false);
  const [navQuery, setNavQuery] = useState("");
  const site = usePublicSiteSettings();
  const disabledPlatforms = site?.disabled_platforms;

  const searchQuery = normalizeSearch(navQuery);

  useEffect(() => {
    setNavQuery("");
  }, [location.pathname]);

  useEffect(() => {
    if (/@|https?:\/\//i.test(navQuery)) {
      setNavQuery("");
    }
  }, [navQuery]);

  // Rechte nach Bereichen (#287): ein Eintrag erscheint, wenn die Person einen
  // seiner Bereiche hat; die Seiten der Turnierleitung auch für zugewiesene
  // Helfer (staff). Wer nichts davon hat, sieht kein Menü.
  const visibleGroups = useMemo(() => navGroupsFor(user, navQuery, disabledPlatforms), [disabledPlatforms, navQuery, user]);

  const activeGroup = groupLabelForPath(location.pathname);
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    const stored = readCollapsedGroups();
    // Voreinstellung: alles offen. Eine Voreinstellung, die etwas wegräumt,
    // trifft genau die Leute, die das Zuklappen noch nicht kennen - und "wo
    // bin ich gerade" beantwortet ohnehin das Nachführen zum aktiven Eintrag.
    // Wer es kompakt will, klappt einmal zu; das wird gemerkt.
    return new Set(stored || []);
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
              <div className="text-[10px] text-[#29B6E8] uppercase tracking-widest">{roleLabel(user?.role)}</div>
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
        <main id="main-content" tabIndex={-1} className="p-4 md:p-8 max-w-[1800px]">{children}</main>
      </div>
    </div>
  );
}
