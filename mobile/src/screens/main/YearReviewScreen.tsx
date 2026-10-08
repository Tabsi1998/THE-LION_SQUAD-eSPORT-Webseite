import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { Button } from "../../components/Button";
import { FadeIn } from "../../components/FadeIn";
import { SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import {
  bestResultText,
  comparisonText,
  countWord,
  fastlapText,
  seasonText,
  shareYearCard,
  yearCardUrl,
  yearReviewPages,
  type YearReview,
  type YearReviewPage,
} from "../../lib/yearReview";
import type { AppStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Jahresrückblick „Dein Jahr bei LION“ (#1195) - wie im Web: Seiten zum Durchtippen (rechts tippen weiter, links
// zurück), nur Seiten mit Inhalt, am Ende das Bild zum Teilen. Die Seiten blenden sanft ein; mit „Bewegung
// reduzieren“ / „Animationen entfernen“ stehen sie sofort da (FadeIn). Den Rückblick sieht nur man selbst.

type Props = NativeStackScreenProps<AppStackParamList, "YearReview">;

function Big({ children, tone = "white" }: { children: React.ReactNode; tone?: "white" | "gold" | "cyan" }) {
  return <Title style={[styles.big, tone === "gold" && styles.gold, tone === "cyan" && styles.cyan]}>{children}</Title>;
}

function Eyebrow({ children, tone = "gold" }: { children: React.ReactNode; tone?: "gold" | "cyan" }) {
  return <Muted style={[styles.eyebrow, tone === "gold" ? styles.gold : styles.cyan]}>{children}</Muted>;
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.tile}>
      <Heading style={styles.tileValue}>{String(value)}</Heading>
      <Muted style={styles.tileLabel}>{label}</Muted>
    </View>
  );
}

function PageBody({ page, review, token }: { page: YearReviewPage; review: YearReview; token: string | null }) {
  const [message, setMessage] = useState("");
  const t = review.tournaments;
  switch (page) {
    case "intro":
      return (
        <View style={styles.page}>
          <Eyebrow>{`Dein Jahr bei ${review.club_name || "THE LION SQUAD"}`}</Eyebrow>
          <Big tone="gold">{String(review.year)}</Big>
          <Body style={styles.text}>Turniere, Siege, Events und Bestzeiten – tipp dich durch dein Jahr. Rechts tippen für weiter.</Body>
        </View>
      );
    case "tournaments":
      return (
        <View style={styles.page}>
          <Eyebrow>Turniere</Eyebrow>
          <Big>{String(t.count)}</Big>
          <Heading>{t.count === 1 ? "Turnier gespielt" : "Turniere gespielt"}</Heading>
          {comparisonText(review) ? <Muted testID="year-review-comparison">{comparisonText(review)}</Muted> : null}
          <View style={styles.tiles}>
            <Tile value={t.wins || 0} label={t.wins === 1 ? "Turniersieg" : "Turniersiege"} />
            <Tile value={t.podiums || 0} label="Podest" />
            <Tile value={t.games || 0} label="Spiele" />
          </View>
          {bestResultText(review) ? <Body style={styles.text}>{bestResultText(review)}</Body> : null}
        </View>
      );
    case "favorite":
      return (
        <View style={styles.page}>
          <Eyebrow>Lieblingsspiel</Eyebrow>
          <Title style={styles.name}>{review.favorite_game?.name || ""}</Title>
          <Body style={styles.text}>
            {[countWord(review.favorite_game?.tournaments || 0, "Turnier", "Turniere"), review.favorite_game?.games ? countWord(review.favorite_game.games, "Spiel", "Spiele") : null].filter(Boolean).join(" · ")}
          </Body>
        </View>
      );
    case "events":
      return (
        <View style={styles.page}>
          <Eyebrow>Events</Eyebrow>
          <Big>{String(review.events.count)}</Big>
          <Heading>{review.events.count === 1 ? "Event besucht" : "Events besucht"}</Heading>
          {(review.events.items || []).map((item) => (
            <View key={`${item.name}-${item.date}`} style={styles.listRow}>
              <Body style={styles.listName} numberOfLines={1}>{item.name}</Body>
              {item.date ? <Muted>{item.date}</Muted> : null}
            </View>
          ))}
        </View>
      );
    case "fastlap":
      return (
        <View style={styles.page}>
          <Eyebrow tone="cyan">Fast Lap</Eyebrow>
          <Big tone="cyan">{review.fastlap.best?.time || ""}</Big>
          <Heading>Deine Bestzeit</Heading>
          <Body style={styles.text}>{fastlapText(review)}</Body>
          {review.fastlap.count > 1 ? <Muted>{`${countWord(review.fastlap.count, "Strecke", "Strecken")} gefahren`}</Muted> : null}
        </View>
      );
    case "achievements":
      return (
        <View style={styles.page}>
          <Eyebrow>Erfolge</Eyebrow>
          <Big>{String(review.achievements.count)}</Big>
          <Heading>{review.achievements.count === 1 ? "neuer Erfolg" : "neue Erfolge"}</Heading>
          {(review.achievements.top || []).map((row) => (
            <View key={row.name} style={styles.listRow}>
              <View style={[styles.dot, { backgroundColor: row.material_color || colors.gold }]} />
              <Body style={styles.listName} numberOfLines={1}>{row.name}</Body>
              {row.material_name ? <Muted>{row.material_name}</Muted> : null}
            </View>
          ))}
        </View>
      );
    case "season":
      return (
        <View style={styles.page}>
          <Eyebrow>{review.season?.name || "Jahreswertung"}</Eyebrow>
          <Big tone="gold">{`Platz ${review.season?.rank}`}</Big>
          <Body style={styles.text}>{seasonText(review)}</Body>
        </View>
      );
    case "share":
      return (
        <View style={styles.page}>
          <Eyebrow tone="cyan">Zum Teilen</Eyebrow>
          <Heading>Dein Jahr als Bild</Heading>
          {token ? (
            <Image source={{ uri: yearCardUrl(review), headers: { Authorization: `Bearer ${token}` } }} style={styles.card} resizeMode="contain"
              accessibilityLabel={`Mein ${review.year} – Zusammenfassung`} testID="year-review-card" />
          ) : null}
          <Button label="Bild teilen" onPress={async () => {
            setMessage("");
            const result = await shareYearCard(review, token);
            if (result === "failed") setMessage("Teilen ging gerade nicht – versuch es gleich noch einmal.");
          }} testID="year-review-share" />
          {message ? <Muted style={styles.error}>{message}</Muted> : null}
        </View>
      );
    default:
      return null;
  }
}

export function YearReviewScreen({ navigation, route }: Props) {
  const preview = Boolean(route.params?.preview);
  const { accessToken } = useAuth();
  const [review, setReview] = useState<YearReview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get<YearReview>("/year-review/me", { params: preview ? { vorschau: true } : undefined })
      .then(({ data }) => { if (alive) { setReview(data); setState("ready"); } })
      .catch((error) => { if (alive) setState(error?.response?.status === 404 ? "none" : "error"); });
    return () => { alive = false; };
  }, [preview]);

  const pages = useMemo(() => yearReviewPages(review), [review]);
  const page = pages[index] || "intro";
  const go = useCallback((step: number) => setIndex((current) => Math.max(0, Math.min(pages.length - 1, current + step))), [pages.length]);
  const onTap = (event: GestureResponderEvent) => go(width && event.nativeEvent.locationX < width / 3 ? -1 : 1);

  if (state === "loading") {
    return <Screen><SkeletonList count={3} /></Screen>;
  }
  if (state !== "ready" || !review) {
    return (
      <Screen>
        <View style={styles.none} testID="year-review-none">
          <Heading>{state === "none" ? "Gerade kein Jahresrückblick" : "Rückblick gerade nicht erreichbar"}</Heading>
          <Muted>{state === "none" ? "Den Rückblick gibt es ab Mitte Dezember – für alle, die im Jahr gespielt, ein Event besucht oder eine Fast Lap gefahren haben." : "Bitte versuch es gleich noch einmal."}</Muted>
          <Button label="Zurück" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} style={styles.screen}>
      <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {pages.map((key, i) => <View key={key} style={[styles.bar, i <= index && styles.barDone]} testID={`year-review-bar-${i}`} />)}
      </View>
      <View style={styles.top}>
        <Body style={styles.topTitle}>{`Dein ${review.year}${review.preview ? " · Vorschau" : ""}`}</Body>
        <Muted testID="year-review-position">{`${index + 1} / ${pages.length}`}</Muted>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          onPress={onTap}
          onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
          accessibilityRole="button"
          accessibilityLabel={`Seite ${index + 1} von ${pages.length}. Tippen für weiter.`}
          testID="year-review-tap"
          style={styles.tap}
        >
          <FadeIn trigger={page}>
            <View testID={`year-review-page-${page}`}>
              <PageBody page={page} review={review} token={accessToken} />
            </View>
          </FadeIn>
        </Pressable>
      </ScrollView>
      <View style={styles.nav}>
        <View style={styles.navButton}><Button label="Zurück" variant="secondary" onPress={() => go(-1)} disabled={index === 0} testID="year-review-prev" /></View>
        <View style={styles.navButton}>
          {index >= pages.length - 1
            ? <Button label="Fertig" onPress={() => navigation.goBack()} testID="year-review-done" />
            : <Button label="Weiter" onPress={() => go(1)} testID="year-review-next" />}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#08090B" },
  bars: { flexDirection: "row", gap: 4, paddingHorizontal: 14, paddingTop: 10 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" },
  barDone: { backgroundColor: colors.white },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 10 },
  topTitle: { fontWeight: "800" },
  scroll: { flexGrow: 1 },
  tap: { flex: 1, minHeight: 440, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 16 },
  page: { gap: 12 },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.5, textTransform: "uppercase" },
  big: { fontSize: 64, lineHeight: 70, fontWeight: "900" },
  name: { fontSize: 34, lineHeight: 40, fontWeight: "900" },
  gold: { color: colors.gold },
  cyan: { color: colors.cyan },
  text: { color: "rgba(255,255,255,0.78)" },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 10 },
  tileValue: { color: colors.cyan, fontSize: 22 },
  tileLabel: { fontSize: 11, textTransform: "uppercase", fontWeight: "700" },
  listRow: { flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 6 },
  listName: { flex: 1, fontWeight: "700" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  card: { width: "100%", height: 360, borderRadius: 8 },
  error: { color: colors.live },
  nav: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 },
  navButton: { flex: 1 },
  none: { gap: 12, paddingTop: 24 },
});
