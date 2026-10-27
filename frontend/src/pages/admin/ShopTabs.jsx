import { NavLink } from "react-router-dom";

// Reiter des Shops unter Verwaltung → Finanzen → Shop (#1708): ein Menüeintrag, darin Einstellungen und Designs.
// Weitere Reiter (Produkte #1707, Testentwurf #2062) kommen hier dazu, ohne das Menü zu verlängern.
const TABS = [
  { to: "/admin/shop", label: "Einstellungen", end: true },
  { to: "/admin/shop/designs", label: "Designs" },
  { to: "/admin/shop/gamertag", label: "Gamertag" },
];

export default function ShopTabs() {
  return (
    <nav aria-label="Bereiche des Shops" className="mt-4 flex gap-1 border-b border-white/10" data-testid="shop-tabs">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}
          className={({ isActive }) => `min-h-10 px-4 inline-flex items-center text-xs font-bold uppercase tracking-wider border-b-2 -mb-px transition-colors duration-150 ${isActive ? "border-brand text-white" : "border-transparent text-white/55 hover:text-white"}`}
          data-testid={`shop-tab-${tab.label.toLowerCase()}`}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
