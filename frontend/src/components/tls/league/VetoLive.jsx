// Map-Veto live (D.4, #1651, docs/LIGA.md D.4): die Bausteine, die Matchseite und TV teilen - der Countdown nach der Serverzeit, der Ablauf
// als Zeitleiste und das Brett aus Map-Karten im Stil der Veto-Karten der Team-Liga (maps.css, #1616). Detail-Runde: Die Karten bauen sich
// gestaffelt auf, eigene wählbare Karten heben sich unter dem Zeiger an und geben beim Antippen nach, gesperrte dimmen und sinken leicht,
// jede Wahl und jede Aktion der Gegenseite leuchtet einmal auf, um den Modus des laufenden Zugs zeichnet sich ein Rahmen nach. Bewegt
// werden nur transform (auch `translate`/`scale`) und opacity, mit den Bewegungs-Variablen aus index.css - mit „Bewegung reduzieren“
// (bzw. am TV „Bewegung aus“) stehen alle Zustände sofort da. Der kurze Abruf baut nichts neu auf: Karten und Schritte tragen feste
// Schlüssel, aufleuchten lässt nur eine echte Änderung.
import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, Crown, Hourglass, Pin, Shuffle } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { remainingText } from "@/lib/leagueCheckin";
import {
  boardGroups, cardLabel, countdownAnnouncement, freshCards, isUrgent, secondsLeft, sideTone, timelineLabel, timelineRows, vetoClockOffset,
  vetoDeadline,
} from "@/lib/leagueVeto";
import "@/components/tls/maps/maps.css";

const RING = 100;
const TICK_MS = 250;

/** Abstand Serveruhr - Geräteuhr (ms), neu gerechnet mit jeder Antwort (`server_now` des Blocks). */
export function useServerOffset(serverNowIso) {
  return useMemo(() => vetoClockOffset(serverNowIso, Date.now()), [serverNowIso]);
}

/**
 * Welche Karten gerade aufleuchten: je Karte ein Zähler, der mit jeder neuen Aktion steigt - der Schein hängt mit diesem Zähler als
 * Schlüssel an der Karte und spielt so genau einmal je Aktion, nie beim bloßen Nachfragen und nicht beim ersten Laden.
 */
export function useFreshCards(block) {
  const remaining = block?.remaining || null;
  const ownSide = block?.own_side || null;
  const previous = useRef(remaining);
  const [fresh, setFresh] = useState(() => new Map());
  useEffect(() => {
    const before = previous.current;
    previous.current = remaining;
    const keys = freshCards(before, remaining, ownSide);
    if (!keys.size) return;
    setFresh((current) => {
      const next = new Map(current);
      for (const key of keys) next.set(key, (next.get(key) || 0) + 1);
      return next;
    });
  }, [remaining, ownSide]);
  return fresh;
}

/**
 * Der Countdown je Zug: ein ruhiger Ring und die Restzeit. Er zählt nach der Uhr des Servers (`offset`), nicht nach der des Geräts. Die
 * letzten zehn Sekunden färben sich rot und tragen Sanduhr und „gleich vorbei“ (auch ohne Farbe und ohne Bewegung lesbar); ohne
 * „Bewegung reduzieren“ atmet der Ring dazu ruhig (nur opacity). Bildschirmleser hören die
 * Zeit nur bei 30, 10 und 5 Sekunden und beim Ablauf. Läuft die Zeit ab, wählt der Server - hier steht nur „Zeit um“.
 */
