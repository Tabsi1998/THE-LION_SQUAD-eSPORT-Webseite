import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, Easing, Linking, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { WEB_BASE_URL } from "../../advent/links";
import { BrandLogo } from "../../components/BrandLogo";
import { Body } from "../../components/Text";
import { useScreenFocused } from "../anchors";
import { TAB_BAR } from "../halloween";
import { screenClass, seasonCapabilities } from "../intensity";
import { anyOverlayOpen, subscribeQuiet } from "../quiet";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { CARD_LIGHTS, TOAST_DELAY_MS, TOAST_MS, greetingFor, greetingShownToday, linkTarget, markGreetingShown, starField, yearSaltFor, type Greeting, type Star } from "./greeting";
import { useCardDecoAssignments } from "../cardDeco";
import { useCardKey } from "../useCardLift";
import { GlowDot, LAYER_HEIGHT, LightChain, pulseCurve, useChainSwing, type ChainMode } from "./LightChain";
import { COLORS, HEADER_BAND, chainLayout, type BulbColor } from "./lights";

// Weihnachten in der App (S11, #642 - wie S8, X1, X2, X4 im Web): vom 24. bis 26. Dezember hängt die Lichterkette an
// der Unterkante der Begrüßungskarte im Dashboard - dem Kopf der App, wo auch Kranz und Schneeflocke sitzen -, hinter
// dem Inhalt liegen warme Lichtinseln, und einmal je Tag kommt der Gruß als Karte des Vereins über der Tab-Leiste:
// Logo, Sternenlicht, Lichterfolge, der Text des Tages aus dem Admin; antippen oder nach 14 s geht er. Am 6. Jänner
// ein letzter Gruß zum Abschied. „Bewegung reduzieren“ und „dezent“: Kette und Karte ohne Glimmen und Wind.

/** Der Wind des Wetters für das Schwingen der Kette - wie `--season-wind` im Web, ohne Wetter 0,6. */
export function chainWind(windFactor: number | null | undefined): number {
  const value = Number(windFactor);
  return windFactor === null || windFactor === undefined || !Number.isFinite(value) ? 0.6 : Math.max(0, Math.min(2, value));
}

/**
 * Die Kette an der Unterkante der Begrüßungskarte: nur an den Feiertagen, nie auf stillen Screens, nie klickbar. Wird die
 * Karte angetippt, schwingt sie nach (Jahreszeiten IV, #1091).
 */
export function ChristmasEdge({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { weather } = useSeason();
  const focused = useScreenFocused();
  const cardKey = useCardKey();
  const [width, setWidth] = useState(0);
  const caps = useMemo(() => seasonCapabilities("christmas", screen, season.effective), [screen, season.effective]);
  const salt = yearSaltFor(season);
  const layout = useMemo(() => (width > 0 ? chainLayout({ width, year: salt, anchor: "header" }) : null), [width, salt]);
  const shown = season.phase === "gruss" && Boolean(caps.chain);
  const swing = useChainSwing(shown ? cardKey : null, layout);
  if (!shown) return null;
  const mode: ChainMode = season.effective === "subtle" ? "subtle" : focused ? "glimmer" : "still";
  return (
    <View pointerEvents="none" style={styles.edge} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} testID="christmas-edge">
      {layout ? <LightChain layout={layout} mode={mode} wind={chainWind(weather?.wind_factor)} swing={swing} /> : null}
    </View>
  );
}

/**
 * Ketten an Karten (Jahreszeiten IV, Variante B, #1091): an den Feiertagen hängt an einigen Karten des Screens eine
 * kleine Kette im unteren Innenabstand (cardDeco.tsx wählt sie aus) - zusätzlich zur Kette an der Begrüßungskarte.
 */
export function ChristmasCorners({ season, screen }: { season: ActiveSeason; screen: string }) {
  const caps = useMemo(() => seasonCapabilities("christmas", screen, season.effective), [screen, season.effective]);
  useCardDecoAssignments(season, screen, "chain", season.phase === "gruss" && Boolean(caps.chain));
  return null;
}

/** Warme Lichtinseln hinter dem Inhalt (X2): oben links, oben rechts und unten - nur an den Feiertagen, nie bei „dezent“. */
export function ChristmasBackdrop({ season, screen }: { season: ActiveSeason; screen: string }) {
  const caps = useMemo(() => seasonCapabilities("christmas", screen, season.effective), [screen, season.effective]);
  if (season.phase !== "gruss" || !caps.glow || season.effective === "subtle") return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="christmas-glow">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="xmasIslandLeft" cx="18%" cy="6%" rx="34%" ry="26%">
            <Stop offset="0" stopColor="#ffbe78" stopOpacity={0.09} />
            <Stop offset="0.7" stopColor="#ffbe78" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="xmasIslandRight" cx="82%" cy="8%" rx="30%" ry="24%">
            <Stop offset="0" stopColor="#ffaa64" stopOpacity={0.07} />
            <Stop offset="0.7" stopColor="#ffaa64" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="xmasIslandBottom" cx="50%" cy="100%" rx="60%" ry="30%">
            <Stop offset="0" stopColor="#ffb46e" stopOpacity={0.07} />
            <Stop offset="0.7" stopColor="#ffb46e" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#xmasIslandLeft)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#xmasIslandRight)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#xmasIslandBottom)" />
      </Svg>
    </View>
  );
}

