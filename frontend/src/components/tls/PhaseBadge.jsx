import { useEffect, useMemo, useState } from "react";
import { useCountdownDays } from "@/hooks/useCountdownDays";
import { whenPhrase, whenText, whenTickMs } from "@/lib/countdownRule";

// Phasen nach Farb-Rolle (#1305) - wie StatusBadge: Rot nur „läuft gerade“, Grün offen, Cyan angekündigt, Grau vorbei.
const PHASE_STYLES = {
  // LIVE (#1076): der Chip steht ruhig, nur der Punkt pulsiert leise (index.css, .tls-live-dot).
  live: "bg-live/20 text-live border-live/50",
  // Mehrtägig (#884): zwischen zwei Tagen - ruhig, mit Countdown bis zum nächsten Tag.
  day_break: "bg-event/15 text-[#C4B5FD] border-event/50",
  registration_open: "bg-ok/15 text-ok border-ok/50",
  registration_pending: "bg-brand/10 text-brand border-brand/40",
  registration_closed: "bg-white/10 text-white/70 border-white/20",
  check_in: "bg-ok/15 text-ok border-ok/50",
  announced: "bg-brand/10 text-brand border-brand/40",
  draft: "bg-white/5 text-white/60 border-white/10",
  paused: "bg-white/10 text-white/80 border-white/20",
  completed: "bg-white/10 text-white/70 border-white/20",
  results_published: "bg-white/5 text-muted-text border-white/20",
  archived: "bg-white/5 text-white/40 border-white/10",
  cancelled: "bg-white/5 text-quiet border-white/10",
};

const FALLBACK_LABELS = {
  scheduled: "Angekündigt",
  checkin_open: "Check-in offen",
  check_in: "Check-in offen",
  registration_open: "Anmeldung offen",
  registration_closed: "Anmeldung geschlossen",
  live: "Läuft",
  draft: "Entwurf",
  completed: "Beendet",
  results_published: "Ergebnisse veröffentlicht",
  archived: "Archiviert",
  cancelled: "Abgesagt",
  paused: "Pausiert",
};

// Das Verb vor der Zeitangabe (#1264): „startet in 3 Tagen“, „startet am Sa 14. November“, „startet im März“. Wann ein
// Countdown kommt und wann Datum oder Monat, sagt die eine Regel in lib/countdownRule.js - keine „154T 16h“ mehr.
const COUNTDOWN_VERB = {
  registration_opens: "",
  registration_closes: "endet",
  check_in_opens: "Check-in",
  check_in_closes: "Check-in endet",
  starts: "startet",
  ends: "endet",
};

function fallbackPhase(status) {
  const state = status === "scheduled" ? "announced" : (status === "checkin_open" ? "check_in" : status);
  return {
    state,
    label: FALLBACK_LABELS[status] || status?.replace(/_/g, " ") || "Status",
    target_at: null,
    countdown_kind: null,
  };
}

export function PhaseBadge({ phase, status, size = "sm", className = "" }) {
  const normalized = phase || fallbackPhase(status);
  const [now, setNow] = useState(() => Date.now());
  const targetMs = useMemo(() => {
    if (!normalized?.target_at) return null;
    const date = new Date(normalized.target_at);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }, [normalized?.target_at]);

  const days = useCountdownDays();

  // Die Angabe hat Minuten als kleinste Einheit: in der letzten Stunde alle 15 Sekunden nachsehen, sonst jede Minute.
  useEffect(() => {
    if (!targetMs) return undefined;
    let timer = null;
    const tick = () => {
      setNow(Date.now());
      const next = whenTickMs(targetMs);
      if (next) timer = setTimeout(tick, next);
    };
    const first = whenTickMs(targetMs);
    if (first) timer = setTimeout(tick, first);
    return () => { if (timer) clearTimeout(timer); };
  }, [targetMs]);

  if (!normalized) return null;
  const state = normalized.state || status || "announced";
  const when = targetMs && targetMs > now ? whenText(targetMs, { now, days }) : null;
  const remaining = when ? whenPhrase(COUNTDOWN_VERB[normalized.countdown_kind] || "", when) : "";
  const label = [normalized.label || fallbackPhase(status).label, remaining].filter(Boolean).join(" · ");
  const sz = size === "lg" ? "text-sm px-3 py-1" : size === "md" ? "text-[11px] px-2.5 py-1" : "text-[10px] px-2 py-[3px]";

  return (
    <span className={`inline-flex max-w-full min-w-0 items-center gap-1 font-bold uppercase tracking-wider border rounded-sm tabular-nums whitespace-normal break-words leading-tight ${sz} ${PHASE_STYLES[state] || PHASE_STYLES.announced} ${className}`}>
      {state === "live" ? <span className="tls-live-dot" aria-hidden="true" data-testid="phase-live-dot" /> : null}
      {label}
    </span>
  );
}
