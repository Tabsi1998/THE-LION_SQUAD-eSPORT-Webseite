/**
 * Phase D — Hauptnavigation für die TLS-Vereinsplattform. Seit #1143 stehen Chats, Jahreswertung und Erfolge unter
 * „Community“ - wie der Tab in der App.
 *
 * Strukturiert nach Vereinsidentität (nicht „Arena-only"):
 * Home / Verein / Community / Mitglieder / Events / eSports / Teams / Spieler / News / Sponsoren
 *
 * Desktop: Hover-Dropdowns mit Untertabs.
 * Mobile: Akkordeon (Sub-Items klappen auf Tap auf).
 */
import { useCallback, useState, useRef, useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

export const NAV_STRUCTURE = [
  { to: "/", label: "Home", end: true },
  { to: "/news", label: "News" },
  { to: "/events", label: "Events" },
  { to: "/calendar", label: "Kalender" },
  {
    label: "Verein",
    children: [
      { to: "/about", label: "Über uns" },
      { to: "/board", label: "Vorstand" },
      { to: "/partners", label: "Partner" },
      { to: "/sponsors", label: "Sponsoren" },
      { to: "/members", label: "Vereinsmitglieder" },
      { to: "/membership/join", label: "Mitglied werden" },
      { to: "/galerie", label: "Galerie" },
      { to: "/references", label: "Referenzen" },
    ],
  },
  {
    to: "/esports",
    label: "eSports",
    children: [
      { to: "/esports", label: "Übersicht" },
      { to: "/tournaments", label: "Turniere" },
      { to: "/fastlap", label: "Fast Lap" },
    ],
  },
  // Community (#1143): dieselbe Gruppe wie der Tab in der App - Chats (mit Konto), Teams, Spieler und die Bestenlisten
  // Jahreswertung und Erfolge (ein Name: „Erfolge“, nicht „Achievements“).
  {
    label: "Community",
    children: [
      { to: "/community", label: "Übersicht" },
      { to: "/messages", label: "Chats", authOnly: true },
      { to: "/servers", label: "Server" },
      { to: "/players", label: "Community-Spieler" },
      { to: "/teams", label: "Teams" },
      { to: "/seasons/current", label: "Jahreswertung" },
      { to: "/achievements", label: "Erfolge" },
    ],
  },
  { to: "/contact", label: "Kontakt" },
];

function navTestId(label) {
  return label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// v3 (#1143): Jahreswertung und Erfolge stehen unter Community - ein altes Menü aus dem Browser zählt nicht mehr.
const NAV_CACHE_KEY = "tls-public-nav-v3";

const GERMAN_NAV_LABELS = {
  ["Ue" + "bersicht"]: "Übersicht",
  ["ue" + "bersicht"]: "Übersicht",
  ["Ue" + "ber uns"]: "Über uns",
  ["ue" + "ber uns"]: "Über uns",
};

function normalizeGermanNavLabel(label) {
  return typeof label === "string" ? (GERMAN_NAV_LABELS[label] || label) : label;
}

function normalizeNavItems(items) {
  if (!Array.isArray(items) || !items.length) return NAV_STRUCTURE;
  return [...items]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item) => ({
      ...item,
      label: normalizeGermanNavLabel(item.label),
      children: item.children?.length
        ? [...item.children].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((child) => ({ ...child, label: normalizeGermanNavLabel(child.label) }))
        : item.children,
    }));
}

function cachedNavItems() {
  if (typeof window === "undefined") return NAV_STRUCTURE;
  try {
    return normalizeNavItems(JSON.parse(window.localStorage.getItem(NAV_CACHE_KEY) || "null"));
  } catch {
    return NAV_STRUCTURE;
  }
}

/** Was jemand sieht: Mitglieder-Einträge nur für Mitglieder, Einträge mit Konto (Chats) nur angemeldet. */
export function visibleNavChildren(item, { isClubMember = false, signedIn = false } = {}) {
  return (item.children || []).filter((c) => (!c.memberOnly || isClubMember) && (!(c.authOnly || c.auth_only) || signedIn));
}

