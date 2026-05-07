import { useEffect, useMemo, useState } from "react";

const PHASE_STYLES = {
  live: "bg-[#FF3B30]/20 text-[#FF3B30] border-[#FF3B30]/50 animate-live",
  registration_open: "bg-[#00FF88]/15 text-[#00FF88] border-[#00FF88]/50",
  registration_pending: "bg-[#29B6E8]/10 text-[#29B6E8] border-[#29B6E8]/40",
  registration_closed: "bg-white/10 text-white/70 border-white/20",
  check_in: "bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/50",
  announced: "bg-[#29B6E8]/10 text-[#29B6E8] border-[#29B6E8]/40",
  draft: "bg-white/5 text-white/60 border-white/10",
  paused: "bg-white/10 text-white/80 border-white/20",
  completed: "bg-white/10 text-white/70 border-white/20",
  results_published: "bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/40",
  archived: "bg-white/5 text-white/40 border-white/10",
  cancelled: "bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/40",
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

const COUNTDOWN_PREFIX = {
  registration_opens: "in",
  registration_closes: "endet in",
  check_in_opens: "Check-in in",
  check_in_closes: "Check-in endet in",
  starts: "startet in",
  ends: "endet in",
};

function formatRemaining(ms) {
  if (ms <= 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}T ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

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

  useEffect(() => {
    if (!targetMs || targetMs <= Date.now()) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  if (!normalized) return null;
  const state = normalized.state || status || "announced";
  const remaining = targetMs ? formatRemaining(targetMs - now) : "";
  const prefix = remaining ? COUNTDOWN_PREFIX[normalized.countdown_kind] || "in" : "";
  const label = [normalized.label || fallbackPhase(status).label, prefix && `${prefix} ${remaining}`].filter(Boolean).join(" · ");
  const sz = size === "lg" ? "text-sm px-3 py-1" : size === "md" ? "text-[11px] px-2.5 py-1" : "text-[10px] px-2 py-[3px]";

  return (
    <span className={`inline-flex max-w-full min-w-0 items-center gap-1 font-bold uppercase tracking-wider border rounded-sm tabular-nums whitespace-normal break-words leading-tight ${sz} ${PHASE_STYLES[state] || PHASE_STYLES.announced} ${className}`}>
      {state === "live" ? <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> : null}
      {label}
    </span>
  );
}
