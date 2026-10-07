/**
 * Die untere Leiste am Handy (#1143) - dieselben fünf Einträge wie die App: Home · Events · Community · Verein · Profil.
 * Für alle gleich, damit Hilfe am Telefon funktioniert („tipp unten auf Verein“). Angemeldet führt Home zum Dashboard
 * und Profil zum eigenen Profil; Gäste kommen über Profil zur Anmeldung. Die Zahl an Community zählt ungelesene Chats.
 * Ein Tipp auf den aktiven Eintrag (#1144) bringt zur Übersicht - steht man schon dort, ganz nach oben.
 */
import { Link, useLocation } from "react-router-dom";
import { Calendar, Home, LayoutDashboard, MessageSquare, Shield, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useUnreadChats } from "@/hooks/useChats";
import { badgeText } from "@/lib/chats";

/** Welche Adressen zu welchem Eintrag gehören - der Eintrag leuchtet auf allen seinen Seiten. */
export const BOTTOM_SECTIONS = {
  home: ["/", "/dashboard"],
  events: ["/events", "/tournaments", "/fastlap", "/f1", "/esports", "/matches", "/hub/matches", "/calendar", "/advent", "/ostern"],
  community: ["/community", "/messages", "/teams", "/players", "/achievements", "/seasons", "/servers"],
  verein: ["/verein", "/about", "/board", "/values", "/partners", "/sponsors", "/members", "/membership", "/galerie", "/references", "/news", "/contact", "/mitgliederbereich"],
  profile: ["/u/me", "/profile", "/account", "/my/", "/notifications", "/privacy-account"],
};

export function bottomNavItems(user) {
  return [
    { key: "home", to: user ? "/dashboard" : "/", label: "Home", icon: user ? LayoutDashboard : Home },
    { key: "events", to: "/events", label: "Events", icon: Calendar },
    { key: "community", to: "/community", label: "Community", icon: MessageSquare },
    { key: "verein", to: "/verein", label: "Verein", icon: Shield },
    { key: "profile", to: user ? "/u/me" : "/login", label: "Profil", icon: User },
  ];
}

/** Der Eintrag zu einer Adresse - genau einer oder keiner. Das eigene Profil gehört zu „Profil“, fremde zu „Community“. */
export function activeSection(pathname, username = "") {
  const path = pathname || "/";
  if (path === "/" || path === "/dashboard") return "home";
  if (path.startsWith("/u/")) return username && path.split("/")[2]?.toLowerCase() === username.toLowerCase() ? "profile" : path === "/u/me" ? "profile" : "community";
  for (const [key, prefixes] of Object.entries(BOTTOM_SECTIONS)) {
    if (key === "home") continue;
    if (prefixes.some((prefix) => (prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)))) return key;
  }
  return null;
}

const HIDDEN_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/setup",
  "/display/",
  "/admin",
];

export function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();
  const unread = useUnreadChats(user?.id);

  if (HIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;

  const items = bottomNavItems(user);
  const current = activeSection(location.pathname, user?.username);

  const onPress = (event, item) => {
    if (current !== item.key) return;
    // Schon auf der Übersicht: nicht neu laden, sondern ganz nach oben (#1144).
    const onOverview = location.pathname === item.to || (item.key === "profile" && user && location.pathname === `/u/${user.username}`);
    if (onOverview) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <nav
      className="tls-bottom-nav lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0A0A0A]/96 backdrop-blur-xl border-t border-white/10"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Mobile Navigation"
      data-testid="bottom-nav"
    >
      <div className="flex items-stretch justify-around h-16">
        {items.map((item) => {
          const active = current === item.key;
          const count = item.key === "community" ? unread : 0;
          return (
            <Link
              key={item.key}
              to={item.to}
              onClick={(event) => onPress(event, item)}
              aria-label={count ? `${item.label}, ${count} ungelesene Chats` : item.label}
              aria-current={active ? "page" : undefined}
              data-testid={`bottom-nav-${item.key}`}
              className={`relative flex flex-col items-center justify-center flex-1 gap-1 min-h-[44px] transition-colors ${
                active ? "text-[#29B6E8]" : "text-white/40 hover:text-white/70"
              }`}
            >
              {/* Aktiv-Indikator oben */}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#29B6E8] rounded-b-sm" />
              )}
              <span className="relative">
                <item.icon
                  className={`w-5 h-5 transition-transform ${active ? "scale-110" : ""}`}
                  strokeWidth={active ? 2.5 : 1.5}
                />
                {count ? (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FF3B30] text-white text-[9px] font-bold leading-4 text-center" data-testid="bottom-nav-community-count">
                    {badgeText(count)}
                  </span>
                ) : null}
              </span>
              <span
                className={`text-[9px] uppercase tracking-wider font-bold leading-none ${
                  active ? "text-[#29B6E8]" : ""
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
