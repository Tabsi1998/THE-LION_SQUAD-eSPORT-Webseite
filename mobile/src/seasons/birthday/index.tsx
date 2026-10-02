import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Line, Path, Pattern, Polyline, Rect, Stop, Text as SvgText } from "react-native-svg";
import { useAuth } from "../../auth/AuthContext";
import { BrandLogo } from "../../components/BrandLogo";
import { Body } from "../../components/Text";
import { api } from "../../lib/api";
import { stickerSource } from "../../lib/stickers";
import { Fire } from "../advent/WreathSvg";
import { useScreenFocused } from "../anchors";
import { CLUB_PALETTE } from "../carnival/confetti";
import { ConfettiField, requestConfettiBurst } from "../carnival";
import { capForApp } from "../carnival/sky";
import { greetingShownToday, markGreetingShown } from "../christmas/greeting";
import { TAB_BAR } from "../halloween";
import { screenClass } from "../intensity";
import { anyOverlayOpen, subscribeQuiet } from "../quiet";
import { seasonRng, seasonYear } from "../rng";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { BOTTOM, CAKE_VIEW, CLUB, PLATE, TOP, cakePlan, ignitionOrder, type CakeCandle, type CakePlan, type DigitCandle } from "./cake";

// Vereinsgeburtstag in der App (S13 #644, B1–B3 #749–#751), wie im Web (frontend/src/seasons/birthday): einmal am Tag
// die Karte mit der Torte über der Tab-Leiste - Kerzen nach Jahren gehen nacheinander an, dann ein leichtes Tippen und
// Konfetti in Vereinsfarben aus der Torte; Mitglieder holen sich dort ihren Jahres-Sticker. An der Unterkante der
// Begrüßungskarte hängt eine Wimpelkette, die sich beim ersten Mal entfaltet und dann kaum weht. „dezent“ und
// „Bewegung reduzieren“: die Kerzen brennen gleich, kein Konfetti, die Wimpel hängen still.

export const GREETING_KEY = "club-birthday-greeting";
export const CARD_DELAY_MS = 1200;
export const CARD_MS = 20000;
export const IGNITE_DELAY_MS = 700;
export const IGNITE_STEP_MS = 220;
const BURST = 30;
const CANDLE_WIDTH = 3.2;
const EDGE_BAND = 16;
const PENNANT_STEP = 18;
const PENNANT_COLORS = [CLUB.cyan, CLUB.gold, CLUB.white];

// Je Start der App nur einmal: entfaltet ist entfaltet.
const once = { unfolded: false };

/** Für Tests: alles wie beim Start der App. */
export function resetBirthdayState(): void {
  once.unfolded = false;
}

export function yearOf(season: Pick<ActiveSeason, "starts_at"> | null | undefined): number {
  return seasonYear({ key: "club_birthday", starts_at: season?.starts_at || "" });
}

export function yearsOf(season: Pick<ActiveSeason, "data"> | null | undefined): number | null {
  const years = Number((season?.data as { years?: unknown } | undefined)?.years);
  return Number.isFinite(years) && years > 0 ? Math.round(years) : null;
}

/** Der Text unter „8 Jahre“ - wie im Web: beginnt der Gruß selbst mit den Jahren, steht nur der Rest da. */
export function cardText(greeting: string, years: number | null): string {
  const text = String(greeting || "").trim();
  if (!years || !text.toLowerCase().startsWith(`${years} jahr`)) return text;
  const dash = text.search(/\s[–-]\s/);
  const rest = dash > 0 ? text.slice(dash + 3).trim() : "";
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : text;
}

/** Konfetti nur aus der Torte (kein Regen), in Vereinsfarben. */
export function BirthdaySky({ season, screen, reducedMotion }: { season: ActiveSeason; screen: string; reducedMotion: boolean }) {
  return <ConfettiField cap={reducedMotion ? 0 : capForApp(season.effective)} screen={screen} palette={CLUB_PALETTE} burstSize={BURST} seedKey="birthday" />;
}

