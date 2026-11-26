import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { BEREICH } from "@/lib/meinBereich";
import "./meinBereich.css";

// Rahmen jeder Gruppe in „Mein Bereich“ (#2059): Überschrift, ein Satz, Aktionen rechts, darunter die Reiter der Gruppe.
// Am Handy steht oben ein Knopf zurück zur Liste der Gruppen (oder zur übergeordneten Gruppe, `back`). Nach einem
// Wechsel innerhalb von „Mein Bereich“ geht der Fokus auf die Überschrift - Tastatur und Vorleser landen im Inhalt.

let focusWanted = false;
/** Die Seitenleiste meldet einen Wechsel - die nächste Gruppe holt den Fokus auf ihre Überschrift. */
export function requestHeadingFocus() {
  focusWanted = true;
}

export function BereichZurueck({ to = BEREICH, label = "Mein Bereich", className = "", testId = "mein-bereich-back" }) {
  return (
    <Link to={to} data-testid={testId} className={`tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider ${className}`.trim()}>
      <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> {label}
    </Link>
  );
}

/**
 * Reiter einer Gruppe: Knöpfe (der aktive als aktuelle Seite), darunter ein Strich, der zum neuen Reiter gleitet. Am Handy
 * eine Leiste zum Wischen; der aktive Reiter rückt ins Bild.
 */
export function BereichReiter({ items, active, onSelect, label, testIdPrefix = "mein-bereich-tab-" }) {
  const rowRef = useRef(null);
  const [line, setLine] = useState({ x: 0, w: 0, ready: false });
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = () => {
      const button = row?.querySelector('[aria-current="page"]');
      if (!button) return;
      setLine((current) => ({ x: button.offsetLeft, w: button.offsetWidth, ready: current.w > 0 }));
    };
    measure();
    const button = row?.querySelector('[aria-current="page"]');
    if (button && typeof button.scrollIntoView === "function" && row.scrollWidth > row.clientWidth) {
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (typeof ResizeObserver === "undefined" || !row) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [active, items.length]);

  return (
    <nav aria-label={label} className="mt-6 border-b border-white/10" data-testid="mein-bereich-reiter">
      <div ref={rowRef} className="tls-mb-tabs tls-swipe pb-0 flex gap-1">
        {items.map((item) => {
          const current = item.k === active;
          return (
            <button
              key={item.k}
              type="button"
              onClick={() => { if (!current) onSelect(item.k); }}
              aria-current={current ? "page" : undefined}
              data-testid={`${testIdPrefix}${item.k}`}
              className={`shrink-0 inline-flex min-h-11 items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-fast ease-tls ${current ? "text-[#29B6E8]" : "text-white/55 hover:text-white"}`}
            >
              {item.icon ? <item.icon className="w-3.5 h-3.5" aria-hidden="true" /> : null} {item.label}
            </button>
          );
        })}
        <span
          aria-hidden="true"
          className="tls-mb-tabs__line"
          data-ready={line.ready ? "1" : "0"}
          style={{ "--tls-mb-x": `${line.x}px`, "--tls-mb-w": line.w }}
        />
      </div>
    </nav>
  );
}

/** Eine Gruppe als Seite. `tabKey` wechselt beim Reiterwechsel und spielt das Einblenden des Inhalts neu ab. */
export function BereichSeite({ title, intro, actions, reiter, back, tabKey = "", docTitle, testId, children }) {
  const headingId = useId();
  const headingRef = useRef(null);
  // Beim ersten Zeichnen blendet schon der Rahmen ein (MeinBereichLayout) - hier nur beim Wechsel des Reiters.
  const [firstTab] = useState(tabKey);
  useDocumentTitle(`${docTitle || title} · Mein Bereich`, intro || "Mein Bereich", { robots: "noindex, nofollow" });
  useEffect(() => {
    if (!focusWanted) return;
    focusWanted = false;
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section aria-labelledby={headingId} data-testid={testId}>
      {back !== false ? <BereichZurueck {...(back || {})} className="mb-5 lg:hidden" /> : null}
      {back ? <BereichZurueck {...back} testId="mein-bereich-back-desktop" className="mb-5 hidden lg:inline-flex" /> : null}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className="tls-wrap font-heading text-3xl md:text-4xl font-black uppercase focus:outline-none">{title}</h1>
          {intro ? <p className="mt-2 max-w-2xl text-sm text-white/60">{intro}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {reiter}
      <div key={tabKey} className={`mt-6 min-w-0 ${tabKey !== firstTab ? "tls-mb-panel" : ""}`.trim()} data-testid="mein-bereich-panel">{children}</div>
    </section>
  );
}
