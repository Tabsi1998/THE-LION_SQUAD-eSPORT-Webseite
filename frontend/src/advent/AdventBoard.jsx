import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Door } from "./Door";
import { cellOf, columnsFor, doorOrder, doorVariant, DOORS, hingeAt } from "./doors";
import { sceneUrl } from "./scene";
import "./advent-calendar.css";

// Das Brett des Adventkalenders (#641): ein Bild, 24 Türchen in der Anordnung des Jahres. Die Breite bestimmt die
// Spalten (3, 4 oder 6); das Bild wird einmal gebaut und liegt als dieselbe Grafik hinter dem Brett und auf jedem
// Flügel - so geht es über alle Türchen hinweg weiter.

export const RATTLE_MS = 440;

/** Breite, Höhe und Spalten des Bretts - gemessen, damit das Bild auf den Flügeln genau sitzt. */
export function useBoardSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0, columns: 6 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const width = node.clientWidth || node.getBoundingClientRect().width || 0;
      const columns = columnsFor(width || (typeof window !== "undefined" ? window.innerWidth : 0));
      const height = width ? (width / columns) * (DOORS / columns) : 0;
      setSize((current) => (current.width === width && current.columns === columns ? current : { width, height, columns }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function AdventBoard({ calendar, busyDay = null, onOpen, onShow, onLocked }) {
  const ref = useRef(null);
  const { width, height, columns } = useBoardSize(ref);
  const [rattling, setRattling] = useState(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const scene = useMemo(() => sceneUrl(calendar.year), [calendar.year]);
  const order = useMemo(() => doorOrder(calendar.order), [calendar.order]);
  const doors = useMemo(() => new Map((calendar.doors || []).map((door) => [door.day, door])), [calendar.doors]);
  const variants = useMemo(() => new Map((calendar.doors || []).map((door) => [door.day, doorVariant(door.seed)])), [calendar.doors]);
  const today = !calendar.catch_up ? calendar.newest_door : null;

  const activate = (door) => {
    if (door.state === "locked") {
      window.clearTimeout(timer.current);
      setRattling(door.day);
      timer.current = window.setTimeout(() => setRattling(null), RATTLE_MS);
      onLocked?.(door);
      return;
    }
    if (door.state === "opened") onShow?.(door);
    else if (busyDay === null) onOpen?.(door);
  };

  const style = { "--cols": columns, "--rows": DOORS / columns, "--advent-scene": scene };
  if (width) {
    style["--board-w"] = `${width}px`;
    style["--board-h"] = `${height}px`;
  }
  return (
    <div className="tls-adv__frame" data-season-quiet="1" data-testid="advent-frame">
      <div ref={ref} className="tls-adv__board" style={style} role="group" aria-label={`Adventkalender ${calendar.year}: 24 Türchen`} data-testid="advent-board" data-columns={columns} data-year={calendar.year}>
        {order.map((day, index) => {
          const door = doors.get(day);
          if (!door) return <div key={day} className="tls-adv__cell" aria-hidden="true" />;
          const cell = cellOf(index, columns);
          const variant = variants.get(day);
          return (
            <Door
              key={day}
              door={door}
              variant={{ ...variant, hinge: hingeAt(variant.hinge, cell, columns) }}
              cell={cell}
              today={today === day}
              busy={busyDay === day}
              rattling={rattling === day}
              onActivate={activate}
            />
          );
        })}
      </div>
    </div>
  );
}
