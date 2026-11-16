import React from "react";
import type { StyleProp, TextStyle } from "react-native";
import type { BracketMatch } from "../../../lib/bracketGraph";
import { InlineMatchClock } from "../../live/MatchClock";

/** Die Dauer, mit der die Uhr rechnet: die wirksame vom Server (Spiel, Phase, Turnier, Spiel-Vorgabe), sonst die eigene. */
export function clockDuration(match: Pick<BracketMatch, "effective_duration_minutes" | "duration_minutes"> | null | undefined): number | null {
  return match?.effective_duration_minutes ?? match?.duration_minutes ?? null;
}

/**
 * Spielzeit seit dem Start, jede Sekunde neu - nur diese Zahl rendert neu, nicht der Baum (#1563). Dieselbe Uhr wie an
 * Station, Turnierleitung und TV (#1167, #2393): nach der Serverzeit, ab einer Stunde mit Stunden („1:05:12“), in der
 * Turnierpause steht sie; mit Dauer ab 80 % orange und ab 100 % orange gefüllt mit Warn-Symbol.
 */
export function LiveClock({ startedAt, durationMinutes = null, pausedAt = null, pausedSeconds = 0, style, testID }: {
  startedAt?: string | null;
  durationMinutes?: number | null;
  pausedAt?: string | null;
  pausedSeconds?: number | null;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  return <InlineMatchClock startedAt={startedAt} durationMinutes={durationMinutes} pausedAt={pausedAt} pausedSeconds={pausedSeconds} style={style} testID={testID} />;
}
