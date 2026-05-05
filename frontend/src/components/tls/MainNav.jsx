/**
 * Phase D — Hauptnavigation für die TLS-Vereinsplattform.
 *
 * Strukturiert nach Vereinsidentität (nicht „Arena-only"):
 * Home / Verein / Community / Mitglieder / Events / eSports / Teams / Spieler / News / Sponsoren
 *
 * Desktop: Hover-Dropdowns mit Untertabs.
 * Mobile: Akkordeon (Sub-Items klappen auf Tap auf).
 */
import { useState, useRef, useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";

export const NAV_STRUCTURE = [
  { to: "/", label: "Home", end: true },
  {
    label: "Verein",
    children: [
      { to: "/about", label: "Über uns" },
      { to: "/board", label: "Vorstand" },
      { to: "/values", label: "Werte & Ziele" },
      { to: "/sponsors", label: "Sponsoren" },
      { to: "/galerie", label: "Galerie" },
    ],
  },
  { to: "/news", label: "News" },
  { to: "/events", label: "Events" },
  {
    label: "eSports",
    children: [
      { to: "/tournaments", label: "Turniere" },
      { to: "/fastlap", label: "Fast Lap" },
      { to: "/teams", label: "Teams" },
      { to: "/seasons/current", label: "Season Pass" },
    ],
  },
  {
    label: "Community",
    children: [
      { to: "/members", label: "Vereinsmitglieder" },
      { to: "/players", label: "Community-Spieler" },
      { to: "/membership/join", label: "Mitglied werden" },
    ],
  },
  { to: "/contact", label: "Kontakt" },
];

export const NAV_USER = [
  {
    label: "Mein Bereich",
    children: [
      { to: "/dashboard", label: "Übersicht" },
      { to: "/profile", label: "Profil & Einstellungen" },
      { to: "/profile?tab=teams", label: "Teamverwaltung" },
      { to: "/profile?tab=achievements", label: "Meine Achievements" },
      { to: "/u/me", label: "Mein öffentliches Profil" },
      { to: "/teams", label: "Teams entdecken", divider: true },
      { to: "/my/prizes", label: "Meine Gewinne" },
      { to: "/membership/apply", label: "Mitgliedschaft beantragen" },
      { to: "/members/area", label: "Mitgliederbereich", memberOnly: true, divider: true },
      { to: "/privacy-account", label: "Datenschutz / Daten", divider: true },
    ],
  },
];

// --- Desktop Dropdown ---
function NavDropdown({ item, isClubMember }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const loc = useLocation();
  const visibleChildren = item.children.filter((c) => !c.memberOnly || isClubMember);
  const isActive = visibleChildren.some((c) => loc.pathname === c.to.split("?")[0] || loc.pathname.startsWith(c.to.split("?")[0] + "/"));

  const onEnter = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const onLeave = () => { closeTimer.current = setTimeout(() => setOpen(false), 120); };

  return (
    <div className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        type="button"
        data-testid={`nav-${item.label.toLowerCase()}`}
        aria-expanded={open}
        className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider transition rounded-sm inline-flex items-center gap-1 ${
          isActive ? "text-[#29B6E8]" : "text-white/70 hover:text-white"
        }`}
      >
        {item.label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full pt-2 z-50 min-w-[220px]"
          data-testid={`nav-${item.label.toLowerCase()}-dropdown`}
        >
          <div className="border border-white/10 bg-[#0F0F10]/95 backdrop-blur-xl rounded-sm shadow-xl shadow-black/50 py-2">
            {visibleChildren.map((c, idx) => (
              <div key={c.to}>
                {c.divider && idx > 0 && <div className="my-1 mx-3 border-t border-white/10" />}
                <NavLink
                  to={c.to}
                  onClick={() => setOpen(false)}
                  data-testid={`nav-sub-${c.label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`}
                  className={({ isActive }) =>
                    `block px-4 py-2 text-sm transition ${
                      isActive ? "text-[#29B6E8] bg-[#29B6E8]/5" : "text-white/80 hover:text-[#29B6E8] hover:bg-white/5"
                    }`
                  }
                >
                  {c.label}
                </NavLink>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Mobile Accordion Item ---
function MobileAccordion({ item, isClubMember, onClose }) {
  const [open, setOpen] = useState(false);
  if (!item.children) {
    return (
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onClose}
        data-testid={`mobile-nav-${item.label.toLowerCase()}`}
        className={({ isActive }) =>
          `block px-3 py-2.5 text-sm font-semibold uppercase tracking-wider rounded-sm ${
            isActive ? "text-[#29B6E8] bg-[#29B6E8]/10" : "text-white/80"
          }`
        }
      >
        {item.label}
      </NavLink>
    );
  }
  const visibleChildren = item.children.filter((c) => !c.memberOnly || isClubMember);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={`mobile-nav-${item.label.toLowerCase()}`}
        aria-expanded={open}
        className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold uppercase tracking-wider rounded-sm text-white/80 hover:text-white`}
      >
        {item.label}
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="ml-3 border-l border-white/10 pl-2 mt-1 space-y-0.5">
          {visibleChildren.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              onClick={onClose}
              className={({ isActive }) =>
                `block px-3 py-2 text-xs uppercase tracking-wider transition ${
                  isActive ? "text-[#29B6E8]" : "text-white/65 hover:text-[#29B6E8]"
                }`
              }
            >
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function MainNav({ isClubMember = false }) {
  return (
    <nav className="hidden lg:flex items-center gap-0.5">
      {NAV_STRUCTURE.map((item) => (
        item.children ? (
          <NavDropdown key={item.label} item={item} isClubMember={isClubMember} />
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-testid={`nav-${item.label.toLowerCase()}`}
            className={({ isActive }) =>
              `px-4 py-2 text-sm font-semibold uppercase tracking-wider transition rounded-sm ${
                isActive ? "text-[#29B6E8]" : "text-white/70 hover:text-white"
              }`
            }
          >
            {item.label}
          </NavLink>
        )
      ))}
    </nav>
  );
}

export function MobileNav({ isClubMember = false, onClose }) {
  return (
    <div className="space-y-0.5">
      {NAV_STRUCTURE.map((item) => (
        <MobileAccordion key={item.to || item.label} item={item} isClubMember={isClubMember} onClose={onClose} />
      ))}
    </div>
  );
}
