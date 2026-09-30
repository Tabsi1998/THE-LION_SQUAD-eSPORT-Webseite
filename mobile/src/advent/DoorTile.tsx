import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Svg, { Defs, Ellipse, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { resolveMediaUrl } from "../lib/api";
import { doorLabel, type Cell, type Door, type DoorContent, type DoorVariant } from "./doors";

// Ein Türchen in der App (#641, #732, #642): wie im Web liegt der geschlossene Flügel im Bild - hier ist er
// durchsichtig, das Winterbild scheint durch, nur Goldrand, Schildchen und Schmuck sitzen darauf. Beim Öffnen wird der
// Flügel zu Papier und schwingt auf, dahinter liegt die Nische mit dem Licht; steht er offen, zeigt er seine
// cremefarbene Rückseite mit der Zahl - wie im Web. Verschlossen: das Bild tritt zurück, ein Tippen rüttelt an der
// Tür. „Bewegung reduzieren“: nichts schwingt, nichts pulsiert.

export const GOLD = "#e9c46a";
export const SERIF = Platform.select({ ios: "Georgia", default: "serif" }) as string;
export const RATTLE_MS = 420;

export const KIND_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  text: "document-text-outline",
  image: "image-outline",
  video: "play-outline",
  clip: "film-outline",
  news: "newspaper-outline",
  event: "calendar-outline",
  member_spotlight: "star-outline",
  sticker: "happy-outline",
  quiz: "help-circle-outline",
  prize: "gift-outline",
};

const ORNAMENTS: Record<string, { d: string; filled: boolean }> = {
  star: { d: "M12 2.6l2.6 6 6.5.6-4.9 4.3 1.5 6.4L12 16.5l-5.7 3.4 1.5-6.4-4.9-4.3 6.5-.6z", filled: true },
  twig: { d: "M4 20L20 4M8 16l-4.4-1.2M8 16l1.2 4.4M11.5 12.5L6.6 11.2M11.5 12.5l1.3 4.9M15 9l-4.6-1.2M15 9l1.2 4.6M18 6l-3.6-.9M18 6l.9 3.6", filled: false },
  flake: { d: "M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M12 6l-2.4-2M12 6l2.4-2M12 18l-2.4 2M12 18l2.4 2M6.8 9l-3-.4M6.8 9L6.4 6M17.2 15l3 .4M17.2 15l.4 3M6.8 15l-3 .4M6.8 15l-.4 3M17.2 9l3-.4M17.2 9l.4-3", filled: false },
  bell: { d: "M12 3.2c-3.6 0-5.4 2.8-5.4 6.4 0 4.2-1.4 5.6-2.6 6.8h16c-1.2-1.2-2.6-2.6-2.6-6.8 0-3.6-1.8-6.4-5.4-6.4zM10 19.2a2 2 0 0 0 4 0M12 1.4v1.8", filled: false },
  paw: { d: "M12 11.8c2.7 0 4.9 2.1 4.8 4.6-.1 2-2.3 2.5-4.8 2.5s-4.7-.5-4.8-2.5c-.1-2.5 2.1-4.6 4.8-4.6z", filled: true },
};

/** Ecken des Türchens je Form - in der App runde Ecken statt der Ellipse des Web, der Eindruck bleibt derselbe. */
export function radii(shape: DoorVariant["shape"], leaf: number, part: "single" | "a" | "b" = "single"): ViewStyle {
  const small = 7;
  const top = shape === "round" ? leaf / 2 : shape === "arch" ? leaf * 0.42 : small;
  const bottom = shape === "round" ? leaf / 2 : small;
  const left = part !== "b";
  const right = part !== "a";
  return {
    borderTopLeftRadius: left ? top : 0,
    borderBottomLeftRadius: left ? bottom : 0,
    borderTopRightRadius: right ? top : 0,
    borderBottomRightRadius: right ? bottom : 0,
  };
}

/** Die Farbe des Papierflügels beim Aufschwingen: oben Nachtblau, unten Schnee - so wie das Bild an dieser Stelle. */
export function leafTint(row: number, rows: number): string {
  const t = rows > 1 ? row / (rows - 1) : 0;
  if (t < 0.6) return "#101c42";
  if (t < 0.85) return "#1b2a58";
  return "#8fa3cf";
}

