import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { openDetail } from "../navigation/rootNavigation";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop, Text as SvgText } from "react-native-svg";
import { useSeason, type ActiveSeason } from "../seasons/SeasonProvider";
import { GOLD, SERIF } from "./DoorTile";

// Der Weg zum Adventkalender in der App (#641, #642): ein Hinweis im Dashboard und eine Zeile unter „Mehr“ - beides
// nur, wenn für das Jahr Türchen angelegt sind (`data.ready` vom Server). Dieselben Sätze wie im Web
// (frontend/src/seasons/adventCalendar, frontend/src/advent/AdventHint.jsx).

export type CalendarEntry = { door: number; label: string; waiting: boolean; catchUp: boolean; hour?: number };

/** Was das kleine Türchen zeigt und sagt - aus der Antwort des Servers. */
export function calendarEntry(season?: Pick<ActiveSeason, "data"> | null): CalendarEntry | null {
  const data = (season?.data || {}) as Record<string, unknown>;
  if (!data.ready) return null;
  const door = Math.max(0, Math.min(24, Math.round(Number(data.today_door) || 0)));
  const hour = Math.round(Number(data.door_hour)) || 6;
  if (data.catch_up) return { door: 24, label: "Adventkalender – alle Türchen sind offen, nachholen bis 6. Jänner", waiting: false, catchUp: true };
  if (door === 0) return { door: 1, label: `Adventkalender – das erste Türchen öffnet sich um ${hour} Uhr`, waiting: true, catchUp: false, hour };
  return { door, label: `Adventkalender – Türchen ${door} ist offen`, waiting: false, catchUp: false };
}

export function hintText(entry: CalendarEntry | null): string {
  if (!entry) return "";
  if (entry.waiting) return `Das erste Türchen geht heute um ${entry.hour || 6} Uhr auf.`;
  if (entry.catchUp) return "Alle 24 Türchen sind offen – nachholen kannst du bis 6. Jänner.";
  return `Türchen ${entry.door} ist offen – schau hinein.`;
}

/** Läuft der Kalender für die App? Der Eintrag unter „Mehr“ steht auch da, wenn die Person die Deko abgeschaltet hat. */
export function useAdventEntry({ decoration = false }: { decoration?: boolean } = {}): CalendarEntry | null {
  const { byKey } = useSeason();
  const season = byKey?.advent_calendar;
  if (!season || (decoration && season.effective === "off")) return null;
  return calendarEntry(season);
}

/** Das kleine Türchen als Zeichnung - dieselbe wie neben dem Logo der Website. */
export function DoorGlyph({ door, size = 40, waiting = false }: { door: number; size?: number; waiting?: boolean }) {
  return (
    <Svg width={(size * 36) / 40} height={size} viewBox="0 0 36 40" testID="advent-glyph">
      <Defs>
        <LinearGradient id="advGlyphDoor" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1b2a58" />
          <Stop offset="1" stopColor="#0b1330" />
        </LinearGradient>
        <LinearGradient id="advGlyphGold" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#fff1b8" />
          <Stop offset="0.5" stopColor="#e9c46a" />
          <Stop offset="1" stopColor="#b8862b" />
        </LinearGradient>
        <RadialGradient id="advGlyphLight" cx="50%" cy="55%" rx="60%" ry="60%">
          <Stop offset="0" stopColor="#ffc86e" stopOpacity={waiting ? 0.3 : 0.85} />
          <Stop offset="1" stopColor="#ffb454" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={18} cy={22} rx={17} ry={18} fill="url(#advGlyphLight)" />
      <Path d="M6 37 V17 C6 9.3 11.4 4 18 4 S30 9.3 30 17 V37 Z" fill="url(#advGlyphDoor)" stroke="url(#advGlyphGold)" strokeWidth={1.3} strokeLinejoin="round" />
      <Path d="M8.6 35 V17.3 C8.6 11 13 6.7 18 6.7 S27.4 11 27.4 17.3 V35" fill="none" stroke="rgba(233, 196, 106, 0.35)" strokeWidth={0.7} />
      <Path d="M13.5 9.8 l0.9 1.9 2 0.2 -1.5 1.4 0.4 2 -1.8 -1 -1.8 1 0.4 -2 -1.5 -1.4 2 -0.2 z" fill={GOLD} opacity={0.55} transform="translate(4.5 -1.5) scale(0.62)" />
      <SvgText x={17.5} y={28.2} textAnchor="middle" fontFamily={SERIF} fontWeight="600" fontSize={door > 9 ? 12.5 : 14} fill="url(#advGlyphGold)">{String(door)}</SvgText>
    </Svg>
  );
}

/**
 * Das Türchen klein im Dashboard-Kopf unter dem Kranz (#852): ein Tipp öffnet den Kalender über dem Tab, in dem man ist
 * (#1144) - der Pfeil zurück führt dorthin (wie der Hinweis). Nur mit angelegten Türchen.
 */
export function AdventCalendarWidget({ season }: { season: ActiveSeason; screen: string }) {
  const entry = calendarEntry(season);
  if (!entry) return null;
  const open = () => {
    openDetail("AdventCalendar");
  };
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={entry.label} hitSlop={6} style={({ pressed }) => [styles.widget, pressed && styles.pressed]} testID="advent-calendar-widget">
      <DoorGlyph door={entry.door} size={28} waiting={entry.waiting} />
    </Pressable>
  );
}

/** Hinweis im Dashboard: nur solange der Kalender läuft, Türchen angelegt sind und die Person die Deko nicht abgeschaltet hat. */
export function AdventHint({ onOpen }: { onOpen: () => void }) {
  const entry = useAdventEntry({ decoration: true });
  if (!entry) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Adventkalender: ${hintText(entry)}`} onPress={onOpen} style={({ pressed }) => [styles.hint, pressed && styles.pressed]} testID="advent-hint">
      <DoorGlyph door={entry.door} waiting={entry.waiting} />
      <View style={styles.text}>
        <Text style={styles.kicker}>ADVENTKALENDER</Text>
        <Text style={styles.line}>{hintText(entry)}</Text>
      </View>
      <Ionicons name="chevron-forward" color={GOLD} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  widget: { width: 28, height: 30, alignItems: "center", justifyContent: "center" },
  hint: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.32)", backgroundColor: "rgba(233, 196, 106, 0.07)" },
  text: { flex: 1, gap: 2 },
  kicker: { color: GOLD, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  line: { color: "rgba(255,255,255,0.84)", fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.78 },
});