/** Kerzen nacheinander anzünden; `onDone`, wenn alle brennen. Ohne Bewegung brennen alle sofort, ohne Feier. */
export function useIgnition(plan: CakePlan, moving: boolean, onDone: () => void): { lit: Set<number>; lighting: Set<number> } {
  const items: Array<{ index: number }> = plan.numbers ? plan.digits : plan.candles;
  const [lit, setLit] = useState<Set<number>>(() => (moving ? new Set() : new Set(items.map((item) => item.index))));
  const [lighting, setLighting] = useState<Set<number>>(() => new Set());
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!moving) {
      setLit(new Set(items.map((item) => item.index)));
      return undefined;
    }
    const order = ignitionOrder(plan, IGNITE_STEP_MS);
    const timers = order.flatMap(({ index, at }) => [
      setTimeout(() => {
        setLit((current) => new Set(current).add(index));
        setLighting((current) => new Set(current).add(index));
      }, IGNITE_DELAY_MS + at),
      setTimeout(() => setLighting((current) => {
        const next = new Set(current);
        next.delete(index);
        return next;
      }), IGNITE_DELAY_MS + at + 1500),
    ]);
    const last = order.length ? order[order.length - 1].at : 0;
    timers.push(setTimeout(() => done.current(), IGNITE_DELAY_MS + last + 500));
    return () => timers.forEach((timer) => clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, moving]);
  return { lit, lighting };
}

function CandleShape({ candle, lit }: { candle: CakeCandle; lit: boolean }) {
  const top = candle.base - candle.height;
  return (
    <G transform={`rotate(${candle.lean} ${candle.x} ${candle.base})`}>
      <Rect x={candle.x - CANDLE_WIDTH / 2} y={top} width={CANDLE_WIDTH} height={candle.height} rx={0.7} fill={`url(#cakeStripe${candle.stripe})`} stroke="rgba(0, 0, 0, 0.25)" strokeWidth={0.2} />
      <Line x1={candle.x} y1={top} x2={candle.x} y2={top - 1.4} stroke={lit ? "#3b2414" : "#5f5a54"} strokeWidth={0.6} strokeLinecap="round" />
    </G>
  );
}

function DigitShape({ candle, lit }: { candle: DigitCandle; lit: boolean }) {
  const top = candle.base - 14.2;
  return (
    <G transform={`rotate(${candle.lean} ${candle.x} ${candle.base})`}>
      <SvgText x={candle.x} y={candle.base} textAnchor="middle" fontSize={19} fontWeight="900" fill={`url(#cakeWax${candle.color})`} stroke="#0b2233" strokeWidth={0.6}>{candle.digit}</SvgText>
      <Line x1={candle.x} y1={top} x2={candle.x} y2={top - 1.4} stroke={lit ? "#3b2414" : "#5f5a54"} strokeWidth={0.6} strokeLinecap="round" />
    </G>
  );
}

