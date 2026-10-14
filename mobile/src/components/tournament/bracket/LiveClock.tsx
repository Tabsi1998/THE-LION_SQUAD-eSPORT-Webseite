import React, { useEffect, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { liveClockText } from "../../../lib/tournamentView";

/** Spielzeit seit dem Start, jede Sekunde neu - nur diese Zahl rendert neu, nicht der Baum (#1563). */
export function LiveClock({ startedAt, style, testID }: { startedAt?: string | null; style?: StyleProp<TextStyle>; testID?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const text = liveClockText(startedAt, now);
  if (!text) return null;
  return <Text style={[{ fontVariant: ["tabular-nums"] }, style]} maxFontSizeMultiplier={1.3} accessibilityLabel={`läuft seit ${text} Minuten`} testID={testID}>{text}</Text>;
}