function Ornament({ kind, size }: { kind: string; size: number }) {
  const art = ORNAMENTS[kind];
  if (!art) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={0.62}>
      <Path d={art.d} fill={art.filled ? GOLD : "none"} stroke={art.filled ? "none" : GOLD} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
      {kind === "paw" ? (
        <>
          <Ellipse cx={6.3} cy={9.7} rx={1.7} ry={2.1} fill={GOLD} />
          <Ellipse cx={9.9} cy={6.2} rx={1.7} ry={2.2} fill={GOLD} />
          <Ellipse cx={14.1} cy={6.2} rx={1.7} ry={2.2} fill={GOLD} />
          <Ellipse cx={17.7} cy={9.7} rx={1.7} ry={2.1} fill={GOLD} />
        </>
      ) : null}
    </Svg>
  );
}

function corner(plaque: string, leaf: number, arch: boolean): ViewStyle {
  const edge = leaf * 0.09;
  const top = arch ? leaf * 0.24 : edge;
  if (plaque === "tl") return { top, left: edge };
  if (plaque === "tr") return { top, right: edge };
  if (plaque === "bl") return { bottom: edge, left: edge };
  if (plaque === "br") return { bottom: edge, right: edge };
  return {};
}

function opposite(plaque: string): string {
  return ({ tl: "br", tr: "bl", bl: "tr", br: "tl" } as Record<string, string>)[plaque] || "center";
}

/** Das Titelband über einem Bild: in einer runden Nische rückt es nach innen, damit der Kreis nichts abschneidet. */
export function bandInsets(shape: DoorVariant["shape"], leaf: number): ViewStyle {
  if (shape !== "round") return { left: 0, right: 0, bottom: 0 };
  const side = Math.round(leaf * 0.16);
  return { left: side, right: side, bottom: Math.round(leaf * 0.14), borderRadius: 6 };
}

export function NichePreview({ content, leaf, light, shape = "rect" }: { content: DoorContent; leaf: number; light: string; shape?: DoorVariant["shape"] }) {
  const picture = content.kind === "image" ? content.media_url : content.kind === "sticker" ? content.sticker?.url : content.card?.image_url || null;
  const long = String(content.title || "").length > 34;
  const fontSize = Math.max(9, Math.min(13, leaf * (long ? 0.082 : 0.098)));
  const overImage = Boolean(picture) && content.kind !== "sticker";
  return (
    <View style={styles.preview} testID="advent-niche-preview">
      {picture ? (
        <Image source={{ uri: resolveMediaUrl(picture) }} style={content.kind === "sticker" ? { width: leaf * 0.52, height: leaf * 0.52 } : StyleSheet.absoluteFill} resizeMode={content.kind === "sticker" ? "contain" : "cover"} accessibilityIgnoresInvertColors />
      ) : (
        <Ionicons name={KIND_ICONS[content.kind] || "document-text-outline"} size={leaf * (long ? 0.24 : 0.3)} color={light} />
      )}
      <Text numberOfLines={3} style={[styles.previewTitle, { fontSize, lineHeight: fontSize * 1.22 }, overImage ? [styles.previewTitleOverImage, bandInsets(shape, leaf)] : null]} testID={overImage ? "advent-niche-band" : undefined}>{content.title}</Text>
    </View>
  );
}

type Props = {
  door: Door;
  variant: DoorVariant;
  cell: Cell;
  rows: number;
  size: number;
  today?: boolean;
  busy?: boolean;
  still?: boolean;
  onPress: (door: Door) => void;
};