/** Die Torte: SVG, darüber die Flammen (wie am Kranz) und das Maskottchen auf der Zuckerplatte. */
export function BirthdayCake({ plan, lit, lighting, still, width = 120 }: { plan: CakePlan; lit: Set<number>; lighting: Set<number>; still: boolean; width?: number }) {
  const k = width / CAKE_VIEW.width;
  const height = CAKE_VIEW.height * k;
  const plateBox = PLATE.r * Math.SQRT2 * k;
  const flames = plan.numbers
    ? plan.digits.map((candle) => ({ candle: { ...candle, y: candle.base }, height: 14.2 }))
    : plan.candles.map((candle) => ({ candle: { ...candle, y: candle.base }, height: candle.height }));
  return (
    <View style={{ width, height }} testID="birthday-cake" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height} viewBox={`0 0 ${CAKE_VIEW.width} ${CAKE_VIEW.height}`}>
        <Defs>
          <LinearGradient id="cakeLow" x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor="#0a1e2c" />
            <Stop offset="0.45" stopColor="#123f59" />
            <Stop offset="1" stopColor="#081822" />
          </LinearGradient>
          <LinearGradient id="cakeHigh" x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor="#e6e0d4" />
            <Stop offset="0.4" stopColor={CLUB.white} />
            <Stop offset="1" stopColor="#d4ccbd" />
          </LinearGradient>
          <LinearGradient id="cakeGold" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor="#ffe66b" />
            <Stop offset="1" stopColor="#d9a900" />
          </LinearGradient>
          <LinearGradient id="cakeCyan" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor="#7fd6f5" />
            <Stop offset="1" stopColor={CLUB.cyan} />
          </LinearGradient>
          <LinearGradient id="cakeWaxcyan" x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor="#bfeaf9" />
            <Stop offset="0.5" stopColor={CLUB.cyan} />
            <Stop offset="1" stopColor="#1c86ab" />
          </LinearGradient>
          <LinearGradient id="cakeWaxgold" x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor="#fff2a8" />
            <Stop offset="0.5" stopColor={CLUB.gold} />
            <Stop offset="1" stopColor="#c9a800" />
          </LinearGradient>
          {(["cyan", "gold"] as const).map((name) => (
            <Pattern key={name} id={`cakeStripe${name}`} width={2.4} height={2.4} patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
              <Rect width={2.4} height={2.4} fill="#fbf7ef" />
              <Rect width={1} height={2.4} fill={CLUB[name]} />
            </Pattern>
          ))}
        </Defs>
        <Ellipse cx={60} cy={95} rx={53} ry={6.5} fill="#141a26" />
        <Path d={`M ${BOTTOM.cx - BOTTOM.rx} ${BOTTOM.y} L ${BOTTOM.cx - BOTTOM.rx} ${BOTTOM.y + BOTTOM.height} A ${BOTTOM.rx} ${BOTTOM.ry} 0 0 0 ${BOTTOM.cx + BOTTOM.rx} ${BOTTOM.y + BOTTOM.height} L ${BOTTOM.cx + BOTTOM.rx} ${BOTTOM.y} Z`} fill="url(#cakeLow)" />
        {plan.band === "dots"
          ? Array.from({ length: 13 }, (_, i) => <Circle key={i} cx={22 + i * 6.3} cy={BOTTOM.y + BOTTOM.height + 3.4 - Math.abs(6 - i) * 0.35} r={1.1} fill={CLUB.white} opacity={0.9} />)
          : <Polyline points={Array.from({ length: 15 }, (_, i) => `${20 + i * 5.7},${BOTTOM.y + BOTTOM.height + (i % 2 ? 1.2 : 4.2) - Math.abs(7 - i) * 0.3}`).join(" ")} fill="none" stroke={CLUB.cyan} strokeWidth={1.1} strokeLinejoin="round" />}
        <Path d={plan.bottomDrips} fill="url(#cakeGold)" />
        <Path d={`M ${TOP.cx - TOP.rx} ${TOP.y} L ${TOP.cx - TOP.rx} ${TOP.y + TOP.height} A ${TOP.rx} ${TOP.ry} 0 0 0 ${TOP.cx + TOP.rx} ${TOP.y + TOP.height} L ${TOP.cx + TOP.rx} ${TOP.y} Z`} fill="url(#cakeHigh)" />
        <Path d={plan.topDrips} fill="url(#cakeCyan)" />
        {plan.sprinkles.map((dot, index) => <Rect key={index} x={dot.x - 0.9} y={dot.y - 0.3} width={1.8} height={0.6} rx={0.3} fill={dot.color} transform={`rotate(${dot.angle} ${dot.x} ${dot.y})`} />)}
        <Circle cx={PLATE.cx} cy={PLATE.cy} r={PLATE.r} fill="#0b1520" stroke="url(#cakeGold)" strokeWidth={1.6} />
        {plan.candles.map((candle) => <CandleShape key={candle.index} candle={candle} lit={lit.has(candle.index)} />)}
        {plan.digits.map((candle) => <DigitShape key={candle.index} candle={candle} lit={lit.has(candle.index)} />)}
      </Svg>
      <View pointerEvents="none" style={[styles.plate, { left: PLATE.cx * k - plateBox / 2, top: PLATE.cy * k - plateBox / 2, width: plateBox, height: plateBox }]}>
        <BrandLogo variant="mascot" style={styles.plateImage} testID="birthday-mascot" />
      </View>
      {flames.map(({ candle, height: candleHeight }) => (lit.has(candle.index) ? (
        <Fire key={candle.index} candle={candle} height={candleHeight} lighting={lighting.has(candle.index)} calm={false} still={still} wind={0.6} fit={{ k, ox: 0, oy: 0 }} testID="birthday-flame" />
      ) : null))}
    </View>
  );
}

