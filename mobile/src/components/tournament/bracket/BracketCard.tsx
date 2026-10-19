import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { HEAD_H, LINE_H, META_H, SINGLE_H, type CardModel, type CardRow } from "../../../lib/bracketCards";
import type { CardLift, RowMotion } from "../../../lib/bracketMotion";
import { colors, radius, roles, surfaces } from "../../../theme";
import { LiveClock } from "./LiveClock";
import { CountUp, Flash, PopIn, PressScale, SpringIn } from "./BracketMotion";
import { breatheStyle, crownStyle, liftStyle } from "./motion";

// Eine Karte im Turnierbaum (#1563): ruhig wie im Web (#1561). Kopf mit Kürzel und Stand (läuft: roter Punkt, Station,
// Uhr), Zeilen mit Name und Ergebnis - Sieger hell, Verlierer leise, „Du“ in Cyan, ausgefallen durchgestrichen. Ein Name
// ist ein Knopf: Antippen zeigt seinen Weg (leichtes Eindrücken). Feste Höhen (bracketCards) - die Linien enden genau an
// der Zeile. Neuer Stand: wer weiterkommt, federt in seine Zeile und leuchtet kurz auf; ein frisches Ergebnis zählt hoch,
// Platzziffern poppen nacheinander (BracketMotion).
// Auslosung (#1633): steht der Topf der Show-Auslosung, sind die Zielspiele gold umrandet, bis gelost ist. Im Moment
// selbst hebt sich die Karte sanft an und leuchtet kurz auf (gold: Topf steht, Cyan: ein Name wurde gezogen) - die Karte
// wird dafür mit dem Schlüssel des Moments neu eingehängt, die Zeilen kommen gestaffelt (SpringIn).

const ARRIVE_GLOW = "rgba(41,182,232,0.22)";
const RESULT_GLOW = "rgba(255,255,255,0.08)";
const READY_GLOW = "rgba(255,215,0,0.16)";
const DRAW_GLOW = "rgba(41,182,232,0.16)";

const FONT_SCALE = 1.3;

type Props = {
  model: CardModel;
  x: number;
  y: number;
  w: number;
  status: string;
  live: { station: string; startedAt: string | null } | null;
  dim: boolean;
  selected: string | null;
  motion: { rows?: Map<string, RowMotion>; result?: boolean; walkover?: boolean; fate?: boolean; lift?: CardLift; key: string } | null;
  reduce: boolean;
  onOpen: (matchId: string) => void;
  onToggle: (registrationId: string) => void;
};

