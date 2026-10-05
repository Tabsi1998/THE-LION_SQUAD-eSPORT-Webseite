import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useReduceMotion } from "../../components/FadeIn";
import { useAuth } from "../../auth/AuthContext";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { isGuestUser } from "../../live";
import { openSignIn } from "../../navigation/rootNavigation";
import { EggArt } from "../../seasons/easter/art";
import { fetchHuntPage, onHuntProgress, type HuntMe, type HuntPage } from "../../seasons/easterHunt/api";
import { colors } from "../../theme";
import { viennaDate } from "../../lib/vienna";

// Der Korb der Ostereiersuche (#647, wie /ostern im Web): Zeitraum, der eigene Korb mit den gefundenen Eiern in ihrem
// echten Muster und leeren Mulden für die fehlenden (ohne etwas zu verraten), Hinweise ab dem zweiten Tag, Preise,
// die Schnellsten, die Regeln. Gäste sehen alles außer dem Korb und werden zum Anmelden eingeladen.

const GOLD = "#e9c46a";

function dayLabel(iso?: string | null): string {
  const day = new Date(iso || "");
  if (Number.isNaN(day.getTime())) return "";
  return viennaDate(day, { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Vienna" });
}

/** „1 Std. 12 Min.“ - die Zeit bis zum vollen Korb (wie im Web). */
export function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? "Tag" : "Tage"}`);
  if (hours) parts.push(`${hours} Std.`);
  if (minutes || !parts.length) parts.push(`${minutes} Min.`);
  return parts.join(" ");
}

export function phaseText(page: Pick<HuntPage, "phase" | "starts_at" | "ends_at" | "next_start"> | null): string {
  switch (page?.phase) {
    case "upcoming":
      return `Die Suche beginnt am ${dayLabel(page.starts_at)} um 0 Uhr.`;
    case "running":
      return `Die Eier sind versteckt – gesucht wird bis ${dayLabel(page.ends_at)}, 23:59 Uhr.`;
    case "ended":
      return "Die Suche ist vorbei – ausgewertet wird in Kürze.";
    case "drawn":
      return "Die Suche ist ausgewertet. Wer gewonnen hat, wurde benachrichtigt.";
    default:
      return page?.next_start ? `Die nächste Eiersuche beginnt am ${dayLabel(page.next_start)}.` : "Gerade ist keine Eiersuche geplant.";
  }
}

/** Ein Ei im Korb: rollt sanft hinein (je Ei etwas später) - ohne Bewegung liegt es gleich da. */
function BasketEgg({ pattern, index, still }: { pattern: Parameters<typeof EggArt>[0]["pattern"]; index: number; still: boolean }) {
  const drop = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) return;
    Animated.timing(drop, { toValue: 1, duration: 450, delay: Math.min(index, 12) * 70, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [drop, index, still]);
  const translateY = drop.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] });
  const rotate = drop.interpolate({ inputRange: [0, 1], outputRange: ["-12deg", "0deg"] });
  return (
    <Animated.View style={{ opacity: drop, transform: [{ translateY }, { rotate }] }}>
      <EggArt pattern={pattern} size={30} />
    </Animated.View>
  );
}

/** Der Korb: gefundene Eier mit Muster, leere Mulden für die fehlenden - nie mehr verraten als die Zahl. */
function Basket({ me, total }: { me: HuntMe; total: number }) {
  const found = me.eggs || [];
  const still = useReduceMotion();
  return (
    <Card style={styles.basket} testID="hunt-basket">
      <View style={styles.basketHead}>
        <Heading style={styles.basketTitle}>Dein Korb</Heading>
        <Body style={styles.basketCount} testID="hunt-basket-count">{found.length} von {total}</Body>
      </View>
      <View style={styles.eggs}>
        {found.map((egg, index) => <View key={egg.egg_no} style={styles.slot} testID={`hunt-basket-egg-${egg.egg_no}`}><BasketEgg pattern={egg.pattern} index={index} still={still} /></View>)}
        {Array.from({ length: Math.max(0, total - found.length) }, (_, index) => <View key={`hole-${index}`} style={[styles.slot, styles.hole]} accessibilityLabel="Noch nicht gefunden" testID="hunt-basket-hole" />)}
      </View>
      {me.completed_at ? <Body style={styles.done} testID="hunt-basket-done">Korb voll – Platz {me.rank}! Du bist in der Verlosung.</Body> : <Muted>Die Eier liegen auf der Website und in der App – an Karten, beim Löwen, oben und unten. Antippen sammelt ein.</Muted>}
    </Card>
  );
}

export function EasterHuntScreen() {
  const { user } = useAuth();
  const signedIn = Boolean(user) && !isGuestUser(user);
  const [page, setPage] = useState<HuntPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try {
      setPage(await fetchHuntPage());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, user?.id]);
  // Ein Fund irgendwo in der App: der Korb holt sich den neuen Stand.
  useEffect(() => onHuntProgress(() => void load()), [load]);
  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };
  const running = page && page.phase !== "none";
  const total = Number(page?.egg_count) || 0;
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={GOLD} />}>
        <Muted style={styles.eyebrow}>{page?.year ? `Ostern ${page.year}` : "Ostern"}</Muted>
        <Title>Ostereiersuche</Title>
        {!page && !failed ? <ActivityIndicator color={GOLD} /> : null}
        {failed ? <Body style={styles.error}>Die Eiersuche lässt sich gerade nicht laden.</Body> : null}
        {page ? <Body style={styles.phase} testID="hunt-phase">{phaseText(page)}</Body> : null}
        {running && signedIn && page?.me?.active !== false && page?.me ? <Basket me={page.me} total={total} /> : null}
        {running && signedIn && page?.me && !page.me.completed_at && (page.me.hints || []).length ? (
          <Card style={styles.card} testID="hunt-hints">
            <Heading style={styles.cardTitle}>Hinweise</Heading>
            {(page.me.hints || []).map((hint, index) => <Body key={index} style={styles.line}>• {hint.hint}{hint.channel === "web" ? " (Website)" : ""}</Body>)}
          </Card>
        ) : null}
        {running && signedIn && page?.me && !page.me.completed_at && !page.me.hints_open && page.me.hints_open_at ? (
          <Muted style={styles.line} testID="hunt-hints-later">Ab {dayLabel(page.me.hints_open_at)} gibt es zu jedem fehlenden Ei einen Hinweis.</Muted>
        ) : null}
        {running && !signedIn ? (
          <Card style={styles.card} testID="hunt-guest">
            <Body>Mitsuchen kann, wer ein Konto hat – dann zählt jedes Ei, und ein voller Korb kommt in die Verlosung.</Body>
            <Pressable onPress={() => { openSignIn(); }} accessibilityRole="button" style={styles.cta}>
              <Ionicons name="log-in-outline" color="#000" size={16} />
              <Body style={styles.ctaText}>Anmelden</Body>
            </Pressable>
          </Card>
        ) : null}
        {running && (page?.prizes || []).length ? (
          <Card style={styles.card} testID="hunt-prizes">
            <Heading style={styles.cardTitle}>Preise</Heading>
            {(page?.prizes || []).map((prize) => (
              <View key={prize.kind} style={styles.prize}>
                <Muted style={styles.prizeKind}>{prize.title || prize.kind}</Muted>
                <Body style={styles.prizeLabel}>{prize.label}</Body>
                {prize.value ? <Muted>Wert: {prize.value}</Muted> : null}
              </View>
            ))}
          </Card>
        ) : null}
        {running && (page?.fastest || []).length ? (
          <Card style={styles.card} testID="hunt-fastest">
            <Heading style={styles.cardTitle}>Die Schnellsten mit vollem Korb</Heading>
            {(page?.fastest || []).map((row) => (
              <View key={`${row.rank}-${row.username}`} style={styles.fastest} testID={`hunt-fastest-${row.rank}`}>
                <Body style={styles.rank}>{row.rank}</Body>
                <Body style={styles.name}>{row.display_name || row.username}</Body>
                <Muted>{durationLabel(row.duration_seconds)}</Muted>
              </View>
            ))}
            <Muted style={styles.note}>Hier stehen nur Personen, deren Profil und Erfolge öffentlich sind. Insgesamt {page?.completed || 0} mit vollem Korb.</Muted>
          </Card>
        ) : null}
        {running && (page?.terms || []).length ? (
          <Card style={styles.card} testID="hunt-terms">
            <Heading style={styles.cardTitle}>So läuft die Suche</Heading>
            {(page?.terms || []).map((term) => <Body key={term} style={styles.line}>• {term}</Body>)}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 32 },
  eyebrow: { color: GOLD, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase" },
  phase: { color: "rgba(255,255,255,0.78)" },
  error: { color: colors.live, fontWeight: "800" },
  basket: { gap: 12, borderColor: "rgba(233, 196, 106, 0.35)", backgroundColor: "#16140d" },
  basketHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  basketTitle: { color: "#fff6e0" },
  basketCount: { color: GOLD, fontWeight: "800" },
  eggs: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  slot: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  hole: { borderWidth: 1.5, borderStyle: "dashed", borderColor: "rgba(233, 196, 106, 0.35)", borderRadius: 16, backgroundColor: "rgba(233, 196, 106, 0.04)" },
  done: { color: "#ffd700", fontWeight: "800" },
  card: { gap: 8 },
  cardTitle: { color: colors.white },
  line: { color: "rgba(255,255,255,0.82)" },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  ctaText: { color: "#000", fontWeight: "800" },
  prize: { gap: 2, paddingVertical: 4 },
  prizeKind: { color: GOLD, fontWeight: "800", textTransform: "uppercase", fontSize: 11 },
  prizeLabel: { fontWeight: "800" },
  fastest: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  rank: { color: GOLD, fontWeight: "900", width: 18 },
  name: { flex: 1, fontWeight: "700" },
  note: { fontSize: 12 },
});