type StickerState = { active: boolean; member: boolean; claimed: boolean; sticker: { url: string; name: string; pack_name?: string } | null };

/** Der Jahres-Sticker für Mitglieder (wie im Web): abholen, dann zeigen, wo er im Chat liegt. */
export function BirthdaySticker() {
  const { user } = useAuth();
  const [state, setState] = useState<StickerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!user?.id) return undefined;
    let alive = true;
    api.get<StickerState>("/seasonal/birthday").then(({ data }) => alive && setState(data || null)).catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [user?.id]);
  if (!state?.active || !state.member) return null;
  if (state.claimed && state.sticker) {
    return (
      <View style={styles.sticker} testID="birthday-sticker">
        <Image source={stickerSource(state.sticker.url) || undefined} style={styles.stickerImage} accessibilityLabel={state.sticker.name} />
        <View style={styles.flex}>
          <Body style={styles.stickerTitle}>{fresh ? "Dein Jahres-Sticker!" : "Dein Jahres-Sticker"}</Body>
          <Body style={styles.stickerText}>Im Chat unter „{state.sticker.pack_name || "Zum Vereinsgeburtstag"}“.</Body>
        </View>
      </View>
    );
  }
  if (state.claimed) return null;
  const claim = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<{ new?: boolean; sticker: StickerState["sticker"] }>("/seasonal/birthday/sticker");
      setFresh(Boolean(data?.new));
      setState((current) => (current ? { ...current, claimed: true, sticker: data?.sticker || null } : current));
      void Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {});
    } catch {
      // Ohne Netz bleibt der Knopf - noch einmal tippen.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pressable onPress={() => void claim()} disabled={busy} accessibilityRole="button" accessibilityLabel="Jahres-Sticker abholen" style={({ pressed }) => [styles.claim, pressed && styles.pressed]} testID="birthday-sticker-claim">
      <Body style={styles.claimText}>{busy ? "Einen Moment …" : "Jahres-Sticker abholen"}</Body>
    </Pressable>
  );
}