function BracketCardImpl({ model, x, y, w, status, live, dim, selected, motion, reduce, onOpen, onToggle }: Props) {
  const frame = [
    styles.card,
    { left: x, top: y, width: w, height: model.height, opacity: dim ? 0.35 : 1 },
    // Dein Weg (#1177): der Rest tritt zurück - eine kurze Überblendung, bei „Bewegung reduzieren“ sofort.
    { transitionProperty: "opacity" as const, transitionDuration: reduce ? 1 : 150 },
    model.mine && styles.mine,
    model.drawState === "ready" && styles.drawReady,
    live && styles.live,
    model.kind === "fate" && styles.fate,
    motion?.lift ? liftStyle(motion.lift.delay, reduce) : null,
  ];
  if (model.kind === "fate" || model.kind === "bye") {
    const line = model.line;
    const own = Boolean(line?.registrationId) && line?.registrationId === selected;
    const body = (
      <>
        <Text style={styles.singleTag} maxFontSizeMultiplier={FONT_SCALE}>{model.kind === "fate" ? model.title : line?.tag}</Text>
        <Text style={[styles.singleText, model.kind === "bye" && styles.byeName, own && styles.nameSelected]} numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE}>
          {line?.text}
        </Text>
        {model.mine ? <Text style={styles.du} maxFontSizeMultiplier={FONT_SCALE}>Du</Text> : null}
      </>
    );
    // Entfällt oder zusammengelegt (neu): die Zeile kommt ruhig herein, die alte Karte ist dann leise.
    const content = motion?.fate
      ? <SpringIn key={`fate-${motion.key}`} delay={0} reduce={reduce} style={styles.single}>{body}</SpringIn>
      : <View style={styles.single}>{body}</View>;
    return (
      <Animated.View style={frame} testID={`bracket-card-${model.id}`}>
        {model.kind === "bye" && line?.registrationId ? (
          <PressScale onPress={() => onToggle(line.registrationId as string)} accessibilityRole="button" accessibilityLabel={`${line.tag}: ${line.text}. Weg zeigen`} style={styles.fill} hitSlop={4}>
            {content}
          </PressScale>
        ) : content}
      </Animated.View>
    );
  }

  return (
    <Animated.View style={frame} testID={`bracket-card-${model.id}`}>
      {motion?.result || motion?.walkover ? <Flash key={`flash-${motion.key}`} reduce={reduce} color={RESULT_GLOW} /> : null}
      {motion?.lift ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={`bracket-lift-${model.id}`}>
          <Flash key={`lift-${motion.key}`} reduce={reduce} delay={motion.lift.delay + 80} color={motion.lift.tone === "ready" ? READY_GLOW : DRAW_GLOW} />
        </View>
      ) : null}
      <PressScale onPress={() => onOpen(model.id)} accessibilityRole="button" accessibilityLabel={`${model.title} öffnen`} innerStyle={styles.head}>
        <Text style={styles.key} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE}>{model.title}</Text>
        {live ? (
          <View style={styles.liveHead}>
            <Animated.View style={[styles.liveDot, breatheStyle(reduce)]} />
            <Text style={styles.liveText} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE}>{live.station || "läuft"}</Text>
            {live.startedAt ? <><Text style={styles.liveText}> · </Text><LiveClock startedAt={live.startedAt} style={styles.liveText} /></> : null}
          </View>
        ) : (
          <Text style={[styles.status, model.walkover && styles.walkover, model.drawState === "ready" && styles.statusReady]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE}>{status}</Text>
        )}
      </PressScale>
      {model.kind === "heat" ? <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE}>{model.text.meta}</Text> : null}
      {model.empty ? <Text style={[styles.lineText, styles.quietLine]} maxFontSizeMultiplier={FONT_SCALE}>noch leer</Text> : null}
      {model.rows.map((row, index) => (
        <React.Fragment key={row.key}>
          <Row row={row} height={model.rowHeight} heat={model.kind === "heat"} walkover={model.walkover} selected={selected} motion={row.registrationId ? motion?.rows?.get(row.registrationId) : undefined} pop={Boolean(motion?.result)} popDelay={index * 70} planKey={motion?.key || ""} reduce={reduce} onToggle={onToggle} />
          {index === model.cutAfter ? (
            <View style={styles.cut}>
              <Text style={styles.cutText} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE}>{model.text.cut}</Text>
            </View>
          ) : null}
        </React.Fragment>
      ))}
      {model.kind === "heat" && model.text.free ? <Text style={[styles.lineText, styles.quietLine]} maxFontSizeMultiplier={FONT_SCALE}>{model.text.free}</Text> : null}
      {model.kind === "heat" && model.cutAfter >= 0 && model.text.rest ? <Text style={styles.lineText} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE}>{model.text.rest}</Text> : null}
    </Animated.View>
  );
}