/** Ein Stern der Karte: glimmt in 3,6 s zwischen schwach und hell, je Stern versetzt; ruhig ohne Bewegung. */
function CardStar({ star, still, reduced }: { star: Star; still: boolean; reduced: boolean }) {
  const twinkle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return undefined;
    const animation = Animated.loop(Animated.timing(twinkle, { toValue: 1, duration: 3600, easing: Easing.linear, useNativeDriver: true }));
    const handle = setTimeout(() => animation.start(), Math.round(star.delay * 1000));
    return () => {
      clearTimeout(handle);
      animation.stop();
    };
  }, [still, star.delay, twinkle]);
  const opacity = still ? (reduced ? 0.6 : 0.9) : twinkle.interpolate(pulseCurve(0.25, 0.9));
  return <Animated.View style={[styles.star, { left: `${star.x}%`, top: `${star.y}%`, width: star.size, height: star.size, borderRadius: star.size / 2, opacity }]} />;
}

/** Ein Licht der Lichterfolge: geht nacheinander an (kurz größer), danach glimmt es sanft. */
function CardLight({ color, index, still }: { color: BulbColor; index: number; still: boolean }) {
  const on = useRef(new Animated.Value(still ? 1 : 0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) {
      on.setValue(1);
      return undefined;
    }
    on.setValue(0);
    const switchOn = Animated.timing(on, { toValue: 1, duration: 500, delay: 350 + index * 280, easing: Easing.out(Easing.quad), useNativeDriver: true });
    const breathe = Animated.loop(Animated.timing(glow, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true }));
    switchOn.start();
    const handle = setTimeout(() => breathe.start(), 2800 + index * 400);
    return () => {
      clearTimeout(handle);
      switchOn.stop();
      breathe.stop();
    };
  }, [still, index, on, glow]);
  const opacity = still ? 1 : Animated.multiply(on.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.25, 1, 1] }), glow.interpolate(pulseCurve(1, 0.7)));
  const scale = still ? 1 : on.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.85, 1.15, 1] });
  return (
    <Animated.View style={[styles.cardLight, { opacity, transform: [{ scale }] }]} testID="christmas-card-light">
      <View style={styles.cardLightGlow}>
        <GlowDot radius={13} color={color} id={`xmasCardLight${index}`} />
      </View>
      <View style={[styles.cardLightBody, { backgroundColor: COLORS[color] }]} />
    </Animated.View>
  );
}

/** Die Karte selbst: Sternenlicht, Lichterfolge, Logo, Titel des Tages, Text und - beim Abschied - ein Link. */
export function GreetingCard({ greeting, year, still, reduced, onClose }: { greeting: Greeting; year: string; still: boolean; reduced: boolean; onClose: () => void }) {
  const enter = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) return undefined;
    const animation = Animated.timing(enter, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [enter, still]);
  const stars = useMemo(() => starField(year), [year]);
  const link = linkTarget(greeting.link, WEB_BASE_URL);
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return (
    <Animated.View style={[styles.card, { opacity: enter, transform: [{ translateY }] }]} testID="christmas-greeting" accessibilityLiveRegion="polite">
      <Pressable onPress={onClose} accessible={false} testID="christmas-greeting-card">
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="xmasCardSky" cx="20%" cy="0%" rx="113%" ry="141%">
                <Stop offset="0" stopColor="#14202c" />
                <Stop offset="0.7" stopColor="#0a0d12" />
                <Stop offset="1" stopColor="#0a0d12" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#xmasCardSky)" />
          </Svg>
          {stars.map((star) => <CardStar key={star.index} star={star} still={still} reduced={reduced} />)}
        </View>
        <View style={styles.cardLights} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {CARD_LIGHTS.map((color, index) => <CardLight key={index} color={color} index={index} still={still} />)}
        </View>
        <View style={styles.cardBody}>
          <BrandLogo variant="mascot" style={styles.cardLogo} testID="christmas-greeting-logo" />
          <View style={styles.cardTexts}>
            <Body style={styles.cardTitle} testID="christmas-greeting-title">{greeting.title}</Body>
            <Body style={styles.cardText} testID="christmas-greeting-text">{greeting.text}</Body>
            {link ? (
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(link).catch(() => {})} hitSlop={6} testID="christmas-greeting-link">
                <Body style={styles.cardLink}>Zum Jahresrückblick</Body>
              </Pressable>
            ) : null}
          </View>
          {/* Wie im Web im Textteil: so liegt das Kreuz nicht auf dem letzten Licht der Lichterfolge. */}
          <Pressable accessibilityRole="button" accessibilityLabel="Gruß schließen" onPress={onClose} hitSlop={8} style={styles.cardClose} testID="christmas-greeting-close">
            <Body style={styles.cardCloseText}>×</Body>
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

