import { TABS } from "./constants";

// Am PC ein Seitenmenü links, am Tablet und Handy eine waagrecht scrollbare
// Reihe - dieselben Knöpfe, nur anders angeordnet (#253). Ein einziges
// Element, damit jeder Reiter genau einmal im Dokument steht. `badges` hängt
// an einen Reiter einen Zähler („Freunde (6)“) und einen Punkt für Offenes
// (#259). Die Konto-Seiten (Mitgliedschaft, Strafen, Gewinne, Hilfe) stehen seit #516 nur noch im
// Benutzermenü - hier gab es sie doppelt.
export function ProfileNav({ tab, onSelect, badges = {} }) {
  return (
    <nav
      aria-label="Profilbereiche"
      className="flex gap-2 overflow-x-auto pb-2 border-b border-white/10 lg:flex-col lg:overflow-visible lg:pb-0 lg:border-b-0 lg:border-r lg:pr-6 lg:sticky lg:top-24 lg:self-start"
    >
      {TABS.map((item) => {
        const active = tab === item.k;
        const badge = badges[item.k] || {};
        const label = typeof badge.count === "number" ? `${item.label} (${badge.count})` : item.label;
        return (
          <button
            key={item.k}
            type="button"
            onClick={() => onSelect(item.k)}
            data-testid={`profile-tab-${item.k}`}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 min-h-11 rounded-sm border px-3 py-2 text-xs uppercase tracking-wider font-bold transition flex items-center gap-2 lg:w-full lg:justify-start lg:border-transparent lg:px-3 ${active ? "border-[#29B6E8]/55 bg-[#29B6E8]/10 text-[#29B6E8] lg:border-[#29B6E8]/55" : "border-white/10 bg-[#121212] text-white/55 hover:text-white hover:border-white/25 lg:bg-transparent"}`}
          >
            <item.icon className="w-3.5 h-3.5" /> {label}
            {badge.alert ? <span className="ml-auto w-2 h-2 rounded-full bg-[#FFD700] shrink-0" aria-label="Offene Anfragen" data-testid={`profile-tab-${item.k}-alert`} /> : null}
          </button>
        );
      })}
    </nav>
  );
}