function Row({ row, height, heat, walkover, selected, motion, pop, popDelay, planKey, reduce, onToggle }: {
  row: CardRow; height: number; heat: boolean; walkover: boolean; selected: string | null; motion?: RowMotion; pop: boolean; popDelay: number; planKey: string; reduce: boolean;
  onToggle: (registrationId: string) => void;
}) {
  const tall = height > 40;
  const nameStyle = [
    styles.name,
    tall && styles.nameSmall,
    row.winner && styles.nameWinner,
    row.loser && styles.nameLoser,
    row.pending && styles.namePending,
    !row.label && styles.nameEmpty,
    row.out && styles.nameOut,
    row.registrationId && row.registrationId === selected && styles.nameSelected,
  ];
  const resultStyle = [styles.result, row.winner && styles.resultWinner, heat && row.qualified && styles.resultQualified];
  // Frisches Ergebnis: im Duell zählt der Stand hoch, im Lauf poppen die Platzziffern nacheinander.
  const result = !row.result ? null : !pop ? (
    <Text style={resultStyle} maxFontSizeMultiplier={FONT_SCALE}>{row.result}</Text>
  ) : heat ? (
    <PopIn key={`pop-${planKey}`} delay={popDelay} reduce={reduce}><Text style={resultStyle} maxFontSizeMultiplier={FONT_SCALE}>{row.result}</Text></PopIn>
  ) : (
    <CountUp key={`count-${planKey}`} value={row.result} delay={popDelay} reduce={reduce} style={resultStyle} />
  );
  const parts = (
    <>
      <Text style={nameStyle} numberOfLines={tall ? 2 : 1} maxFontSizeMultiplier={FONT_SCALE}>{row.label || "—"}</Text>
      {row.mine ? <Text style={styles.du} maxFontSizeMultiplier={FONT_SCALE}>Du</Text> : null}
      {walkover && row.winner && !heat ? <Text style={styles.tag} maxFontSizeMultiplier={FONT_SCALE}>kampflos</Text> : null}
      {result}
    </>
  );
  // Weiterkommen, zusammengelegt, ausgelost: der Name federt in seine Zeile und leuchtet kurz auf - gestaffelt.
  const inner = motion ? (
    <SpringIn key={motion.key} delay={motion.delay} reduce={reduce} style={styles.rowInner}>{parts}</SpringIn>
  ) : <View style={styles.rowInner}>{parts}</View>;
  const glow = motion ? <Flash key={`glow-${motion.key}`} reduce={reduce} delay={motion.delay + 120} color={ARRIVE_GLOW} /> : null;
  if (!row.registrationId) return <View style={[styles.row, { height }]}>{glow}{inner}</View>;
  return (
    <PressScale
      onPress={() => onToggle(row.registrationId as string)}
      accessibilityRole="button"
      accessibilityState={{ selected: row.registrationId === selected }}
      accessibilityLabel={`${row.label}${row.result ? `, ${row.result}` : ""}. Weg zeigen`}
      hitSlop={{ top: 6, bottom: 6 }}
      innerStyle={[styles.row, { height }]}
    >
      {glow}
      {inner}
    </PressScale>
  );
}

export const BracketCard = React.memo(BracketCardImpl);

