import { Link } from "react-router-dom";
import { FileLock, LogOut } from "lucide-react";
import { SETTINGS_GROUPS } from "./constants";

// Die Einstellungen (#1146): dieselben Gruppen in derselben Reihenfolge wie in der App. Am PC ein Seitenmenü links mit
// den Gruppen als kleine Überschriften, am Tablet und Handy eine waagrecht scrollbare Reihe - dieselben Knöpfe, nur
// anders angeordnet (#253). Unter „Konto“ stehen dazu „Meine Daten“ (Auskunft, Export, Löschen) und „Abmelden“.
export function ProfileNav({ tab, onSelect, onLogout }) {
  return (
    <nav
      aria-label="Einstellungen"
      data-testid="settings-nav"
      className="flex gap-2 overflow-x-auto pb-2 border-b border-white/10 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0 lg:border-b-0 lg:border-r lg:pr-6 lg:sticky lg:top-24 lg:self-start"
    >
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.key} className="contents lg:block lg:mb-3" data-testid={`settings-group-${group.key}`}>
          <div className="hidden lg:block px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.25em] text-white/40" data-testid="settings-group-title">{group.label}</div>
          {group.tabs.map((item) => {
            const active = tab === item.k;
            return (
              <button
                key={item.k}
                type="button"
                onClick={() => onSelect(item.k)}
                data-testid={`profile-tab-${item.k}`}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 min-h-11 rounded-sm border px-3 py-2 text-xs uppercase tracking-wider font-bold transition flex items-center gap-2 lg:w-full lg:justify-start lg:border-transparent lg:px-3 ${active ? "border-[#29B6E8]/55 bg-[#29B6E8]/10 text-[#29B6E8] lg:border-[#29B6E8]/55" : "border-white/10 bg-[#121212] text-white/55 hover:text-white hover:border-white/25 lg:bg-transparent"}`}
              >
                <item.icon className="w-3.5 h-3.5" /> {item.label}
              </button>
            );
          })}
          {group.key === "account" ? (
            <>
              <Link to="/privacy-account" data-testid="settings-data" className="shrink-0 min-h-11 rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-xs uppercase tracking-wider font-bold text-white/55 hover:text-white flex items-center gap-2 lg:w-full lg:border-transparent lg:bg-transparent">
                <FileLock className="w-3.5 h-3.5" /> Meine Daten
              </Link>
              {onLogout ? (
                <button type="button" onClick={onLogout} data-testid="settings-logout" className="shrink-0 min-h-11 rounded-sm border border-[#FF3B30]/30 bg-[#121212] px-3 py-2 text-xs uppercase tracking-wider font-bold text-[#FF3B30] hover:bg-[#FF3B30]/10 flex items-center gap-2 lg:w-full lg:border-transparent lg:bg-transparent">
                  <LogOut className="w-3.5 h-3.5" /> Abmelden
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
