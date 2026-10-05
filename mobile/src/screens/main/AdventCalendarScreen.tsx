import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { SvgXml } from "react-native-svg";
import { AdventBoard } from "../../advent/AdventBoard";
import { DoorSheet } from "../../advent/DoorSheet";
import { GOLD, SERIF } from "../../advent/DoorTile";
import { DOORS, doorVariant, opensLabel, viennaParts, type Calendar, type Door } from "../../advent/doors";
import { openDoorLink } from "../../advent/links";
import { sceneSvg } from "../../advent/scene";
import { useAdventCalendar } from "../../advent/useAdventCalendar";
import { useReduceMotion } from "../../components/FadeIn";
import { Screen } from "../../components/Screen";
import { announceAchievementUnlocked } from "../../lib/achievements";
import { errorMessage } from "../../lib/api";
import { openSignIn } from "../../navigation/rootNavigation";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Adventkalender in der App (#641, #642): derselbe Kalender wie auf der Website - dasselbe Bild, dieselben Türchen,
// derselbe Stand. Der Server sagt, was offen ist; ein Tippen öffnet, der Flügel schwingt auf, danach erscheint der
// Inhalt. Gäste öffnen mit - gesammelt wird mit Konto. Ein neuer Erfolg wird gefeiert, sobald das Fenster zu ist.

type Props = NativeStackScreenProps<MoreStackParamList, "AdventCalendar">;

export const SHOW_AFTER_MS = 260;
const DAY_MS = 86400000;

export type ClosedState = { title: string; text: string; paused: boolean; year: number };

/** Der Kalender ist gerade zu: vor dem Advent, danach oder ein Jahr ohne Türchen. */
export function closedState(calendar: Pick<Calendar, "next_start" | "reason"> | null | undefined, now = new Date()): ClosedState {
  const start = new Date(calendar?.next_start || "");
  const known = !Number.isNaN(start.getTime());
  // Der Advent beginnt um Mitternacht in Wien - eine Stunde später gerechnet liegt der Tag sicher im Dezember.
  const year = viennaParts(known ? new Date(start.getTime() + 3600000) : now).year;
  if (calendar?.reason === "empty") {
    return { title: "Der Adventkalender macht Pause", text: "Heuer sind keine Türchen vorbereitet. Schau im nächsten Advent wieder vorbei.", paused: true, year };
  }
  if (!known) return { title: "Der Adventkalender ist zu", text: "Bis zum nächsten Advent!", paused: false, year };
  const days = Math.max(0, Math.ceil((start.getTime() - now.getTime()) / DAY_MS));
  const when = opensLabel(new Date(start.getTime() + 6 * 3600000).toISOString());
  const text = days === 0 ? "Heute um 6 Uhr geht das erste Türchen auf." : days === 1 ? `Morgen geht das erste Türchen auf – am ${when}.` : `Noch ${days} Tage: Das erste Türchen geht am ${when} auf.`;
  return { title: days <= 45 ? "Bald ist es so weit" : "Der Adventkalender ist zu", text, paused: false, year };
}

function Closed({ calendar }: { calendar: Calendar }) {
  const [width, setWidth] = useState(0);
  const state = useMemo(() => closedState(calendar), [calendar]);
  const xml = useMemo(() => sceneSvg(state.year, { filters: false }), [state.year]);
  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.floor(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== width) setWidth(measured);
  };
  return (
    <View style={styles.frame} testID="advent-closed">
      <View style={styles.closed} onLayout={onLayout}>
        {width > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <SvgXml xml={xml} width={width} height={CLOSED_HEIGHT} />
          </View>
        ) : null}
        <View style={styles.closedText}>
          <Text style={styles.closedTitle} accessibilityRole="header">{state.title}</Text>
          <Text style={styles.closedLine} testID="advent-closed-text">{state.text}</Text>
        </View>
      </View>
    </View>
  );
}