type GreetingState = "waiting" | "open" | "done";

/**
 * Der Gruß über der Tab-Leiste: einmal je Tag und Phase, 1,5 s nach dem Start, 14 s lang. Nicht auf stillen Screens
 * (Einstellungen, Sperre) und nicht, solange ein Dialog offen ist - dann kommt er, sobald es wieder ruhig ist.
 * Kommt die App an einem neuen Tag zurück in den Vordergrund, gilt der neue Tag.
 */
export function ChristmasGreeting({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { reducedMotion } = useSeason();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const key = `christmas-${season.phase || "gruss"}`;
  const [state, setState] = useState<GreetingState>("waiting");
  // Der Tag der Karte gilt ab dem Öffnen - bleibt die App über Nacht offen, kommt morgens der Text des neuen Tages.
  const [openedAt, setOpenedAt] = useState(0);
  const [covered, setCovered] = useState(() => anyOverlayOpen());
  useEffect(() => subscribeQuiet((quiet) => setCovered(quiet.overlays.length > 0)), []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setState((current) => (current === "done" ? "waiting" : current));
    });
    return () => subscription.remove();
  }, []);
  const allowed = screenClass(screen) !== "quiet" && !covered;
  useEffect(() => {
    if (state === "done") return undefined;
    if (!allowed) {
      if (state === "open") setState("done");
      return undefined;
    }
    if (state === "open") {
      const hide = setTimeout(() => setState("done"), TOAST_MS);
      return () => clearTimeout(hide);
    }
    let cancelled = false;
    let show: ReturnType<typeof setTimeout> | null = null;
    void greetingShownToday(key).then((shown) => {
      if (cancelled) return;
      if (shown) {
        setState("done");
        return;
      }
      show = setTimeout(() => {
        if (cancelled) return;
        void markGreetingShown(key);
        setOpenedAt(Date.now());
        setState("open");
      }, TOAST_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (show) clearTimeout(show);
    };
  }, [allowed, key, state]);
  const greeting = useMemo(() => greetingFor(season, openedAt ? new Date(openedAt) : new Date()), [season, openedAt]);
  if (state !== "open") return null;
  const still = season.effective === "subtle" || reducedMotion;
  return (
    <View pointerEvents="box-none" style={[styles.greetingWrap, { bottom: TAB_BAR + Math.max(insets.bottom, 8) + 12, width: Math.min(width - 32, 480), left: Math.max(16, (width - 480) / 2) }]}>
      <GreetingCard greeting={greeting} year={yearSaltFor(season)} still={still} reduced={reducedMotion} onClose={() => setState("done")} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Das Band beginnt 16 Punkte über der Unterkante der Karte; Lämpchen und Schein reichen ein wenig darüber hinaus.
  edge: { position: "absolute", left: 0, right: 0, bottom: HEADER_BAND - LAYER_HEIGHT, height: LAYER_HEIGHT },
  greetingWrap: { position: "absolute" },
  card: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(255, 200, 140, 0.35)", backgroundColor: "#0a0d12", overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.55, shadowRadius: 25, shadowOffset: { width: 0, height: 18 }, elevation: 12 },
  star: { position: "absolute", backgroundColor: "#fff7dc" },
  cardLights: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, paddingHorizontal: 18 },
  cardLight: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  cardLightGlow: { position: "absolute", left: 0, top: 0 },
  cardLightBody: { width: 9, height: 12, borderRadius: 4.5 },
  cardBody: { flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 10, paddingRight: 42, paddingBottom: 18, paddingLeft: 18 },
  cardLogo: { width: 44, height: 44 },
  cardTexts: { flex: 1, minWidth: 0 },
  cardTitle: { color: "#ffc857", fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  cardText: { color: "#fff4e6", fontSize: 16, lineHeight: 22, marginTop: 2 },
  cardLink: { color: "#29B6E8", fontSize: 13.5, marginTop: 6, textDecorationLine: "underline" },
  cardClose: { position: "absolute", top: 4, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255, 255, 255, 0.06)", alignItems: "center", justifyContent: "center" },
  cardCloseText: { color: "#fff4e6", fontSize: 20, lineHeight: 22 },
});
