import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useReduceMotion } from "../../FadeIn";
import { cardModel, type CardModel } from "../../../lib/bracketCards";
import { bracketEdges, finalMatchOf, isLive, orderEdges, pathFor, winnerOf, type BracketEdge, type BracketMatch } from "../../../lib/bracketGraph";
import { layoutBracket, TROPHY_ID, type BracketLayout } from "../../../lib/bracketLayout";
import type { MotionPlan } from "../../../lib/bracketMotion";
import { finderFor } from "../../../lib/slotSource";
import { matchStatusText, roundLabels, stageKind } from "../../../lib/tournamentView";
import { viennaTime } from "../../../lib/vienna";
import { colors, radius, roles, surfaces } from "../../../theme";
import { Button } from "../../Button";
import { BracketCard, TrophyCard } from "./BracketCard";
import { LiveNow } from "./LiveNow";

// Der Turnierbaum der App (#1563): eine Leinwand je Phase mit Linien (react-native-svg - liegt schon im Projekt und
// zeichnet hier wenige, einfache Pfade unter den Karten), Rundennamen statt „Runde 2“, „Du“ und dein Weg per Tipp,
// Live mit Station und Uhr (oben angepinnt), Lauf-Karten, Pokal am Ende. Die Lage rechnet bracketLayout ohne Messen.

type Props = {
  matches: BracketMatch[];
  stages: Array<{ id?: string; stage_type?: string | null; match_type?: string | null; name?: string | null; number?: number }>;
  format?: string | null;
  nameOf: (registrationId: string) => string;
  statusOf: (registrationId: string) => string;
  mineId: string | null;
  plan: MotionPlan | null;
  crowned: boolean;
  onOpenMatch: (matchId: string) => void;
};

const PATH_COLOR = roles.honor;
const LINE_COLOR = "rgba(255,255,255,0.24)";

function edgesFor(matches: BracketMatch[]): BracketEdge[] {
  const real = bracketEdges(matches);
  if (real.length) return real;
  // Alte Bäume ohne Herkunft der Plätze: Linien nach der Reihenfolge wie früher, je Abschnitt.
  const bySection = new Map<string, Map<number, BracketMatch[]>>();
  for (const match of matches) {
    const section = String(match.section || "MAIN");
    if (!bySection.has(section)) bySection.set(section, new Map());
    const rounds = bySection.get(section) as Map<number, BracketMatch[]>;
    const round = Number(match.round) || 1;
    rounds.set(round, [...(rounds.get(round) || []), match]);
  }
  return [...bySection.values()].flatMap((rounds) => orderEdges([...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => [...list].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)))));
}

