import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/components/tls/StatusChip";
import { useCountdownDays } from "@/hooks/useCountdownDays";
import { whenPhrase, whenText, whenTickMs } from "@/lib/countdownRule";
import { isKnownStatus } from "@/lib/statusKinds";

// Dünne Hülle (#1306): die öffentliche Phase als StatusChip. Art und Wort kommen aus lib/statusKinds.js, der Countdown
// steht als kleiner Text neben dem Schild - nie mehr darin („Angekündigt · startet in 154T 16h“ war die lange Wurst).
// Wann ein Countdown kommt und wann Datum oder Monat, sagt die eine Regel in lib/countdownRule.js (#1264).

// Das Verb vor der Zeitangabe (#1264): „startet in 3 Tagen“, „startet am Sa 14. November“, „startet im März“.
const COUNTDOWN_VERB = {
  registration_opens: "",
  registration_closes: "endet",
  check_in_opens: "Check-in",
  check_in_closes: "Check-in endet",
  starts: "startet",
  ends: "endet",
};

// Mehrtägig (#884): „Tag 2/3 läuft“ bzw. „Tag 2/3“ vom Server - die Tagesangabe wandert neben das Schild.
const DAY_INFO = /^Tag \d+\/\d+/;

/** „Tag 2/3“ aus der Phase eines mehrtägigen Events (läuft oder Pause zwischen zwei Tagen), sonst null - auch für Stellen
 *  ohne Countdown (Kalender). */
export function phaseDayInfo(phase) {
  const state = phase?.state;
  return state === "live" || state === "day_break" ? DAY_INFO.exec(phase?.label || "")?.[0] || null : null;
}

function fallbackState(status) {
  if (status === "scheduled") return "announced";
  if (status === "checkin_open") return "check_in";
  return status;
}

export function PhaseBadge({ phase, status, size = "sm", className = "", onMedia = false }) {
  const state = phase?.state || fallbackState(status) || "announced";
  const [now, setNow] = useState(() => Date.now());
  const targetMs = useMemo(() => {
    if (!phase?.target_at) return null;
    const date = new Date(phase.target_at);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }, [phase?.target_at]);

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

  const when = targetMs && targetMs > now ? whenText(targetMs, { now, days }) : null;
  const remaining = when ? whenPhrase(COUNTDOWN_VERB[phase?.countdown_kind] || "", when) : "";
  const dayInfo = phaseDayInfo({ state, label: phase?.label });
  const meta = [dayInfo, remaining].filter(Boolean).join(" · ");
  // Ein Zustand, den die Tabelle nicht kennt, behält das Wort des Servers - nie den Rohwert.
  const label = isKnownStatus(state) ? undefined : phase?.label || undefined;

  return (
    <StatusChip
      status={state}
      label={label}
      size={size === "sm" ? "sm" : "lg"}
      onMedia={onMedia}
      meta={meta || null}
      className={className}
      dotTestId="phase-live-dot"
      metaTestId="phase-meta"
      testId="phase-chip"
    />
  );
}
