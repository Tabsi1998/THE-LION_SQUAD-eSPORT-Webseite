import { useEffect, useRef, useState } from "react";

// Breite Tabellen am Handy (#990): statt rechts abgeschnitten liegen sie in einer Fläche, die seitlich scrollt - mit
// dem Finger, mit Shift+Mausrad oder, nach Tab, mit den Pfeiltasten. Nur wenn sie wirklich überläuft, steht darüber
// der Hinweis. Am PC bleibt alles wie gewohnt.
export function TableScroll({ label, testId, className = "", children }) {
  const ref = useRef(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setOverflow(node.scrollWidth - node.clientWidth > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={className}>
      {overflow ? (
        <p className="mb-2 tls-type-small text-white/45" data-testid={`${testId}-hint`}>
          Seitlich wischen: weitere Spalten und Aktionen liegen rechts.
        </p>
      ) : null}
      <div
        ref={ref}
        role="region"
        aria-label={label}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        tabIndex={0}
        data-testid={testId}
        // scroll-mt-24 wie die Abschnitte der Verwaltung: Mit der Tastatur angesteuert, stehen die Fläche und ihre Knöpfe unter der
        // klebenden Kopfleiste statt dahinter (#1302).
        className="scroll-mt-24 [&_:is(a,button,input,select)]:scroll-mt-24 border border-white/10 rounded-sm bg-[#121212] tls-swipe pb-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]"
      >
        {children}
      </div>
    </div>
  );
}