export function BracketCanvas({ matches, stages, format, nameOf, statusOf, mineId, plan, crowned, onOpenMatch }: Props) {
  const reduce = useReduceMotion();
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = useCallback((registrationId: string) => setSelected((current) => (current === registrationId ? null : registrationId)), []);
  const labels = useMemo(() => roundLabels(matches, stages, format), [format, matches, stages]);
  const edges = useMemo(() => edgesFor(matches), [matches]);
  const final = useMemo(() => finalMatchOf(matches, stages), [matches, stages]);
  const path = useMemo(() => (selected ? pathFor(selected, matches, edges) : null), [edges, matches, selected]);
  const finder = useMemo(() => finderFor(matches), [matches]);
  const models = useMemo(() => {
    const ctx = { nameOf, statusOf, finder, edges, matches, finalId: final?.id || null, mine: mineId };
    return new Map(matches.map((match) => [match.id, cardModel(match, ctx)]));
  }, [edges, final?.id, finder, matches, mineId, nameOf, statusOf]);
  // Je Phase eine Leinwand; Tabellen-Phasen (Gruppen, Liga, Swiss) stehen unter „Tabelle“.
  const groups = useMemo(() => {
    const byStage = new Map<string, BracketMatch[]>();
    for (const match of matches) byStage.set(match.stage_id || "", [...(byStage.get(match.stage_id || "") || []), match]);
    const stageById = new Map(stages.map((stage) => [stage.id || "", stage]));
    return [...byStage.entries()]
      .filter(([id, list]) => stageKind(stageById.get(id)?.stage_type, format, list[0]?.match_type) !== "table" || !stageById.get(id))
      .sort(([a], [b]) => (Number(stageById.get(a)?.number) || 0) - (Number(stageById.get(b)?.number) || 0))
      .map(([id, list]) => {
        const stageEdges = edges.filter((edge) => list.some((match) => match.id === edge.to));
        const finalId = final && list.includes(final) ? final.id : null;
        const layout = layoutBracket(list, stageEdges, {
          heightOf: (match) => (models.get(match.id) as CardModel).height,
          anchorY: (match, slot) => (models.get(match.id) as CardModel).anchor(slot),
          finalId,
        });
        return { id, title: byStage.size > 1 ? stageById.get(id)?.name || "" : "", layout, finalId };
      });
  }, [edges, final, format, matches, models, stages]);
  const live = useMemo(() => matches.filter(isLive), [matches]);
  const champion = final ? winnerOf(final) : null;
  const mineMatches = mineId ? matches.some((match) => (match.slots || []).some((slot) => slot.registration_id === mineId)) : false;

  return (
    <View style={styles.wrap}>
      {live.length ? <LiveNow matches={live} labels={labels} nameOf={nameOf} reduce={reduce} onOpen={onOpenMatch} /> : null}
      {mineMatches || selected ? (
        <View style={styles.pathRow}>
          {selected ? (
            <View style={styles.pathBar} testID="bracket-path-bar">
              <View style={styles.pathSwatch} />
              <Text style={styles.pathText} numberOfLines={1}>{selected === mineId ? "Dein Weg" : `Weg von ${nameOf(selected) || "Teilnehmer"}`}</Text>
              <Pressable onPress={() => setSelected(null)} hitSlop={10} accessibilityRole="button" testID="bracket-path-clear">
                <Text style={styles.pathClear}>aufheben</Text>
              </Pressable>
            </View>
          ) : (
            <Button label="Meinen Weg zeigen" variant="secondary" onPress={() => mineId && toggle(mineId)} testID="bracket-my-path" />
          )}
        </View>
      ) : (
        <Text style={styles.hint}>Tipp auf einen Namen zeigt seinen Weg.</Text>
      )}
      {groups.map((group) => (
        <View key={group.id} style={styles.stage}>
          {group.title ? <Text style={styles.stageTitle}>{group.title}</Text> : null}
          <Canvas
            layout={group.layout}
            matches={matches}
            models={models}
            labels={labels}
            path={path}
            selected={selected}
            plan={plan}
            reduce={reduce}
            champion={group.finalId ? champion : null}
            championName={champion ? nameOf(champion) : null}
            crowned={crowned && Boolean(group.finalId)}
            finalId={group.finalId}
            onOpen={onOpenMatch}
            onToggle={toggle}
          />
        </View>
      ))}
    </View>
  );
}

