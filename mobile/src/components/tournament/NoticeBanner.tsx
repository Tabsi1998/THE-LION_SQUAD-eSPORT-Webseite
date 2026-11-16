import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { api } from "../../lib/api";
import { activeNotices, nextExpiry, noticeClock, remainingShare, remainingText, type NoticeItem } from "../../lib/tournamentNotices";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { micro, motion, radius, roles } from "../../theme";
import { Glow, useReduceMotion } from "../motion";
import { useLeaving } from "../motion/useLeaving";

// Hinweis der Turnierleitung (#1166, #2393): oben auf Turnier- und Event-Seite, bis er abläuft oder entfernt wird - wie
// das Banner im Web (components/tls/tournament/NoticeBanner.jsx). Öffentlich: nur Text und Zeit, nie die Person, die
// geschrieben hat (der Server schickt sie gar nicht erst). Auffällig, aber ruhig: Gold für „bitte lesen“.
// Bewegung (nur transform/opacity): fährt ein kleines Stück von oben herein (gestaffelt, wenn mehrere kommen), der Rahmen
// leuchtet einmal auf, das Megafon wippt einmal; die Leiste unten läuft gleichmäßig leer. Abgelaufen oder entfernt
// blendet dieselbe Karte am selben Platz aus. Mit „Bewegung reduzieren“ springt alles.

const TICK_MS = 30000;
const LEAVE_MS = 180;
const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

/** Lädt die stehenden Hinweise (`path`: `/tournaments/<id>/notices` bzw. `/events/<slug>/notices`) und lädt nach, sobald
 * sich Turnier oder Event ändern. Ohne Pfad lädt er nichts; ein Fehler lässt die Seite ohne Banner. */
export function useNotices(path: string | null, { enabled = true }: { enabled?: boolean } = {}): NoticeItem[] {
  const [items, setItems] = useState<NoticeItem[]>([]);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const { data } = await api.get<{ items?: NoticeItem[] }>(path);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      // Ein fehlendes Banner hält die Seite nicht auf.
      setItems([]);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load, ["tournaments", "events"], { enabled: Boolean(path) && enabled, fallbackMs: 30000 });
  return items;
}

/** Die Uhr des Banners: alle 30 Sekunden für die Restzeit - und genau dann, wenn der nächste Hinweis abläuft. */
function useNow(items: NoticeItem[]) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const left = nextExpiry(items, Date.now());
    if (left == null) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(left + 50, 2147483000));
    return () => clearTimeout(timer);
  }, [items, now]);
  return now;
}

/** Das Banner. `showTournament`: auf der Event-Seite der Turniername vor Hinweisen eines Turniers. */
export function NoticeBanner({ items, limit = 3, showTournament = false }: { items: NoticeItem[]; limit?: number; showTournament?: boolean }) {
  const reduce = useReduceMotion();
  const now = useNow(items);
  const shown = activeNotices(items, now).slice(0, limit);
  const displayed = useLeaving(shown, (item) => item.id, LEAVE_MS, reduce);
  if (!displayed.length) return null;
  return (
    <View style={styles.stack} accessibilityLiveRegion="polite" testID="notice-banner">
      {displayed.map(({ item, leaving }, index) => (
        <NoticeCard key={item.id} item={item} index={index} now={now} showTournament={showTournament} leaving={leaving} reduce={reduce} />
      ))}
    </View>
  );
}

function NoticeCard({ item, index, now, showTournament, leaving, reduce }: { item: NoticeItem; index: number; now: number; showTournament: boolean; leaving: boolean; reduce: boolean }) {
  const [arrives] = useState(!reduce);
  const delay = Math.min(index, micro.staggerMax) * micro.stagger;
  const shown = useSharedValue(arrives ? 0 : 1);
  const tilt = useSharedValue(0);
  const share = useSharedValue(remainingShare(item, now));
  useEffect(() => {
    if (!arrives) return;
    shown.value = withDelay(delay, withTiming(1, { duration: motion.mid, easing: ease }));
    // Das Megafon wippt einmal - ein kleiner Ruf, kein Dauerblinken.
    tilt.value = withDelay(delay + motion.fast, withSequence(
      withTiming(-12, { duration: 90, easing: ease }),
      withTiming(8, { duration: 110, easing: ease }),
      withTiming(0, { duration: 140, easing: ease }),
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (leaving) shown.value = reduce ? 0 : withTiming(0, { duration: LEAVE_MS, easing: ease });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  // Die Leiste gleitet bis zum nächsten Takt dorthin, wo sie dann stehen wird - so läuft sie ohne Sprung gleichmäßig leer.
  useEffect(() => {
    const target = remainingShare(item, now + TICK_MS);
    share.value = reduce ? remainingShare(item, now) : withTiming(target, { duration: TICK_MS, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, item.expires_at, reduce]);
  const card = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * (leaving ? -4 : -6) }] }));
  const icon = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: share.value }] }));
  const where = showTournament && item.target === "tournament" && item.tournament_title ? item.tournament_title : "";
  return (
    <Animated.View
      style={[styles.card, card]}
      accessible={!leaving}
      accessibilityLabel={`Hinweis der Turnierleitung${where ? `, ${where}` : ""}: ${item.text}. ${noticeClock(item)} Uhr, ${remainingText(item.expires_at, now)}`}
      importantForAccessibility={leaving ? "no-hide-descendants" : "auto"}
      testID={leaving ? undefined : `notice-${item.id}`}
    >
      {leaving ? null : <Glow active={arrives} delay={delay + motion.fast} color={roles.honor} peak={0.12} radius={radius.sm} />}
      <Animated.View style={[styles.icon, icon]}>
        <Ionicons name="megaphone-outline" size={17} color={roles.honor} />
      </Animated.View>
      <View style={styles.flex}>
        <Text style={styles.eyebrow} maxFontSizeMultiplier={1.3}>
          HINWEIS DER TURNIERLEITUNG{where ? <Text style={styles.where}>{` · ${where}`}</Text> : null}
        </Text>
        <Text style={styles.text} maxFontSizeMultiplier={1.4} testID="notice-text">{item.text}</Text>
        <Text style={styles.meta} maxFontSizeMultiplier={1.3} testID="notice-meta">{noticeClock(item)} Uhr · {remainingText(item.expires_at, now)}</Text>
      </View>
      <Animated.View style={[styles.left, bar]} pointerEvents="none" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "flex-start",
    // Gold für „bitte lesen“: ein Hauch über der Fläche, wie der Verlauf im Web.
    backgroundColor: "rgba(255,215,0,0.06)",
    borderColor: "rgba(255,215,0,0.42)",
    borderRadius: radius.sm,
    borderWidth: 1,
    columnGap: 12,
    flexDirection: "row",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  eyebrow: { color: roles.honor, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  flex: { flex: 1, minWidth: 0 },
  icon: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)", borderColor: "rgba(255,215,0,0.45)", borderRadius: radius.sm, borderWidth: 1, height: 36, justifyContent: "center", marginTop: 2, width: 36 },
  left: { backgroundColor: "rgba(255,215,0,0.65)", bottom: 0, height: 2, left: 0, position: "absolute", right: 0, transformOrigin: "left center" },
  meta: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontVariant: ["tabular-nums"], marginTop: 4 },
  stack: { gap: 8 },
  text: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", lineHeight: 22, marginTop: 2 },
  where: { color: "rgba(255,255,255,0.45)", letterSpacing: 1 },
});