export function AdventCalendarScreen(_props: Props) {
  const still = useReduceMotion();
  const [busyDay, setBusyDay] = useState<number | null>(null);
  const [sheetDay, setSheetDay] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ein neuer Erfolg wartet, bis das Fenster mit dem Inhalt zu ist - zwei Fenster übereinander sieht niemand gern.
  // `occupied`: ein Türchen geht gerade auf oder sein Fenster ist offen.
  const waiting = useRef(false);
  const occupied = useRef(false);

  const onAwarded = useCallback(() => {
    if (occupied.current) waiting.current = true;
    else announceAchievementUnlocked();
  }, []);
  const { calendar, loading, error, signedIn, reload, open, answer, raffle } = useAdventCalendar(onAwarded);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (waiting.current) announceAchievementUnlocked();
  }, []);

  const celebrate = useCallback(() => {
    if (!waiting.current) return;
    waiting.current = false;
    announceAchievementUnlocked();
  }, []);

  const doors = calendar?.doors || [];
  const shown = sheetDay === null ? null : doors.find((door) => door.day === sheetDay && door.state === "opened") || null;

  const onOpen = useCallback(async (door: Door) => {
    setBusyDay(door.day);
    occupied.current = true;
    setNote("");
    try {
      await open(door.day);
      if (timer.current) clearTimeout(timer.current);
      const wait = still ? 0 : doorVariant(door.seed).swing + SHOW_AFTER_MS;
      timer.current = setTimeout(() => setSheetDay(door.day), wait);
    } catch (failure) {
      setNote(errorMessage(failure, `Türchen ${door.day} lässt sich gerade nicht öffnen. Versuch es noch einmal.`));
      // Der Server sieht es anders als die App (zum Beispiel ist der Kalender inzwischen zu): neu laden.
      const status = (failure as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 409) reload();
      occupied.current = false;
      celebrate();
    } finally {
      setBusyDay(null);
    }
  }, [celebrate, open, reload, still]);

  const onLocked = useCallback((door: Door) => setNote(`Türchen ${door.day} öffnet sich am ${opensLabel(door.opens_at)}.`), []);
  const onShow = useCallback((door: Door) => {
    setNote("");
    occupied.current = true;
    setSheetDay(door.day);
  }, []);
  const onClose = useCallback(() => {
    setSheetDay(null);
    occupied.current = false;
    celebrate();
  }, [celebrate]);
  const onLink = useCallback((url: string) => {
    // Führt die Adresse in einen Screen der App, macht das Fenster Platz.
    if (openDoorLink(url) === "screen") onClose();
  }, [onClose]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setNote("");
    await reload();
    setRefreshing(false);
  }, [reload]);

  const opened = calendar?.opened || 0;
  const complete = opened >= DOORS;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />} testID="advent-screen">
        <View style={styles.header}>
          <View style={styles.eyebrow}>
            <Ionicons name="calendar-outline" size={14} color={GOLD} />
            <Text style={styles.eyebrowText}>ADVENT</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header" testID="advent-title">Adventkalender{calendar?.active && calendar.year ? ` ${calendar.year}` : ""}</Text>
          <Text style={styles.lead}>
            {calendar?.active && calendar.catch_up
              ? "Alle 24 Türchen sind offen. Nachholen kannst du noch bis 6. Jänner."
              : "Jeden Tag um 6 Uhr geht ein neues Türchen auf. Was du verpasst hast, holst du bis 6. Jänner nach."}
          </Text>
        </View>

        {calendar?.active ? (
          <View style={styles.progress} testID="advent-progress">
            <View style={styles.progressTop}>
              <Text style={styles.progressLabel}>{signedIn ? "GESAMMELT" : "GEÖFFNET"}</Text>
              <Text style={styles.progressCount} testID="advent-count">{opened} von {DOORS}</Text>
            </View>
            <View style={styles.bar} accessibilityRole="progressbar" accessibilityLabel="Geöffnete Türchen" accessibilityValue={{ min: 0, max: DOORS, now: opened }}>
              <View style={[styles.barFill, { width: `${Math.min(100, (opened / DOORS) * 100)}%` }]} />
            </View>
            {complete ? <Text style={styles.complete} testID="advent-complete">Alle Türchen geöffnet – frohe Weihnachten!</Text> : null}
            {!signedIn && !complete ? (
              <View style={styles.guest} testID="advent-guest">
                <Text style={styles.guestText}>Du schaust als Gast. Gesammelt wird mit Konto – dann zählt jedes Türchen für den Erfolg „Alle Türchen“.</Text>
                <Pressable accessibilityRole="button" onPress={() => { openSignIn(); }} hitSlop={8} style={({ pressed }) => [styles.guestLink, pressed && styles.pressed]} testID="advent-login">
                  <Ionicons name="log-in-outline" size={15} color={GOLD} />
                  <Text style={styles.guestLinkText}>Anmelden</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {loading && !calendar ? (
          <View style={styles.state} testID="advent-loading">
            <ActivityIndicator color={GOLD} />
            <Text style={styles.stateText}>Lade Adventkalender</Text>
          </View>
        ) : null}
        {!loading && error && !calendar ? (
          <View style={styles.state} testID="advent-error">
            <Text style={styles.stateText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => { void reload(); }} style={({ pressed }) => [styles.retry, pressed && styles.pressed]} testID="advent-retry">
              <Ionicons name="refresh" size={15} color="#f4ecdc" />
              <Text style={styles.retryText}>NOCH EINMAL VERSUCHEN</Text>
            </Pressable>
          </View>
        ) : null}
        {calendar && !calendar.active ? <Closed calendar={calendar} /> : null}
        {calendar?.active ? (
          <>
            <AdventBoard calendar={calendar} busyDay={busyDay} still={still} onOpen={onOpen} onShow={onShow} onLocked={onLocked} />
            <Text style={styles.note} accessibilityLiveRegion="polite" testID="advent-note">{note}</Text>
          </>
        ) : null}
      </ScrollView>
      <DoorSheet door={shown} signedIn={signedIn} onClose={onClose} onAnswer={answer} onRaffle={raffle} onLink={onLink} onLogin={() => { openSignIn(); }} />
    </Screen>
  );
}

const CLOSED_HEIGHT = 380;

const styles = StyleSheet.create({
  content: { gap: 16, padding: 16, paddingBottom: 40 },
  header: { gap: 6 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 7 },
  eyebrowText: { color: GOLD, fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  title: { color: "#fff6e0", fontFamily: SERIF, fontSize: 32, lineHeight: 38, fontWeight: "600" },
  lead: { color: "rgba(255,255,255,0.66)", fontSize: 14.5, lineHeight: 21 },
  progress: { gap: 10, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.25)", backgroundColor: "rgba(255,255,255,0.03)" },
  progressTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  progressLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "800", letterSpacing: 2.2 },
  progressCount: { color: "#fff6e0", fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  bar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.09)", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: GOLD },
  complete: { color: GOLD, fontSize: 14, lineHeight: 20 },
  guest: { gap: 6 },
  guestText: { color: "rgba(255,255,255,0.62)", fontSize: 13.5, lineHeight: 20 },
  guestLink: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", minHeight: 32 },
  guestLinkText: { color: GOLD, fontSize: 14, fontWeight: "800" },
  state: { alignItems: "center", gap: 14, padding: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  stateText: { color: "rgba(255,255,255,0.72)", fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  retry: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.4)", backgroundColor: "rgba(255,255,255,0.05)" },
  retryText: { color: "#f4ecdc", fontSize: 12.5, fontWeight: "800", letterSpacing: 0.8 },
  note: { minHeight: 22, color: "#ffd98a", fontSize: 14, lineHeight: 20, textAlign: "center" },
  frame: { padding: 8, borderRadius: 14, backgroundColor: "#120e07", borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.42)" },
  closed: { height: CLOSED_HEIGHT, borderRadius: 8, overflow: "hidden", backgroundColor: "#0a1230", justifyContent: "flex-end" },
  closedText: { gap: 8, padding: 20, paddingTop: 36, backgroundColor: "rgba(3, 6, 15, 0.82)" },
  closedTitle: { color: "#fff6e0", fontFamily: SERIF, fontSize: 27, lineHeight: 32, fontWeight: "600" },
  closedLine: { color: "rgba(255,255,255,0.78)", fontSize: 15, lineHeight: 22 },
  pressed: { opacity: 0.78 },
});
