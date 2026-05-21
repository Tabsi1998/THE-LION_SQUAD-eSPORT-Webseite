/**
 * BottomNav — Mobile Bottom Navigation Bar (App-Style)
 * Zeigt sich nur auf kleinen Screens (< lg) und nur wenn der User eingeloggt ist.
 */
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Home, Trophy, Calendar, User, LayoutDashboard } from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/tournaments", label: "Turniere", icon: Trophy },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, requireAuth: true },
  { to: "/profile", label: "Profil", icon: User, requireAuth: true },
];

export function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();

  // Nicht auf Login/Register/Admin/Display-Seiten anzeigen
  const hiddenPaths = ["/login", "/register", "/forgot-password", "/reset-password", "/setup", "/display/"];
  if (hiddenPaths.some((p) => location.pathname.startsWith(p))) return null;
  if (location.pathname.startsWith("/admin")) return null;

  const isActive = (item) => {
    if (item.exact) return location.pathname === item.to;
    return location.pathname.startsWith(item.to);
  };

  const visibleItems = NAV_ITEMS.filter((item) => !item.requireAuth || user);

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0A0A0A]/95 backdrop-blur-xl border-t border-white/10 safe-area-pb"
      aria-label="Mobile Navigation"
    >
      <div className="flex items-stretch justify-around h-16">
        {visibleItems.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={`flex flex-col items-center justify-center flex-1 gap-1 min-h-[44px] transition-colors ${
                active
                  ? "text-[#29B6E8]"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              <item.icon
                className={`w-5 h-5 transition-transform ${active ? "scale-110" : ""}`}
                strokeWidth={active ? 2.5 : 1.5}
              />
              <span className={`text-[9px] uppercase tracking-wider font-bold leading-none ${active ? "text-[#29B6E8]" : ""}`}>
                {item.label}
              </span>
              {active && (
                <span className="absolute bottom-0 w-8 h-0.5 bg-[#29B6E8] rounded-t-sm" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
