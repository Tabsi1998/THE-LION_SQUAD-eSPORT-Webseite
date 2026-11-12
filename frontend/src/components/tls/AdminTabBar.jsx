import { useEffect, useRef, useState } from "react";

// Reiter einer Verwaltungsseite (Spielseite #2249, Season-Seite #2267) als Wischleiste: am Handy seitlich wischbar, mit Hinweis,
// sobald nicht alle Platz haben. Pfeiltasten, Pos1 und Ende wechseln den Reiter. Ein Punkt am Reiter heißt: dort ist etwas nicht
// gespeichert. Die Test-Kennungen tragen das Präfix der Seite (`game-tab-modi`, `season-tab-termine`).
export function AdminTabBar({ tabs, active, dirty = {}, onSelect, idBase, label, testPrefix }) {
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
    return () => observer.disconnect();
  }, [tabs.length]);
  // Der aktive Reiter bleibt am Handy sichtbar, auch wenn er weit rechts liegt (etwa nach einem Sprung aus dem Überblick).
  useEffect(() => {
    const node = ref.current?.querySelector(`[data-tab="${active}"]`);
    node?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);
  const onKeyDown = (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const edge = { Home: 0, End: tabs.length - 1 }[event.key];
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const at = tabs.findIndex((tab) => tab.key === active);
    const next = tabs[edge ?? (at + step + tabs.length) % tabs.length];
    onSelect(next.key);
    ref.current?.querySelector(`[data-tab="${next.key}"]`)?.focus();
  };
  return (
    <div className="mb-6">
      <div ref={ref} role="tablist" aria-label={label} className="flex gap-1 border-b border-white/10 tls-swipe pb-0" data-testid={`${testPrefix}-tabs`}>
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button key={tab.key} type="button" role="tab" id={`${idBase}-tab-${tab.key}`} aria-selected={selected} aria-controls={`${idBase}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1} data-tab={tab.key} onKeyDown={onKeyDown} onClick={() => onSelect(tab.key)} data-testid={`${testPrefix}-tab-${tab.key}`}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 sm:px-3 text-xs font-bold uppercase tracking-wider focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-t-sm ${selected ? "border-[#29B6E8] text-white" : "border-transparent text-white/50 hover:text-white"}`}>
              {tab.label}
              {dirty[tab.key] ? (
                <span className="h-1.5 w-1.5 rounded-full bg-warn" data-testid={`${testPrefix}-tab-dirty-${tab.key}`}>
                  <span className="sr-only">(nicht gespeichert)</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {overflow ? <p className="mt-1.5 text-[11px] text-white/45" data-testid={`${testPrefix}-tabs-hint`}>Seitlich wischen: weitere Reiter liegen rechts.</p> : null}
    </div>
  );
}