// --- Desktop Dropdown ---
function NavDropdown({ item, isClubMember, signedIn, badge = 0 }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const loc = useLocation();
  const visibleChildren = visibleNavChildren(item, { isClubMember, signedIn });
  const ownPath = item.to?.split("?")[0];
  const isOwnActive = ownPath && (loc.pathname === ownPath || loc.pathname.startsWith(ownPath + "/"));
  const isActive = isOwnActive || visibleChildren.some((c) => loc.pathname === c.to.split("?")[0] || loc.pathname.startsWith(c.to.split("?")[0] + "/"));

  const onEnter = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const onLeave = () => { closeTimer.current = setTimeout(() => setOpen(false), 120); };

  return (
    <div className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {item.to ? (
        <Link
          to={item.to}
          data-testid={`nav-${item.label.toLowerCase()}`}
          aria-expanded={open}
          data-active={isActive ? "1" : "0"}
          className={`tls-nav-link px-4 py-2 text-sm font-semibold uppercase tracking-wider transition rounded-sm inline-flex items-center gap-1.5 ${
            isActive ? "text-[#29B6E8]" : "text-white/70 hover:text-white"
          }`}
        >
          <span>{item.label}</span>
          {badge ? <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#FF3B30] text-white text-[9px] leading-4 text-center" data-testid={`nav-${item.label.toLowerCase()}-count`} aria-label={`${badge} ungelesene Chats`}>{badge > 99 ? "99+" : badge}</span> : null}
          <ChevronDown data-testid={`nav-${item.label.toLowerCase()}-chevron`} className={`w-3.5 h-3.5 shrink-0 opacity-80 transition-transform ${open ? "rotate-180" : ""}`} />
        </Link>
      ) : (
        <button
          type="button"
          data-testid={`nav-${item.label.toLowerCase()}`}
          aria-expanded={open}
          data-active={isActive ? "1" : "0"}
          className={`tls-nav-link px-4 py-2 text-sm font-semibold uppercase tracking-wider transition rounded-sm inline-flex items-center gap-1.5 ${
            isActive ? "text-[#29B6E8]" : "text-white/70 hover:text-white"
          }`}
        >
          <span>{item.label}</span>
          {badge ? <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#FF3B30] text-white text-[9px] leading-4 text-center" data-testid={`nav-${item.label.toLowerCase()}-count`} aria-label={`${badge} ungelesene Chats`}>{badge > 99 ? "99+" : badge}</span> : null}
          <ChevronDown data-testid={`nav-${item.label.toLowerCase()}-chevron`} className={`w-3.5 h-3.5 shrink-0 opacity-80 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {open && (
        <div
          className="absolute left-0 top-full pt-2 z-[80] min-w-[220px]"
          data-testid={`nav-${item.label.toLowerCase()}-dropdown`}
        >
          <div className="border border-white/10 bg-[#0A0A0A] rounded-sm shadow-2xl shadow-black/80 py-2">
            {visibleChildren.map((c, idx) => (
              <div key={c.to}>
                {c.divider && idx > 0 && <div className="my-1 mx-3 border-t border-white/10" />}
                <NavLink
                  to={c.to}
                  onClick={() => setOpen(false)}
                  data-testid={`nav-sub-${navTestId(c.label)}`}
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
function MobileAccordion({ item, isClubMember, signedIn, onClose }) {
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
  const visibleChildren = visibleNavChildren(item, { isClubMember, signedIn });
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
        <ChevronDown data-testid={`mobile-nav-${item.label.toLowerCase()}-chevron`} className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="ml-3 border-l border-white/10 pl-2 mt-1 space-y-0.5">
          {visibleChildren.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              onClick={onClose}
              data-testid={`mobile-nav-sub-${navTestId(c.label)}`}
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

function usePublicNavItems() {
  const [items, setItems] = useState(cachedNavItems);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/nav");
      const next = Array.isArray(data?.items) ? data.items : data;
      const normalized = normalizeNavItems(next);
      setItems(normalized);
      try {
        window.localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(normalized));
      } catch {}
    } catch {
      setItems(cachedNavItems());
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["nav"]);

  return items;
}

export function MainNav({ isClubMember = false, signedIn = false, badges = {} }) {
  const items = usePublicNavItems();
  return (
    <nav className="hidden lg:flex items-center gap-0.5">
      {items.map((item) => (
        item.children?.length ? (
          <NavDropdown key={item.label} item={item} isClubMember={isClubMember} signedIn={signedIn} badge={item.label === "Community" ? Number(badges.community || 0) : 0} />
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-testid={`nav-${item.label.toLowerCase()}`}
            className={({ isActive }) =>
              `tls-nav-link px-4 py-2 text-sm font-semibold uppercase tracking-wider transition rounded-sm ${
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

export function MobileNav({ isClubMember = false, signedIn = false, onClose }) {
  const items = usePublicNavItems();
  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <MobileAccordion key={item.to || item.label} item={item} isClubMember={isClubMember} signedIn={signedIn} onClose={onClose} />
      ))}
    </div>
  );
}
