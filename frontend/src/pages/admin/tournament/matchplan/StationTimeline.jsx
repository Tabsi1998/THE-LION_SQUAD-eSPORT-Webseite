import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Pin } from "lucide-react";
import { dropConflicts, NO_STATION, snapMinutes, timeScale, timeTicks } from "@/lib/matchTimeline";
import { viennaTime } from "@/lib/vienna";

// Zeitleiste je Station (#1557): Balken je Spiel, Länge = Dauer, Farbe = Abschnitt, Zustand über Rollen (läuft Rot,
// erledigt grau, Konflikt Orange, fest mit Nadel). Ziehen legt ein Spiel auf eine andere Zeit oder Station - als festen
// Termin über den bestehenden Weg (PATCH /matches/:id). Dieselbe Bedienung mit der Tastatur: Enter nimmt auf,
// Pfeile verschieben (← → 5 Min., mit Umschalt 15 Min., ↑ ↓ Station), Enter legt ab, Escape bricht ab.

// Mindestens 4 px je Minute (ein 20-Minuten-Spiel ist 80 px breit); ist Platz, wächst die Achse bis zur Breite.
export const PX_PER_MINUTE = 4;
const MAX_PX_PER_MINUTE = 9;
const LABEL_WIDTH = 168;
export const LANE_HEIGHT = 64;
const MINUTE = 60_000;
const DRAG_THRESHOLD = 4;

const hm = (ms) => viennaTime(ms, { hour: "2-digit", minute: "2-digit" }) || "–";

function barLabel(item, laneName) {
  const parts = [`${item.key}, ${hm(item.start)} bis ${hm(item.end)}`, laneName];
  if (item.state === "running") parts.push(`läuft seit ${item.elapsedMinutes} Minuten`);
  if (item.state === "done") parts.push("erledigt");
  if (item.fixed) parts.push("fester Termin");
  if (item.forecast) parts.push("Prognose, Spieler stehen noch nicht fest");
  for (const conflict of item.conflicts) parts.push(`Konflikt: ${conflict.text}`);
  return parts.join(", ");
}

