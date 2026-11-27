import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { StaggerIn } from "@/components/tls/motion";
import { GRUPPEN_TEXT } from "@/lib/meinBereichSeiten";

// Die Gruppen von „Mein Bereich“ (#2059): am PC als Seitenleiste mit gleitendem Marker, am Handy (und auf der Übersicht)
// als Liste mit einer Zeile Text je Gruppe. Dieselben Einträge, dieselbe Reihenfolge - nur anders angeordnet.
// `offen` zählt je Gruppe, was in „Zu tun“ steht; die Zahl steht am Eintrag.

function offenText(count) {
  return count === 1 ? "1 offen" : `${count} offen`;
}

/** Seitenleiste am PC: Links, der aktive als aktuelle Seite; der Marker gleitet per transform zum aktiven Eintrag. */
export function BereichSeitenleiste({ gruppen, aktiv, offen = {} }) {
  const listRef = useRef(null);
  const [mark, setMark] = useState({ y: 0, h: 0, shown: false, ready: false });

  useLayoutEffect(() => {
    const list = listRef.current;
    const measure = () => {
      const item = list?.querySelector('[aria-current="page"]');
      if (!item) {
        setMark((current) => ({ ...current, shown: false }));
        return;
      }
      setMark((current) => ({ y: item.offsetTop, h: item.offsetHeight, shown: true, ready: current.shown }));
    };
    measure();
    if (typeof ResizeObserver === "undefined" || !list) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [aktiv, gruppen.length]);

  return (
    <nav aria-label="Mein Bereich" data-testid="mein-bereich-nav">
      <div ref={listRef} className="tls-mb-nav">
        <span
          aria-hidden="true"
          className="tls-mb-nav__mark"
          data-ready={mark.ready ? "1" : "0"}
          data-shown={mark.shown ? "1" : "0"}
          style={{ "--tls-mb-y": `${mark.y}px`, height: `${mark.h}px` }}
        />
        <ul className="space-y-0.5">
        {gruppen.map((item) => {
          const current = aktiv === item.key;
          const count = offen[item.key] || 0;
          return (
            <li key={item.key}>
              <Link
                to={item.path}
                data-route-plain=""
                aria-current={current ? "page" : undefined}
                aria-label={count ? `${item.label}, ${offenText(count)}` : undefined}
                data-testid={`mein-bereich-nav-${item.key}`}
                className={`tls-mb-nav__item flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 tls-type-small font-semibold ${current ? "text-[#29B6E8]" : "text-white/70 hover:text-white"}`}
              >
                <item.icon className="tls-mb-nav__icon w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="tls-wrap min-w-0 flex-1">{item.label}</span>
                {count ? <span className="tls-mb-dot shrink-0 min-w-5 h-5 rounded-full bg-[#FFD700] px-1.5 tls-type-small font-black leading-5 text-center text-black" aria-hidden="true">{count}</span> : null}
              </Link>
            </li>
          );
        })}
        </ul>
      </div>
    </nav>
  );
}

/** Liste am Handy und auf der Übersicht: je Gruppe eine Zeile mit Zeichen, Name, einer Zeile Text und Pfeil. */
export function BereichListe({ gruppen, offen = {}, testId = "mein-bereich-liste" }) {
  return (
    <StaggerIn as="ul" className="grid gap-2 sm:grid-cols-2" data-testid={testId}>
      {gruppen.map((item) => {
        const count = offen[item.key] || 0;
        return (
          <li key={item.key} className="min-w-0">
            <Link
              to={item.path}
              data-testid={`${testId}-${item.key}`}
              aria-label={count ? `${item.label}, ${offenText(count)}` : undefined}
              className="tls-card group flex min-h-16 items-center gap-3 rounded-sm border border-white/10 bg-[#121212] px-4 py-3"
            >
              <span className="w-10 h-10 shrink-0 rounded-sm border border-white/10 bg-[#0A0A0A] inline-flex items-center justify-center text-[#29B6E8]">
                <item.icon className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="tls-card__title tls-wrap block font-bold text-white">{item.label}</span>
                <span className="tls-wrap block tls-type-small text-white/55">{GRUPPEN_TEXT[item.key]}</span>
              </span>
              {count ? <span className="tls-mb-dot shrink-0 rounded-full bg-[#FFD700] px-2 py-0.5 tls-type-small font-black text-black" aria-hidden="true">{offenText(count)}</span> : null}
              <ChevronRight className="tls-card__arrow w-4 h-4 shrink-0 text-white/35" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </StaggerIn>
  );
}