/** Der Pokal am Ende (#1561, #1563): Sieger in Gold, vorher „noch offen“; steht das Finale gerade fest, hebt er sich einmal. */
export function TrophyCard({ x, y, w, h, winner, crowned, dim, reduce, onPress }: {
  x: number; y: number; w: number; h: number; winner: string | null; crowned: boolean; dim: boolean; reduce: boolean; onPress?: () => void;
}) {
  return (
    <Animated.View
      key={crowned ? "crowned" : "still"}
      style={[styles.trophy, { left: x, top: y, width: w, height: h, opacity: dim ? 0.35 : 1 }, winner && styles.trophyWon, crowned ? crownStyle(reduce) : null]}
      testID="bracket-trophy"
    >
      {crowned ? <View testID="bracket-trophy-crowned" /> : null}
      <PressScale onPress={onPress} disabled={!onPress} style={styles.fill} innerStyle={styles.trophyInner} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={winner ? `Pokal: ${winner}` : "Pokal: noch offen"}>
        <Ionicons name="trophy" size={22} color={winner ? roles.honor : roles.quiet} />
        <Text style={[styles.trophyName, !winner && styles.trophyOpen]} numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE}>{winner || "noch offen"}</Text>
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: surfaces.s1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    position: "absolute",
  },
  mine: { borderColor: "rgba(41,182,232,0.6)" },
  drawReady: { borderColor: "rgba(255,215,0,0.5)" },
  live: { borderColor: "rgba(255,59,48,0.6)" },
  fate: { backgroundColor: "transparent", borderColor: "rgba(255,255,255,0.12)", borderStyle: "dashed" },
  fill: { flex: 1 },
  head: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: HEAD_H,
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  key: { color: roles.muted, flexShrink: 1, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  status: { color: roles.quiet, flexShrink: 1, fontSize: 11, fontWeight: "700" },
  walkover: { color: roles.warn },
  statusReady: { color: roles.honor },
  liveHead: { alignItems: "center", flexDirection: "row", flexShrink: 1 },
  liveDot: { backgroundColor: roles.live, borderRadius: 3, height: 6, marginRight: 5, width: 6 },
  liveText: { color: roles.live, fontSize: 11, fontWeight: "900" },
  meta: { color: roles.muted, fontSize: 11, height: META_H, lineHeight: META_H, paddingHorizontal: 10 },
  row: { borderBottomColor: "rgba(255,255,255,0.05)", borderBottomWidth: 1, justifyContent: "center", paddingHorizontal: 10 },
  rowInner: { alignItems: "center", flexDirection: "row", gap: 6 },
  name: { color: "rgba(255,255,255,0.85)", flex: 1, fontSize: 13, fontWeight: "700" },
  nameSmall: { fontSize: 12, lineHeight: 15 },
  nameWinner: { color: colors.white, fontWeight: "900" },
  nameLoser: { color: roles.quiet, fontWeight: "600" },
  namePending: { color: roles.muted, fontStyle: "italic", fontWeight: "600" },
  nameEmpty: { color: "rgba(255,255,255,0.25)" },
  nameOut: { color: roles.quiet, textDecorationLine: "line-through" },
  nameSelected: { color: roles.honor },
  du: { color: roles.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  tag: { borderColor: "rgba(255,159,67,0.5)", borderRadius: radius.sm, borderWidth: 1, color: roles.warn, fontSize: 9, fontWeight: "900", paddingHorizontal: 4, paddingVertical: 1 },
  result: { color: roles.quiet, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "900", minWidth: 22, textAlign: "right" },
  resultWinner: { color: roles.brand },
  resultQualified: { color: roles.brand },
  cut: { borderTopColor: "rgba(41,182,232,0.45)", borderTopWidth: 1, height: LINE_H, justifyContent: "center", paddingHorizontal: 10 },
  cutText: { color: roles.brand, fontSize: 11, fontWeight: "800" },
  lineText: { color: roles.muted, fontSize: 11, height: LINE_H, lineHeight: LINE_H, paddingHorizontal: 10 },
  quietLine: { color: roles.quiet, fontStyle: "italic" },
  single: { alignItems: "center", flexDirection: "row", gap: 8, height: SINGLE_H, paddingHorizontal: 10 },
  singleTag: { color: roles.quiet, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  singleText: { color: roles.quiet, flex: 1, fontSize: 12, fontWeight: "700" },
  byeName: { color: "rgba(255,255,255,0.85)" },
  trophy: {
    backgroundColor: surfaces.s1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.lg,
    borderWidth: 1,
    position: "absolute",
  },
  trophyWon: { backgroundColor: "rgba(255,215,0,0.08)", borderColor: "rgba(255,215,0,0.55)" },
  trophyInner: { alignItems: "center", flex: 1, gap: 6, justifyContent: "center", padding: 10 },
  trophyName: { color: roles.honor, fontSize: 15, fontWeight: "900", textAlign: "center" },
  trophyOpen: { color: roles.quiet, fontSize: 12, fontStyle: "italic", fontWeight: "700" },
});