export function StationTimeline({ timeline, editable = false, canMoveItem = null, onMove, onSelect, selectedId = null, showNow = false }) {
  const scroller = useRef(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const node = scroller.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setRoom(Math.floor(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const minutes = (timeline.range.end - timeline.range.start) / MINUTE;
  const ppm = room > LABEL_WIDTH ? Math.min(MAX_PX_PER_MINUTE, Math.max(PX_PER_MINUTE, Math.floor(((room - LABEL_WIDTH - 2) / minutes) * 4) / 4)) : PX_PER_MINUTE;
  const scale = useMemo(() => timeScale(timeline.range, ppm), [timeline.range, ppm]);
  // Live: einmal beim Öffnen so weit scrollen, dass „jetzt“ links im Blick ist - nicht bei jedem Neuladen.
  const scrolledToNow = useRef(false);
  useEffect(() => {
    const node = scroller.current;
    if (!showNow || scrolledToNow.current || !node || !room) return;
    if (timeline.now < timeline.range.start || timeline.now > timeline.range.end) return;
    scrolledToNow.current = true;
    node.scrollLeft = Math.max(0, scale.x(timeline.now) - 120);
  }, [showNow, room, scale, timeline.now, timeline.range]);
  const ticks = useMemo(() => timeTicks(timeline.range, 15), [timeline.range]);
  const laneIds = timeline.lanes.map((lane) => lane.id);
  const laneName = (id) => timeline.lanes.find((lane) => lane.id === id)?.name || "Station";
  const [drag, setDrag] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // Nach dem Ablegen springt der Balken an die Stelle, die der Geist schon gezeigt hat - kein Gleiten hinterher
  // (Ziehen und Tastatur sind die Hand des Nutzers; Gleiten gibt es nur, wenn der Planer umplant).
  const [instant, setInstant] = useState(false);
  const pointer = useRef(null);
  useEffect(() => {
    if (!instant) return undefined;
    const timer = setTimeout(() => setInstant(false), 1500);
    return () => clearTimeout(timer);
  }, [instant]);

  const movable = (item) => editable && !busy && item.state === "planned" && !item.preview && (!canMoveItem || canMoveItem(item));

  const describe = (next, item) => {
    const blocking = dropConflicts(timeline, item.id, next.laneId, next.start);
    const where = `${item.key} → ${laneName(next.laneId)} · ${hm(next.start)}`;
    return blocking.length ? `${where} · im Weg: ${blocking.map((row) => row.key).join(", ")}` : `${where} · frei`;
  };

  const place = (item, next) => {
    setDrag({ ...next, id: item.id });
    setStatus(describe(next, item));
  };

  const cancel = (item) => {
    pointer.current = null;
    setDrag(null);
    setStatus(item ? `Verschieben von ${item.key} abgebrochen.` : "");
  };

  const commit = async (item, next) => {
    pointer.current = null;
    setDrag(null);
    if (next.start === item.start && next.laneId === item.laneId) {
      setStatus(`${item.key} bleibt, wo es ist.`);
      return;
    }
    setBusy(true);
    setInstant(true);
    setStatus(`${item.key} wird auf ${hm(next.start)} an ${laneName(next.laneId)} gelegt …`);
    const result = await onMove?.(item, next);
    setBusy(false);
    setStatus(result?.ok
      ? `${item.key} steht jetzt fest um ${hm(next.start)} an ${laneName(next.laneId)}.`
      : result?.message || "Das Spiel konnte nicht verschoben werden.");
  };

  const onPointerDown = (event, item) => {
    if (!movable(item) || event.button !== 0) return;
    pointer.current = { id: item.id, x: event.clientX, y: event.clientY, moved: false, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const target = (item, dx, dy) => {
    const index = laneIds.indexOf(item.laneId);
    const laneIndex = Math.min(laneIds.length - 1, Math.max(0, index + Math.round(dy / LANE_HEIGHT)));
    return { start: snapMinutes(item.start + (dx / ppm) * MINUTE, 5), laneId: laneIds[laneIndex] };
  };

  const onPointerMove = (event, item) => {
    const state = pointer.current;
    if (!state || state.id !== item.id) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    state.moved = true;
    place(item, target(item, dx, dy));
  };

  const onPointerUp = (event, item) => {
    const state = pointer.current;
    if (!state || state.id !== item.id) return;
    if (!state.moved) {
      pointer.current = null;
      onSelect?.(item.id);
      return;
    }
    commit(item, target(item, event.clientX - state.x, event.clientY - state.y));
  };

  const onKeyDown = (event, item) => {
    const carrying = drag?.id === item.id;
    if (event.key === "Escape" && (carrying || pointer.current)) {
      event.preventDefault();
      cancel(item);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (carrying) {
        commit(item, { start: drag.start, laneId: drag.laneId });
      } else if (movable(item)) {
        setDrag({ id: item.id, start: item.start, laneId: item.laneId, keyboard: true });
        setStatus(`${item.key} aufgenommen. Pfeiltasten verschieben, Enter legt ab, Escape bricht ab.`);
      } else {
        onSelect?.(item.id);
      }
      return;
    }
    if (!carrying) return;
    const step = event.shiftKey ? 15 : 5;
    const index = laneIds.indexOf(drag.laneId);
    const moves = {
      ArrowRight: { start: drag.start + step * MINUTE, laneId: drag.laneId },
      ArrowLeft: { start: drag.start - step * MINUTE, laneId: drag.laneId },
      ArrowDown: { start: drag.start, laneId: laneIds[Math.min(laneIds.length - 1, index + 1)] },
      ArrowUp: { start: drag.start, laneId: laneIds[Math.max(0, index - 1)] },
    };
    if (!moves[event.key]) return;
    event.preventDefault();
    place(item, moves[event.key]);
  };

  const dragged = drag ? timeline.items.find((item) => item.id === drag.id) : null;
  const ghostVisible = dragged && (drag.start !== dragged.start || drag.laneId !== dragged.laneId);
  const ghostBlocked = ghostVisible && dropConflicts(timeline, dragged.id, drag.laneId, drag.start).length > 0;
  const nowX = showNow && timeline.now >= timeline.range.start && timeline.now <= timeline.range.end ? scale.x(timeline.now) : null;

  return (
    <div className="mp-timeline" data-testid="mp-timeline" data-dragging={drag ? "true" : undefined} data-instant={instant ? "true" : undefined}>
      <div className="mp-timeline__scroll" ref={scroller}>
        <div className="mp-timeline__canvas" style={{ width: `calc(var(--mp-label) + ${scale.total}px)` }}>
          <div className="mp-timeline__head" aria-hidden="true">
            <div className="mp-timeline__corner" />
            <div className="mp-timeline__ticks">
              {ticks.map((tick) => (
                <span key={tick} className="mp-tick" data-hour={new Date(tick).getUTCMinutes() === 0 ? "true" : undefined} style={{ transform: `translate3d(${scale.x(tick)}px, 0, 0)` }}>
                  {hm(tick)}
                </span>
              ))}
            </div>
          </div>
          {timeline.lanes.map((lane) => {
            const items = timeline.items.filter((item) => item.laneId === lane.id);
            const ghosts = timeline.items.filter((item) => item.previous && item.previous.start !== null
              && (item.previous.stationId || NO_STATION) === lane.id && item.state === "planned");
            return (
              <div key={lane.id} className="mp-lane" data-testid={`mp-lane-${lane.id}`} data-name={lane.name} data-status={lane.status || undefined}>
                <div className="mp-lane__label">
                  <span className="mp-lane__name" title={lane.name}>{lane.name}</span>
                  <span className="mp-lane__meta">
                    {lane.status === "broken" ? "defekt · " : ""}{lane.count === 1 ? "1 Spiel" : `${lane.count} Spiele`}
                  </span>
                </div>
                <div className="mp-lane__track" style={{ "--mp-tick": `${15 * ppm}px` }}>
                  {!items.length && <span className="mp-lane__empty">{lane.status === "broken" ? "Station defekt - der Planer lässt sie aus" : "Keine Spiele"}</span>}
                  {ghosts.map((item) => (
                    <span key={`was-${item.id}`} className="mp-was" aria-hidden="true"
                      style={{ transform: `translate3d(${scale.x(item.previous.start)}px, 0, 0)`, width: `${item.minutes * ppm}px` }} />
                  ))}
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="mp-bar"
                      data-testid={`mp-bar-${item.key}`}
                      data-tone={item.tone}
                      data-state={item.state}
                      data-fixed={item.fixed ? "true" : undefined}
                      data-conflict={item.conflicts.length ? "true" : undefined}
                      data-changed={item.changed ? "true" : undefined}
                      data-forecast={item.forecast ? "true" : undefined}
                      data-selected={selectedId === item.id ? "true" : undefined}
                      data-carried={drag?.id === item.id ? "true" : undefined}
                      data-movable={movable(item) ? "true" : undefined}
                      aria-label={barLabel(item, lane.name)}
                      aria-pressed={drag?.id === item.id ? true : undefined}
                      title={item.names.join(" · ")}
                      style={{ transform: `translate3d(${scale.x(item.start)}px, 0, 0)`, width: `${scale.width(item)}px` }}
                      onPointerDown={(event) => onPointerDown(event, item)}
                      onPointerMove={(event) => onPointerMove(event, item)}
                      onPointerUp={(event) => onPointerUp(event, item)}
                      onPointerCancel={() => cancel(null)}
                      onKeyDown={(event) => onKeyDown(event, item)}
                    >
                      <span className="mp-bar__key">
                        {item.key}
                        {item.fixed && <Pin className="mp-bar__icon" aria-hidden="true" />}
                        {item.conflicts.length > 0 && <AlertTriangle className="mp-bar__icon mp-bar__icon--warn" aria-hidden="true" />}
                      </span>
                      <span className="mp-bar__time">
                        {item.state === "running" ? `läuft ${item.elapsedMinutes} Min.` : item.state === "done" ? `${hm(item.start)} ✓` : hm(item.start)}
                      </span>
                    </button>
                  ))}
                  {ghostVisible && drag.laneId === lane.id && (
                    <span className="mp-ghost" data-testid="mp-ghost" data-blocked={ghostBlocked ? "true" : "false"} aria-hidden="true"
                      style={{ transform: `translate3d(${scale.x(drag.start)}px, 0, 0)`, width: `${dragged.minutes * ppm}px` }}>
                      {dragged.key} · {hm(drag.start)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {nowX !== null && (
            <div className="mp-now" data-testid="mp-now" aria-hidden="true" style={{ transform: `translate3d(calc(var(--mp-label) + ${nowX}px), 0, 0)` }}>
              <span>jetzt {hm(timeline.now)}</span>
            </div>
          )}
        </div>
      </div>
      <p className="mp-timeline__status" role="status" aria-live="polite" data-testid="mp-drag-status">{status}</p>
      {editable && (
        <p className="mp-hint">
          Ziehen legt ein Spiel fest auf eine andere Zeit oder Station. Mit der Tastatur: Spiel wählen, Enter nimmt auf,
          Pfeiltasten verschieben (Umschalt: 15 Min.), Enter legt ab, Escape bricht ab.
        </p>
      )}
    </div>
  );
}
