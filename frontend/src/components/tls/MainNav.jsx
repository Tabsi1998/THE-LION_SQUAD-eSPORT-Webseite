/**
 * Phase D — Hauptnavigation für die TLS-Vereinsplattform. Seit #1143 stehen Chats, Jahreswertung und Erfolge unter
 * „Community“ - wie der Tab in der App.
 *
 * Strukturiert nach Vereinsidentität (nicht „Arena-only"):
 * Home / Verein / Community / Mitglieder / Events / eSports / Teams / Spieler / News / Sponsoren
 *
 * Desktop: Untermenüs - Maus per Drüberfahren, Touch per Antippen, Tastatur per Enter/Leertaste/Pfeilen (#1233).
 * Mobile: Akkordeon (Sub-Items klappen auf Tap auf).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
/**
 * Die Einträge eines Untermenüs (#1233). Führt der Hauptpunkt selbst zu einer Seite und steht die nicht schon darin,
 * kommt sie als „Übersicht …“ ganz nach oben - am Tablet öffnet das Antippen des Hauptpunkts jetzt das Untermenü, die
 * Seite dahinter bleibt so erreichbar.
 */
export function dropdownEntries(item, visibleChildren) {
  const own = item.to?.split("?")[0];
  if (!own || visibleChildren.some((c) => c.to.split("?")[0] === own)) return visibleChildren;
  return [{ to: item.to, label: `Übersicht ${item.label}` }, ...visibleChildren];
}

const TOUCH_POINTERS = new Set(["touch", "pen"]);

/**
 * Hauptpunkt mit Untermenü (#1233). Maus: Drüberfahren öffnet, ein Klick auf den Hauptpunkt öffnet seine Seite - wie
 * bisher. Touch: das erste Antippen öffnet das Untermenü, ein zweites schließt es, ein Tipp daneben auch; erst ein
 * Eintrag öffnet eine Seite. Unterschieden wird nach der Art der Eingabe (pointerType), nicht nach der Breite.
 * Tastatur: Enter, Leertaste oder Pfeil nach unten öffnen und setzen den Fokus auf den ersten Eintrag (Pfeil nach oben:
 * den letzten), die Pfeile, Pos1 und Ende wandern, Escape schließt und gibt den Fokus an den Hauptpunkt zurück, wer
 * mit Tab hinausgeht, schließt es.
 */
