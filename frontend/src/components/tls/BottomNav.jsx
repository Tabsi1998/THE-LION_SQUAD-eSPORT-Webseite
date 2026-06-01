/**
 * BottomNav — Mobile Bottom Navigation Bar (App-Style)
 * Zeigt sich nur auf kleinen Screens (< lg).
 * Gäste sehen: Home, Turniere, Events, News, Wertung
 * Eingeloggte User sehen: Dashboard, Turniere, Events, Wertung, Profil
 */
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Home, Trophy, Calendar, User, LayoutDashboard, Newspaper, Medal } from "lucide-react";

const GUEST_ITEMS = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/tournaments", label: "Turniere", icon: Trophy },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/seasons/current", label: "Wertung", icon: Medal },
];

const AUTH_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tournaments", label: "Turniere", icon: Trophy },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/seasons/current", label: "Wertung", icon: Medal },
  { to: "/profile", label: "Profil", icon: User },
];

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

  if (HIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;

  const items = user ? AUTH_ITEMS : GUEST_ITEMS;

  const isActive = (item) => {
    if (item.exact) return location.pathname === item.to;
    return location.pathname.startsWith(item.to);
  };

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0A0A0A]/96 backdrop-blur-xl border-t border-white/10"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Mobile Navigation"
    >
      <div className="flex items-stretch justify-around h-16">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center flex-1 gap-1 min-h-[44px] transition-colors ${
                active ? "text-[#29B6E8]" : "text-white/40 hover:text-white/70"
              }`}
            >
              {/* Aktiv-Indikator oben */}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#29B6E8] rounded-b-sm" />
              )}
              <item.icon
                className={`w-5 h-5 transition-transform ${active ? "scale-110" : ""}`}
                strokeWidth={active ? 2.5 : 1.5}
              />
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