/** Die Karte einmal am Tag über der Tab-Leiste - nicht auf stillen Screens und nicht unter einem offenen Fenster. */
export function BirthdayGreeting({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { reducedMotion } = useSeason();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [covered, setCovered] = useState(() => anyOverlayOpen());
  useEffect(() => subscribeQuiet((quiet) => setCovered(quiet.overlays.length > 0)), []);
  const allowed = screenClass(screen) !== "quiet" && !covered;
  const years = yearsOf(season);
  const plan = useMemo(() => cakePlan(years, yearOf(season)), [years, season]);
  const greeting = season.texts?.greeting || (years ? `${years} Jahre THE LION SQUAD – danke, dass ihr dabei seid` : "Der Verein hat Geburtstag – danke, dass ihr dabei seid");
  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void greetingShownToday(GREETING_KEY).then((shown) => {
      if (cancelled || shown) return;
      timer = setTimeout(() => {
        void markGreetingShown(GREETING_KEY);
        setOpen(true);
      }, CARD_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [allowed]);
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => setOpen(false), CARD_MS);
    return () => clearTimeout(timer);
  }, [open]);
  if (!open || !allowed) return null;
  const moving = season.effective !== "subtle" && !reducedMotion;
  return (
    <View pointerEvents="box-none" style={[styles.cardWrap, { bottom: TAB_BAR + Math.max(insets.bottom, 8) + 12, width: Math.min(width - 32, 440), left: Math.max(16, (width - 440) / 2) }]}>
      <View style={styles.card} testID="birthday-card">
        <IgnitedCake plan={plan} moving={moving} />
        <View style={styles.flex}>
          <Body style={styles.eyebrow}>Vereinsgeburtstag</Body>
          <Body style={styles.years}>{years ? `${years} ${years === 1 ? "Jahr" : "Jahre"}` : "Geburtstag"}</Body>
          <Body style={styles.text}>{cardText(greeting, years)}</Body>
          <BirthdaySticker />
        </View>
        <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Gruß schließen" hitSlop={10} style={styles.close} testID="birthday-close">
          <Body style={styles.closeText}>×</Body>
        </Pressable>
      </View>
    </View>
  );
}

/** Die Torte mit dem Anzünden: sind alle Kerzen an, ein leichtes Tippen und Konfetti aus der Torte. */
function IgnitedCake({ plan, moving }: { plan: CakePlan; moving: boolean }) {
  const ref = useRef<View>(null);
  const celebrate = () => {
    void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
    const node = ref.current;
    if (node && typeof node.measureInWindow === "function") {
      node.measureInWindow((x, y, w, h) => {
        requestConfettiBurst({ x: x + w * 0.3, y: y + h * 0.3 });
        requestConfettiBurst({ x: x + w * 0.7, y: y + h * 0.3 });
      });
    }
  };
  const { lit, lighting } = useIgnition(plan, moving, celebrate);
  return (
    <View ref={ref} collapsable={false}>
      <BirthdayCake plan={plan} lit={lit} lighting={lighting} still={!moving} width={112} />
    </View>
  );
}

/** Die Wimpel an der Unterkante der Begrüßungskarte: Farbfolge und kleine Unterschiede aus dem Jahr. */
export function edgePennants(width: number, year: number): Array<{ x: number; y: number; color: string; size: number }> {
  const rng = seasonRng({ season: "club_birthday", year, screen: "edge" }, "garland");
  const inset = 14;
  const span = width - inset * 2;
  if (span < 80) return [];
  const count = Math.max(3, Math.round(span / PENNANT_STEP));
  const first = Math.floor(rng() * PENNANT_COLORS.length);
  const sag = 2.5 + rng() * 1.5;
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 0.5) / count;
    const x = inset + span * t;
    // Zwei flache Bögen über die Breite - wie an zwei Nägeln aufgehängt.
    const local = (t * 2) % 1;
    return { x: Math.round(x * 10) / 10, y: Math.round((2 + 4 * sag * local * (1 - local)) * 10) / 10, color: PENNANT_COLORS[(first + index) % PENNANT_COLORS.length], size: Math.round((8 + rng() * 2) * 10) / 10 };
  });
}

