import { NavLink } from "react-router-dom";

// Reiter des Shops unter Verwaltung → Finanzen → Shop (#1708): ein Menüeintrag, darin Einstellungen, Produkte (#1707),
// Motive (#2069, vorher „Designs“; die Adresse bleibt), Gamertag (#1711) und Testentwurf an Printful (#2062) - ohne das
// Menü zu verlängern. Auf dem Handy scrollen die Reiter in ihrer Leiste seitlich; die Seite selbst bleibt schmal.
const TABS = [
  { to: "/admin/shop", label: "Einstellungen", end: true },
  { to: "/admin/shop/products", label: "Produkte" },
  { to: "/admin/shop/designs", label: "Motive" },
  { to: "/admin/shop/gamertag", label: "Gamertag" },
  { to: "/admin/shop/test-draft", label: "Testentwurf" },
];

export default function ShopTabs() {
  return (
    <nav aria-label="Bereiche des Shops" className="tls-swipe pb-0 mt-4 flex gap-1 border-b border-white/10 max-w-full" data-testid="shop-tabs">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}
          className={({ isActive }) => `min-h-10 px-3 sm:px-4 shrink-0 whitespace-nowrap inline-flex items-center text-xs font-bold uppercase tracking-wider border-b-2 transition-colors duration-150 ${isActive ? "border-brand text-white" : "border-transparent text-white/55 hover:text-white"}`}
          data-testid={`shop-tab-${tab.label.toLowerCase()}`}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