function NavDropdown({ item, isClubMember, signedIn, badge = 0 }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const boxRef = useRef(null);
  const triggerRef = useRef(null);
  // Womit der Hauptpunkt zuletzt gedrückt wurde (mouse, touch, pen) - leer bei Tastatur und Vorleseprogramm.
  const pointerRef = useRef("");
  // Welcher Eintrag nach dem Öffnen den Fokus bekommt (0 = erster, -1 = letzter).
  const focusAfterOpen = useRef(null);
  const menuId = useId();
  const loc = useLocation();
  const visibleChildren = visibleNavChildren(item, { isClubMember, signedIn });
  const entries = dropdownEntries(item, visibleChildren);
  const ownPath = item.to?.split("?")[0];
  const isOwnActive = ownPath && (loc.pathname === ownPath || loc.pathname.startsWith(ownPath + "/"));
  const isActive = isOwnActive || visibleChildren.some((c) => loc.pathname === c.to.split("?")[0] || loc.pathname.startsWith(c.to.split("?")[0] + "/"));
  const key = item.label.toLowerCase();

  const entryLinks = () => [...(boxRef.current?.querySelectorAll("[data-nav-entry]") || [])];
  const focusEntry = useCallback((index) => {
    const links = [...(boxRef.current?.querySelectorAll("[data-nav-entry]") || [])];
    if (links.length) links[((index % links.length) + links.length) % links.length].focus();
  }, []);
  const openWithFocus = (index) => {
    clearTimeout(closeTimer.current);
    if (open) {
      focusEntry(index);
      return;
    }
    focusAfterOpen.current = index;
    setOpen(true);
  };
  const close = () => {
    clearTimeout(closeTimer.current);
    setOpen(false);
  };

  useEffect(() => {
    if (!open || focusAfterOpen.current === null) return;
    focusEntry(focusAfterOpen.current);
    focusAfterOpen.current = null;
  }, [open, focusEntry]);

  // Ein Tipp oder Klick daneben schließt.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Nur die Maus öffnet beim Drüberfahren - am Tablet kämen sonst die nachgestellten Maus-Ereignisse dem Antippen zuvor.
  const onPointerEnter = (event) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const onPointerLeave = (event) => {
    if (event.pointerType !== "mouse") return;
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const onTriggerPointerDown = (event) => {
    pointerRef.current = event.pointerType || "mouse";
  };
  const onTriggerClick = (event) => {
    const kind = pointerRef.current;
    pointerRef.current = "";
    if (TOUCH_POINTERS.has(kind)) {
      event.preventDefault();
      clearTimeout(closeTimer.current);
      setOpen((value) => !value);
      return;
    }
    if (item.to) return; // Maus (und Vorleseprogramm) öffnen die Seite des Hauptpunkts - wie bisher.
    event.preventDefault();
    if (kind === "mouse") {
      clearTimeout(closeTimer.current);
      setOpen(true);
      return;
    }
    // Hauptpunkt ohne eigene Seite, ausgelöst ohne Zeiger (Enter, Leertaste, Vorleseprogramm): auf und zu.
    if (open) close();
    else openWithFocus(0);
  };
  const onTriggerKeyDown = (event) => {
    const isLink = Boolean(item.to);
    if (event.key === "ArrowDown" || (isLink && (event.key === "Enter" || event.key === " "))) {
      event.preventDefault();
      if (isLink && open && event.key !== "ArrowDown") close();
      else openWithFocus(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openWithFocus(-1);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };
  const onMenuKeyDown = (event) => {
    const links = entryLinks();
    const index = links.indexOf(document.activeElement);
    if (event.key === "ArrowDown") focusEntry(index + 1);
    else if (event.key === "ArrowUp") focusEntry(index - 1);
    else if (event.key === "Home") focusEntry(0);
    else if (event.key === "End") focusEntry(-1);
    else if (event.key === "Escape") {
      close();
      triggerRef.current?.focus();
    } else return;
    event.preventDefault();
  };
  // Wer mit Tab hinausgeht, schließt das Untermenü.
  const onBlur = (event) => {
    if (open && !boxRef.current?.contains(event.relatedTarget)) setOpen(false);
  };

  const triggerProps = {
    ref: triggerRef,
    "data-testid": `nav-${key}`,
    "aria-expanded": open,
    "aria-controls": menuId,
    "data-active": isActive ? "1" : "0",
    onPointerDown: onTriggerPointerDown,
    onClick: onTriggerClick,
    onKeyDown: onTriggerKeyDown,
    className: `tls-nav-link px-4 lg:max-xl:px-1.5 py-2 text-sm font-semibold uppercase tracking-wider lg:max-xl:tracking-wide transition rounded-sm inline-flex items-center gap-1.5 lg:max-xl:gap-1 ${
      isActive ? "text-[#29B6E8]" : "text-white/70 hover:text-white"
    }`,
  };
  const triggerContent = (
    <>
      <span>{item.label}</span>
      {badge ? <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#FF3B30] text-white text-[9px] leading-4 text-center" data-testid={`nav-${key}-count`} aria-label={`${badge} ungelesene Chats`}>{badge > 99 ? "99+" : badge}</span> : null}
      <ChevronDown data-testid={`nav-${key}-chevron`} aria-hidden="true" className={`w-3.5 h-3.5 shrink-0 opacity-80 transition-transform ${open ? "rotate-180" : ""}`} />
    </>
  );

  return (
    <div ref={boxRef} className="relative" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onBlur={onBlur}>
      {item.to ? (
        <Link to={item.to} {...triggerProps}>{triggerContent}</Link>
      ) : (
        <button type="button" {...triggerProps}>{triggerContent}</button>
      )}
      <div
        id={menuId}
        hidden={!open}
        className="absolute left-0 top-full pt-2 z-[80] min-w-[220px]"
        data-testid={`nav-${key}-dropdown`}
      >
        <ul className="border border-white/10 bg-[#0A0A0A] rounded-sm shadow-2xl shadow-black/80 py-2" aria-label={item.label}>
          {entries.map((c, idx) => (
            <li key={c.to}>
              {c.divider && idx > 0 && <div className="my-1 mx-3 border-t border-white/10" />}
              <NavLink
                to={c.to}
                onClick={() => setOpen(false)}
                onKeyDown={onMenuKeyDown}
                data-nav-entry=""
                data-testid={`nav-sub-${navTestId(c.label)}`}
                className={({ isActive }) =>
                  `block px-4 py-2 text-sm transition ${
                    isActive ? "text-[#29B6E8] bg-[#29B6E8]/5" : "text-white/80 hover:text-[#29B6E8] hover:bg-white/5 focus-visible:text-[#29B6E8] focus-visible:bg-white/5"
                  }`
                }
              >
                {c.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
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
              `tls-nav-link px-4 lg:max-xl:px-1.5 py-2 text-sm font-semibold uppercase tracking-wider lg:max-xl:tracking-wide transition rounded-sm ${
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