/** Die Wimpelkette an der Begrüßungskarte (Slot `SeasonEdgeSlot`): entfaltet sich einmal, weht dann kaum. */
export function BirthdayEdge({ season }: { season: ActiveSeason; screen: string }) {
  const { reducedMotion } = useSeason();
  const focused = useScreenFocused();
  const [width, setWidth] = useState(0);
  const moving = season.effective !== "subtle" && !reducedMotion;
  const pennants = useMemo(() => (width > 0 ? edgePennants(width, yearOf(season)) : []), [width, season]);
  const [unfold] = useState(() => moving && !once.unfolded);
  const drop = useRef(new Animated.Value(unfold ? 0 : 1)).current;
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!unfold || !pennants.length) return;
    once.unfolded = true;
    Animated.timing(drop, { toValue: 1, duration: 900 + pennants.length * 40, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [unfold, pennants.length, drop]);
  useEffect(() => {
    if (!moving || !focused) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [moving, focused, sway]);
  const string = pennants.length ? `M 0 1 ${pennants.map((pennant) => `L ${pennant.x} ${pennant.y}`).join(" ")} L ${width} 1` : "";
  return (
    <View pointerEvents="none" style={styles.edge} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} testID="birthday-edge">
      {width > 0 ? (
        <Svg width={width} height={EDGE_BAND} style={StyleSheet.absoluteFill}>
          <Path d={string} stroke="rgba(255, 255, 255, 0.45)" strokeWidth={0.8} fill="none" />
        </Svg>
      ) : null}
      {pennants.map((pennant, index) => {
        const reveal = drop.interpolate({ inputRange: [Math.min(0.95, index / (pennants.length + 2)), Math.min(1, (index + 3) / (pennants.length + 2))], outputRange: [0, 1], extrapolate: "clamp" });
        // Drehen um den Aufhängepunkt: die Ebene ist doppelt so hoch und steht mit ihrer Mitte darauf.
        const rotate = sway.interpolate({ inputRange: [0, 1], outputRange: index % 2 ? ["-3deg", "3deg"] : ["3deg", "-3deg"] });
        return (
          <Animated.View key={index} style={[styles.pennant, { left: pennant.x - pennant.size / 2, top: pennant.y - pennant.size, width: pennant.size, height: pennant.size * 2, opacity: reveal, transform: [{ rotate }] }]} testID="birthday-pennant">
            <Svg width={pennant.size} height={pennant.size * 2} style={{ marginTop: 0 }}>
              <Path d={`M 0 ${pennant.size} L ${pennant.size} ${pennant.size} L ${pennant.size / 2} ${pennant.size * 1.9} Z`} fill={pennant.color} stroke="rgba(0, 0, 0, 0.25)" strokeWidth={0.5} />
            </Svg>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  plate: { position: "absolute" },
  plateImage: { width: "100%", height: "100%" },
  cardWrap: { position: "absolute" },
  card: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingLeft: 8, paddingRight: 30, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255, 215, 0, 0.35)", backgroundColor: "#0e1220", shadowColor: "#000", shadowOpacity: 0.55, shadowRadius: 25, shadowOffset: { width: 0, height: 18 }, elevation: 12 },
  eyebrow: { color: CLUB.cyan, fontSize: 10, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  years: { color: CLUB.gold, fontSize: 24, lineHeight: 28, fontWeight: "900", textTransform: "uppercase" },
  text: { color: "rgba(255, 246, 224, 0.86)", fontSize: 14, marginTop: 2, marginBottom: 6 },
  close: { position: "absolute", top: 6, right: 10 },
  closeText: { color: "rgba(255, 255, 255, 0.6)", fontSize: 20, lineHeight: 22 },
  claim: { alignSelf: "flex-start", paddingVertical: 7, paddingHorizontal: 12, borderRadius: 6, backgroundColor: CLUB.cyan },
  claimText: { color: "#04121a", fontSize: 12, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  pressed: { opacity: 0.75 },
  sticker: { flexDirection: "row", alignItems: "center", gap: 8 },
  stickerImage: { width: 44, height: 44 },
  stickerTitle: { color: CLUB.gold, fontSize: 13, fontWeight: "800" },
  stickerText: { color: "rgba(255, 246, 224, 0.7)", fontSize: 12 },
  edge: { position: "absolute", left: 0, right: 0, bottom: 0, height: EDGE_BAND },
  pennant: { position: "absolute" },
});