function Canvas({ layout, matches, models, labels, path, selected, plan, reduce, champion, championName, crowned, finalId, onOpen, onToggle }: {
  layout: BracketLayout;
  matches: BracketMatch[];
  models: Map<string, CardModel>;
  labels: Map<string, string>;
  path: ReturnType<typeof pathFor> | null;
  selected: string | null;
  plan: MotionPlan | null;
  reduce: boolean;
  champion: string | null;
  championName: string | null;
  crowned: boolean;
  finalId: string | null;
  onOpen: (matchId: string) => void;
  onToggle: (registrationId: string) => void;
}) {
  const byId = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const onPath = (id: string) => !path || path.matches.has(id);
  const lineOn = (lineId: string, to: string) => Boolean(path) && (path?.edges.has(lineId) || (to === TROPHY_ID && Boolean(champion) && champion === selected));
  const trophy = layout.nodes.get(TROPHY_ID);
  const pad = 2;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}>
      <View style={{ width: layout.width + pad, height: layout.height }} testID="bracket-canvas">
        <Svg width={layout.width + pad} height={layout.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {layout.lines.map((line) => {
            const on = lineOn(line.id, line.to);
            const quiet = line.flow === "L" || line.void;
            return (
              <Path
                key={line.id}
                testID={on ? `bracket-line-weg-${line.id}` : `bracket-line-${line.id}`}
                d={line.d}
                fill="none"
                stroke={on ? PATH_COLOR : LINE_COLOR}
                strokeWidth={on ? 2.5 : 1.5}
                strokeDasharray={line.void ? "2 4" : line.flow === "L" ? "5 4" : undefined}
                opacity={path && !on ? 0.25 : on ? 1 : quiet ? 0.6 : 1}
              />
            );
          })}
        </Svg>
        {layout.bands.map((band) => (
          <Text key={band.label} style={[styles.band, { top: band.y - 2 }]} accessibilityRole="header">{band.label}</Text>
        ))}
        {layout.headers.map((header) => {
          const first = byId.get(header.matchIds[0]);
          if (!first) return null;
          const times = header.matchIds.map((id) => byId.get(id)?.scheduled_at).filter(Boolean).sort() as string[];
          const time = times[0] ? viennaTime(times[0], { hour: "2-digit", minute: "2-digit" }) : "";
          return (
            <Text key={header.key} style={[styles.header, { left: header.x, top: header.y, width: header.w }]} numberOfLines={1} accessibilityRole="header">
              {labels.get(first.id) || "Runde"}{time ? ` · ${time}` : ""}
            </Text>
          );
        })}
        {[...layout.nodes.values()].filter((node) => node.id !== TROPHY_ID).map((node) => {
          const model = models.get(node.id) as CardModel;
          const match = byId.get(node.id) as BracketMatch;
          const live = isLive(match) ? { station: String(match.station_text || ""), startedAt: match.started_at || null } : null;
          const rows = plan?.rows.get(node.id);
          const motion = plan && (rows || plan.results.has(node.id) || plan.walkovers.has(node.id) || plan.fates.has(node.id))
            ? { rows, result: plan.results.has(node.id), walkover: plan.walkovers.has(node.id), fate: plan.fates.has(node.id), key: plan.key }
            : null;
          return (
            <BracketCard
              key={node.id}
              model={model}
              x={node.x}
              y={node.y}
              w={node.w}
              status={matchStatusText(match)}
              live={live}
              dim={!onPath(node.id)}
              selected={selected}
              motion={motion}
              reduce={reduce}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          );
        })}
        {trophy && finalId ? (
          <TrophyCard
            x={trophy.x}
            y={trophy.y}
            w={trophy.w}
            h={trophy.h}
            winner={championName}
            crowned={crowned}
            dim={Boolean(path) && !(champion && champion === selected)}
            reduce={reduce}
            onPress={champion ? () => onToggle(champion) : undefined}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  stage: { gap: 8 },
  stageTitle: { color: colors.white, fontSize: 15, fontWeight: "900" },
  scroll: { paddingBottom: 4, paddingRight: 18 },
  hint: { color: roles.muted, fontSize: 12 },
  pathRow: { alignItems: "flex-start" },
  pathBar: {
    alignItems: "center",
    backgroundColor: surfaces.s2,
    borderColor: "rgba(255,215,0,0.4)",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    maxWidth: "100%",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  pathSwatch: { backgroundColor: roles.honor, height: 2, width: 16 },
  pathText: { color: colors.white, flexShrink: 1, fontSize: 13, fontWeight: "800" },
  pathClear: { color: roles.brand, fontSize: 12, fontWeight: "900", paddingVertical: 8, textDecorationLine: "underline" },
  band: { color: roles.honor, fontSize: 11, fontWeight: "900", left: 0, letterSpacing: 1, position: "absolute", textTransform: "uppercase" },
  header: { color: roles.muted, fontSize: 11, fontWeight: "900", letterSpacing: 0.4, position: "absolute" },
});