export function DoorTile({ door, variant, cell, rows, size, today = false, busy = false, still = false, onPress }: Props) {
  const pad = size * variant.inset;
  const leaf = size - pad * 2;
  const opened = door.state === "opened";
  const locked = door.state === "locked";
  const double = variant.hinge === "double";
  const plaque = double && variant.plaque === "center" ? "tl" : variant.plaque;
  const plaqueLeft = plaque === "tl" || plaque === "bl" || plaque === "center";
  const swing = useRef(new Animated.Value(opened ? 1 : 0)).current;
  const breath = useRef(new Animated.Value(0.5)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const first = useRef(true);

  // Aufschwingen, sobald das Türchen geöffnet ist - beim ersten Zeichnen steht es schon offen.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      swing.setValue(opened ? 1 : 0);
      return;
    }
    if (still) {
      swing.setValue(opened ? 1 : 0);
      return;
    }
    Animated.timing(swing, { toValue: opened ? 1 : 0, duration: variant.swing, easing: Easing.bezier(0.22, 0.9, 0.3, 1), useNativeDriver: true }).start();
  }, [opened, still, swing, variant.swing]);

  // Licht im Spalt: atmet langsam, solange das Türchen aufgehen darf.
  useEffect(() => {
    if (door.state !== "available" || still) {
      breath.stopAnimation();
      breath.setValue(0.6);
      return undefined;
    }
    const half = (variant.pulse * 1000) / 2;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 0.85, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0.32, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [door.state, still, breath, variant.pulse]);

  const press = () => {
    if (locked && !still) {
      shake.setValue(0);
      Animated.timing(shake, { toValue: 1, duration: RATTLE_MS, easing: Easing.linear, useNativeDriver: true }).start(() => shake.setValue(0));
    }
    onPress(door);
  };

  // Beide Seiten drehen sich einzeln um dasselbe Scharnier: die Rückseite steht um 180 Grad versetzt. Android
  // blendet eine Seite nur nach ihrer eigenen Drehung aus - an einem gemeinsamen Elternteil bliebe sie sichtbar.
  const rotate = (direction: "left" | "right" | "top", side: "front" | "back") => {
    const base = side === "back" ? 180 : 0;
    const sign = direction === "left" ? -1 : 1;
    const turn = swing.interpolate({ inputRange: [0, 1], outputRange: [`${base}deg`, `${base + sign * variant.angle}deg`] });
    return [{ perspective: 800 }, direction === "top" ? { rotateX: turn } : { rotateY: turn }];
  };
  // Papier erst, wenn der Flügel sich bewegt - geschlossen scheint das Bild durch.
  const paper = swing.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 1, 1] });
  const closedOnly = swing.interpolate({ inputRange: [0, 0.12, 1], outputRange: [1, 0, 0] });
  const tint = leafTint(cell.row, rows);
  const plaqueSize = Math.max(26, Math.min(44, size * 0.3));
  const plaqueFont = Math.max(13, Math.min(24, size * 0.155));
  const backFont = Math.max(12, Math.min(26, leaf * 0.2));
  const ornamentSize = leaf * 0.17;
  const knob = Math.max(5, leaf * 0.062);

  const leafView = (part: "single" | "a" | "b") => {
    const direction = part === "a" ? "left" : part === "b" ? "right" : (variant.hinge as "left" | "right" | "top");
    const origin = direction === "left" ? "left center" : direction === "right" ? "right center" : "center top";
    const shape = radii(variant.shape, leaf, part);
    const withPlaque = part === "single" || (part === "a" ? plaqueLeft : !plaqueLeft);
    const ornamentPlace = part === "single" ? corner(opposite(plaque), leaf, variant.shape === "arch") : part === "a" ? { bottom: leaf * 0.1, left: leaf * 0.14 } : { bottom: leaf * 0.1, right: leaf * 0.14 };
    const centered = plaque === "center" && part === "single";
    const plaquePlace = centered ? { top: (leaf - plaqueSize) / 2, left: (leaf - plaqueSize) / 2 } : part === "single" ? corner(plaque, leaf, variant.shape === "arch") : part === "a" ? { ...corner(plaque, leaf, variant.shape === "arch"), left: leaf * 0.08, right: undefined } : { ...corner(plaque, leaf, variant.shape === "arch"), right: leaf * 0.08, left: undefined };
    const knobPlace: ViewStyle = direction === "top" ? { bottom: leaf * 0.05, left: (leaf - knob) / 2 } : direction === "left" ? { top: (leaf - knob) / 2, right: leaf * (part === "single" ? 0.05 : 0.04) } : { top: (leaf - knob) / 2, left: leaf * (part === "single" ? 0.05 : 0.04) };
    return (
      <View key={part} pointerEvents="none" testID={`advent-leaf-${door.day}-${part}`} style={[styles.leaf, part === "a" ? { right: leaf / 2 } : part === "b" ? { left: leaf / 2 } : null]}>
        {/* Vorne: durchsichtig, bis der Flügel sich bewegt - dann Papier mit Schildchen, Schmuck und Knauf. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.face, { transformOrigin: origin, transform: rotate(direction, "front") } as unknown as ViewStyle]} testID={`advent-leaf-${door.day}-${part}-front`}>
          <Animated.View style={[StyleSheet.absoluteFill, shape, { backgroundColor: tint, opacity: paper }]} />
          <View style={[StyleSheet.absoluteFill, shape, styles.leafEdge, locked ? styles.leafEdgeLocked : null]} />
          {locked ? <View style={[StyleSheet.absoluteFill, shape, styles.lockedTint]} /> : null}
          {part === "single" || (part === "a" ? !plaqueLeft : plaqueLeft) ? (
            <Animated.View style={[styles.ornament, ornamentPlace, centered ? { bottom: leaf * 0.13, left: (leaf - ornamentSize) / 2 } : null, { opacity: locked ? 0.4 : 1 }]}>
              <Ornament kind={variant.ornament} size={ornamentSize} />
            </Animated.View>
          ) : null}
          {withPlaque ? (
            <View style={[styles.plaque, plaquePlace, { minWidth: plaqueSize, height: plaqueSize, borderRadius: plaqueSize / 2, opacity: locked ? 0.72 : 1, transform: [{ rotate: `${variant.tilt}deg` }] }]}>
              <Text style={[styles.number, { fontSize: plaqueFont }]} allowFontScaling={false}>{door.day}</Text>
            </View>
          ) : null}
          <Animated.View style={[styles.knob, knobPlace, { width: knob, height: knob, borderRadius: knob / 2, opacity: closedOnly }]} />
        </Animated.View>
        {/* Hinten: cremefarbenes Papier mit der Zahl - zu sehen, sobald der Flügel weiter als im rechten Winkel steht. */}
        <Animated.View style={[StyleSheet.absoluteFill, shape, styles.face, styles.back, { transformOrigin: origin, transform: rotate(direction, "back") } as unknown as ViewStyle]} testID={`advent-leaf-${door.day}-${part}-back`}>
          <Text style={[styles.backNumber, { fontSize: backFont }]} allowFontScaling={false}>{door.day}</Text>
        </Animated.View>
      </View>
    );
  };

  const shiver = shake.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -2.5, 2.5, -1.5, 1.5, 0] });
  return (
    <View style={{ width: size, height: size }} testID={`advent-door-${door.day}`} accessibilityState={{ disabled: false, busy }}>
      {today && !opened ? (
        <View style={[styles.today, { top: pad * 0.1 }]} pointerEvents="none" testID="advent-today">
          <Text style={styles.todayText} allowFontScaling={false}>HEUTE</Text>
        </View>
      ) : null}
      <Animated.View style={{ position: "absolute", top: pad, left: pad, width: leaf, height: leaf, transform: [{ translateX: shiver }] }}>
        {door.state === "available" ? (
          <Animated.View pointerEvents="none" style={[styles.halo, radii(variant.shape, leaf + 6), { borderColor: variant.light.color, shadowColor: variant.light.color, opacity: breath, borderWidth: today ? 2 : 1 }]} testID={`advent-halo-${door.day}`} />
        ) : null}
        <Pressable
          onPress={press}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={doorLabel(door, { today })}
          testID={`advent-door-button-${door.day}`}
          style={[StyleSheet.absoluteFill, radii(variant.shape, leaf)]}
        >
          {opened ? (
            <View style={[StyleSheet.absoluteFill, radii(variant.shape, leaf), styles.niche]}>
              <Svg width={leaf} height={leaf} style={StyleSheet.absoluteFill}>
                <Defs>
                  <RadialGradient id={`adv-light-${door.day}`} cx="50%" cy="62%" rx="70%" ry="60%">
                    <Stop offset="0" stopColor={variant.light.color} stopOpacity={0.5} />
                    <Stop offset="1" stopColor={variant.light.color} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Rect x={0} y={0} width={leaf} height={leaf} fill={`url(#adv-light-${door.day})`} />
              </Svg>
              {door.content ? <NichePreview content={door.content} leaf={leaf} light={variant.light.color} shape={variant.shape} /> : null}
            </View>
          ) : null}
          {double ? [leafView("a"), leafView("b")] : leafView("single")}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  leaf: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  face: { backfaceVisibility: "hidden" },
  back: { alignItems: "center", justifyContent: "center", backgroundColor: "#e6dab8", borderWidth: 1, borderColor: "rgba(120, 90, 40, 0.45)" },
  backNumber: { color: "rgba(110, 78, 30, 0.6)", fontFamily: SERIF, fontStyle: "italic", fontWeight: "600" },
  leafEdge: { borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.62)" },
  leafEdgeLocked: { borderColor: "rgba(233, 196, 106, 0.3)" },
  lockedTint: { backgroundColor: "rgba(8, 14, 40, 0.5)" },
  niche: { overflow: "hidden", backgroundColor: "#140c05", borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.4)" },
  halo: { position: "absolute", top: -3, left: -3, right: -3, bottom: -3, shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  plaque: { position: "absolute", paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(6, 10, 24, 0.86)", borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.75)" },
  number: { color: GOLD, fontFamily: SERIF, fontWeight: "600" },
  ornament: { position: "absolute" },
  knob: { position: "absolute", backgroundColor: GOLD },
  today: { position: "absolute", alignSelf: "center", zIndex: 5, paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 99, backgroundColor: GOLD },
  todayText: { fontSize: 8.5, fontWeight: "800", letterSpacing: 1.4, color: "#1c1303" },
  preview: { flex: 1, alignItems: "center", justifyContent: "center", padding: 8, gap: 3 },
  previewTitle: { color: "#fff3d6", fontWeight: "600", textAlign: "center" },
  previewTitleOverImage: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingVertical: 5, backgroundColor: "rgba(6, 4, 2, 0.72)" },
});