export function VetoCountdown({ block, offset = 0, size = 72, className = "", tv = false }) {
  const target = vetoDeadline(block, offset);
  const reduced = useReducedMotion();
  const circle = useRef(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target === null) return undefined;
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, [target]);
  const stepMs = (Number(block?.step_seconds) || 0) * 1000;
  // Ohne „Bewegung reduzieren“ läuft der Ring je Bild weich herunter; sonst springt er mit jedem Takt.
  useEffect(() => {
    if (reduced || target === null || !stepMs) return undefined;
    let frame = 0;
    const draw = () => {
      const share = Math.min(1, Math.max(0, (target - Date.now()) / stepMs));
      circle.current?.setAttribute("stroke-dashoffset", String(RING * (1 - share)));
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [reduced, target, stepMs]);
  if (block?.status === "paused") {
    const rest = Number(block.paused?.remaining_seconds ?? block.current?.remaining_seconds) || 0;
    return (
      <div className={`tls-veto-clock ${className}`} data-testid="veto-countdown" data-paused="true" data-tv={tv ? "true" : undefined}>
        <div className="tls-veto-clock__text">
          <div className="tls-veto-clock__caption">Pause · Rest</div>
          <div className="tls-veto-clock__number font-display text-3xl font-bold tabular-nums" data-testid="veto-countdown-text">{remainingText(rest * 1000, 0) || "0:00"}</div>
        </div>
      </div>
    );
  }
  if (target === null) return null;
  const seconds = secondsLeft(target, now);
  const urgent = isUrgent(seconds);
  const share = stepMs ? Math.min(1, Math.max(0, (target - now) / stepMs)) : 1;
  const tone = urgent ? "urgent" : sideTone(sideOfCurrent(block));
  return (
    <div className={`tls-veto-clock ${className}`} data-testid="veto-countdown" data-urgent={urgent ? "true" : "false"} data-tone={tone}
      data-tv={tv ? "true" : undefined}>
      <svg viewBox="0 0 80 80" width={size} height={size} className="tls-veto-clock__ring tls-checkin-ring shrink-0" aria-hidden="true">
        <circle cx="40" cy="40" r="34" fill="none" className="tls-veto-clock__track" strokeWidth="6" />
        <circle ref={circle} cx="40" cy="40" r="34" fill="none" className="tls-veto-clock__arc" strokeWidth="6" strokeLinecap="round"
          pathLength={RING} strokeDasharray={RING} strokeDashoffset={RING * (1 - share)} />
      </svg>
      <div className="tls-veto-clock__text">
        {/* Die letzten zehn Sekunden nicht nur rot (Review): Zeichen und Wort sagen es auch ohne Farbe und ohne Bewegung. */}
        <div className="tls-veto-clock__caption" data-testid="veto-countdown-caption">
          {seconds > 0 && urgent ? <><Hourglass className="tls-veto-clock__icon" aria-hidden="true" /> gleich vorbei</> : seconds > 0 ? "noch" : "Zeit um"}
        </div>
        <div className="tls-veto-clock__number font-display text-3xl font-bold tabular-nums" role="timer" aria-live="off" data-testid="veto-countdown-text">{remainingText(target, now) || "0:00"}</div>
        <span className="sr-only" aria-live="polite" data-testid="veto-countdown-announce">{countdownAnnouncement(seconds)}</span>
      </div>
    </div>
  );
}

function sideOfCurrent(block) {
  const id = block?.current?.registration_id;
  if (id && block.team_a?.registration_id === id) return "A";
  if (id && block.team_b?.registration_id === id) return "B";
  return (block?.plan || []).find((row) => row.state === "current")?.side || null;
}

/**
 * Der Ablauf als Zeitleiste: jeder Schritt mit Art, Seite, Modus und Ziel; fertige Schritte zeigen die Map, der laufende ist hervorgehoben.
 * Am Handy wischt man durch die Leiste (die Ränder blenden aus, so sieht man, dass es weitergeht); der laufende Schritt rückt von selbst
 * in die Mitte der Leiste - nur die Leiste scrollt, nie die Seite.
 */
export function VetoTimeline({ block, className = "", tv = false }) {
  const rows = timelineRows(block);
  const list = useRef(null);
  const reduced = useReducedMotion();
  const current = rows.findIndex((row) => row.state === "current");
  useEffect(() => {
    const node = list.current;
    const item = current >= 0 ? node?.children?.[current] : null;
    if (!node || !item || typeof node.scrollTo !== "function" || node.scrollWidth <= node.clientWidth) return;
    node.scrollTo({ left: Math.max(0, item.offsetLeft - (node.clientWidth - item.clientWidth) / 2), behavior: reduced ? "auto" : "smooth" });
  }, [current, reduced]);
  if (!rows.length) return null;
  return (
    <div className={`tls-veto-flow ${className}`} data-tv={tv ? "true" : undefined}>
      <ol ref={list} className="tls-veto-flow__list" aria-label="Ablauf des Vetos" data-testid="veto-timeline">
        {rows.map((row) => (
          <li key={row.key} className="tls-veto-step" data-state={row.state} data-kind={row.kind} data-tone={row.tone}
            aria-current={row.state === "current" ? "step" : undefined} aria-label={timelineLabel(row, rows.length)} data-testid={`veto-step-${row.index}`}>
            <span className="tls-veto-step__head" aria-hidden="true">
              <span className="tls-veto-step__num">{row.number}</span>
              <span className="tls-veto-step__kind">{row.kindLabel}{row.target ? ` · ${row.target}` : ""}</span>
            </span>
            <span className="tls-veto-step__who" aria-hidden="true">{row.who}</span>
            <span className="tls-veto-step__mode" aria-hidden="true">{row.mode_label || row.mode}</span>
            {row.state === "done" ? (
              <span className="tls-veto-step__map" aria-hidden="true">
                {row.map_image_url ? <LazyImg src={row.map_image_url} alt="" sizes="48px" widths={[160]} className="tls-veto-step__thumb" /> : null}
                <span className="min-w-0 truncate">{row.map_name}</span>
                {row.auto ? <Shuffle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
              </span>
            ) : row.state === "current" ? <span className="tls-veto-step__now" aria-hidden="true">läuft</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

const LABELS = {
  banned: [Ban, "Gesperrt"], picked: [Check, null], decider: [Crown, "Decider"], preset: [Pin, "Vorgabe"], elsewhere: [Ban, "Anderswo"],
};

function CardLabel({ card }) {
  const entry = LABELS[card.status];
  if (!entry) return null;
  const [Icon, word] = entry;
  const text = card.status === "picked" ? `Map ${card.position}` : card.position && card.status !== "elsewhere" ? `${word} · Map ${card.position}` : word;
  return (
    <span className="tls-veto-card__label" aria-hidden="true">
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> {text}
    </span>
  );
}

function MapCard({ card, index, kind, busy, onChoose, flash, tv }) {
  return (
    <button type="button" className="tls-veto-card tls-veto-card--live" style={{ "--tls-i": Math.min(index, 12) }}
      data-status={card.status} data-tone={card.tone} data-selectable={card.selectable ? "true" : "false"}
      data-pickable={card.pickable ? "true" : "false"} data-testid={card.pickable ? `veto-option-${card.map_id}` : undefined}
      data-allowed={card.pickable ? String(card.selectable) : undefined} disabled={!card.selectable || busy || !onChoose}
      title={card.pickable && !card.selectable ? card.option?.hint || undefined : undefined} aria-label={cardLabel(card, kind)}
      onClick={() => onChoose?.(card)}>
      <span className="tls-veto-card__media">
        {card.image_url ? (
          <LazyImg src={card.image_url} alt="" sizes={tv ? "320px" : "(min-width: 1024px) 180px, (min-width: 640px) 30vw, 45vw"} widths={[320, 640]}
            className="tls-veto-card__img" />
        ) : null}
        <CardLabel card={card} />
      </span>
      <span className="tls-veto-card__body">
        <span className="tls-veto-card__name">{card.name}</span>
        <span className="tls-veto-card__state">{card.statusText}</span>
      </span>
      {flash ? <span key={`flash-${flash}`} className="tls-veto-card__flash" aria-hidden="true" data-testid={`veto-flash-${card.map_id}`} /> : null}
    </button>
  );
}

/** Der Rahmen um den Modus des laufenden Zugs zeichnet sich einmal nach - je neuem Schritt, über den Schlüssel des Schritts. */
function TraceFrame({ tone }) {
  return (
    <span className="tls-veto-trace" data-tone={tone} aria-hidden="true" data-testid="veto-trace">
      <span /><span /><span /><span />
    </span>
  );
}

/**
 * Das Brett: je Modus die Maps als Karten mit Bild und Zustand (offen, gesperrt mit Seite, gewählt mit Position und Seite, Decider,
 * Vorgabe der Woche). Ist die eigene Seite am Zug, sind die Karten des laufenden Modus die Auswahl - antippen sperrt bzw. wählt.
 */
export function VetoBoard({ block, busy = false, onChoose = null, fresh = null, tv = false, className = "" }) {
  const groups = boardGroups(block);
  const kind = block?.current?.kind;
  const tone = sideTone(sideOfCurrent(block));
  let index = 0;
  return (
    <ul className={`tls-veto-board ${className}`} data-testid="veto-board" data-tv={tv ? "true" : undefined}>
      {groups.map((group) => (
        <li key={group.mode} className="tls-veto-mode" data-current={group.current ? "true" : "false"} data-testid={`veto-mode-${group.mode}`}>
          {group.current && block.status === "running" ? <TraceFrame key={`trace-${block.current?.index}`} tone={tone} /> : null}
          <div className="tls-veto-mode__head">
            <ModeIcon src={group.icon_url} size="xs" /> <span className="min-w-0 [overflow-wrap:anywhere]">{group.label}</span>
            {group.current ? <span className="tls-veto-mode__now">{block.status === "paused" ? "pausiert" : "jetzt"}</span> : null}
          </div>
          <ul className="tls-veto-mode__cards" aria-label={group.label}>
            {group.cards.map((card) => {
              const at = index;
              index += 1;
              return (
                <li key={card.key} className="min-w-0" data-testid={`veto-map-${group.mode}-${card.map_id}`} data-status={card.status}>
                  <MapCard card={card} index={at} kind={kind} busy={busy} onChoose={card.pickable ? onChoose : null} flash={fresh?.get(card.key)} tv={tv} />
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
