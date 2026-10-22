import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { ListItemFadeIn, useListEntrance, useReduceMotion } from "../../FadeIn";
import { Body, Muted } from "../../Text";
import { Chevron, Reveal, ink } from "../parts";
import { MapImage, MapPoolView } from "../MapCards";
import { OriginalsButton } from "../OriginalViewer";
import { originalsOf, type OriginalItem } from "../../../lib/referenceOriginals";
import { Glow } from "../../motion";
import { StateChip } from "../seriesParts";
import { motionEasing } from "../../../lib/motion";
import type { SeasonPage } from "../../../lib/referenceSeason";
import { leagueTableRows, mapStatCards, matchdayCards, poolGroups, squadGroups, type MapLine, type MatchBlock, type MatchdayCard, type VetoCard } from "../../../lib/teamLeague";
import { colors, surfaces } from "../../../theme";

// Team-Liga in der App (#1931, #1616, #1974) nach der Handy-Ansicht der Serienseite: Spieltag-Karten mit Gegner,
// Heim/Auswärts und Ergebnis aus eigener Sicht (S/U/N), darunter die Maps - mit Bildern als Veto-Karten (Bann grau
// und durchgestrichen, Wahl, Decider, „nicht gespielt“), sonst als Liste mit Balken und den Banns -, „Weitere Spiele“ zum
// Aufklappen; die Tabelle; der Kader mit Einsätzen je Spieltag; die Statistik je Map und der Map-Pool der Saison.
// Detail-Runde: Karten bauen sich gestaffelt auf, Balken füllen sich einmal, eine gewonnene Map leuchtet einmal auf -
// mit „Bewegung reduzieren“ steht alles sofort da.

const OUTCOME_LOOK: Record<string, { border: string; bg: string; fg: string }> = {
  win: { border: "rgba(41,182,232,0.55)", bg: "rgba(41,182,232,0.06)", fg: colors.cyan },
  draw: { border: "rgba(255,255,255,0.22)", bg: surfaces.s1, fg: ink.soft },
  loss: { border: "rgba(255,255,255,0.1)", bg: surfaces.s1, fg: ink.muted },
};

export function Matchdays({ page }: { page: SeasonPage }) {
  const cards = matchdayCards(page);
  const entrance = useListEntrance();
  if (!cards.length) return <Muted style={styles.empty}>Noch keine Spieltage.</Muted>;
  return (
    <View style={styles.cards}>
      {cards.map((card, index) => (
        <ListItemFadeIn key={card.key} entrance={entrance} id={`matchday-${card.key}`} index={index}>
          <MatchdayCardView card={card} originals={originalsOf(page.originals, [{ id: card.key }])} />
        </ListItemFadeIn>
      ))}
    </View>
  );
}

function MatchdayCardView({ card, originals }: { card: MatchdayCard; originals: OriginalItem[] }) {
  const single = card.matches.length === 1 ? card.matches[0] : null;
  const look = single ? OUTCOME_LOOK[single.outcomeKey] : null;
  return (
    <View
      style={[styles.card, look ? { borderColor: look.border, backgroundColor: look.bg } : null, card.today && styles.cardToday, card.cancelled && styles.cardCancelled]}
      testID={`season-matchday-${card.key}`}
    >
      <View style={styles.cardHead}>
        <Body style={styles.code}>{card.code}</Body>
        <View style={styles.flex}>
          <Muted style={styles.when}>{[card.when, card.moved].filter(Boolean).join(" · ")}</Muted>
          {single ? <Opponent block={single} /> : !card.matches.length ? (
            <Body style={styles.opponent}>{[card.opponent, card.side].filter(Boolean).join(" · ")}</Body>
          ) : null}
        </View>
        {single ? <Score block={single} /> : !card.matches.length ? <StateChip label={card.state} tone={card.tone} /> : null}
      </View>
      {card.matches.map((block, index) => (
        <View key={block.key} style={[styles.block, card.matches.length > 1 && index > 0 && styles.blockDivided]} testID={`season-match-${block.key}`}>
          {card.matches.length > 1 ? (
            <View style={styles.blockHead}>
              <View style={styles.flex}><Opponent block={block} /></View>
              <Score block={block} />
            </View>
          ) : null}
          {block.veto.length ? <VetoGrid cards={block.veto} /> : <MapList maps={block.maps} />}
          {block.bans ? <Muted style={styles.bans}>{`Bann: ${block.bans}`}</Muted> : null}
        </View>
      ))}
      {card.others.length ? <OtherMatches card={card} /> : null}
      {/* Original-Bilder des Veranstalters zum Spieltag (#1933). */}
      <OriginalsButton items={originals} title={[card.code, (single || card.matches[0])?.opponent || card.opponent].filter(Boolean).join(" · ")} testID={`season-matchday-originals-${card.key}`} />
    </View>
  );
}

function Opponent({ block }: { block: MatchBlock }) {
  return (
    <Body style={styles.opponent}>
      {block.team ? <Body style={styles.ownTeam}>{`${block.team} `}</Body> : null}
      {[block.opponent, block.side].filter(Boolean).join(" · ")}
    </Body>
  );
}

function Score({ block }: { block: MatchBlock }) {
  const look = OUTCOME_LOOK[block.outcomeKey];
  return (
    <View style={styles.score} accessible accessibilityLabel={block.label} testID="season-match-score">
      {block.letter ? <Muted style={[styles.letter, block.outcomeKey === "win" && styles.letterWin]}>{block.letter}</Muted> : null}
      <Body style={[styles.scoreText, look ? { color: block.outcomeKey === "loss" ? ink.second : ink.text } : null]}>{block.score}</Body>
    </View>
  );
}

/** Veto mit Bildern (#1616): drei Spalten, auch am Handy - Schild oben links, darunter Name und Ergebnis. */
function VetoGrid({ cards }: { cards: VetoCard[] }) {
  return (
    <View style={styles.veto} accessibilityLabel="Veto" testID="season-veto">
      {cards.map((card, index) => (
        <View
          key={card.key}
          style={[styles.vetoCard, card.outcome === "win" && styles.vetoWin, !card.played && !card.banned && styles.vetoUnplayed]}
          accessible
          accessibilityLabel={[card.label, card.name, card.score, card.result].filter(Boolean).join(", ")}
          testID={`season-veto-${card.key}`}
        >
          {card.outcome === "win" ? <Glow active delay={260 + index * 70} radius={6} /> : null}
          <MapImage uri={card.image} dim={card.banned}>
            <View style={[styles.vetoLabel, card.tone === "own" && styles.vetoLabelOwn, card.tone === "decider" && styles.vetoLabelDecider]}>
              <Muted style={[styles.vetoLabelText, card.tone !== "plain" && styles.vetoLabelTextDark]}>{card.label}</Muted>
            </View>
          </MapImage>
          <Body style={[styles.vetoName, card.banned && styles.struck]} numberOfLines={1}>{card.name}</Body>
          {card.score ? (
            <Muted style={styles.vetoResult}>
              <Body style={styles.vetoScore}>{card.score}</Body>
              {card.result ? <Muted style={[styles.vetoWord, card.outcome === "win" && { color: colors.cyan }]}>{` ${card.result}`}</Muted> : null}
            </Muted>
          ) : card.result ? <Muted style={styles.vetoWord}>{card.result}</Muted> : null}
        </View>
      ))}
    </View>
  );
}

/** Die Maps ohne Bilder: Name, Wahl, Ergebnis und ein kleiner Balken der eigenen Runden - ungespielt gedimmt. */
function MapList({ maps }: { maps: MapLine[] }) {
  if (!maps.length) return null;
  return (
    <View style={styles.maps} testID="season-maps">
      {maps.map((map, index) => (
        <View key={map.key} style={[styles.mapRow, !map.played && styles.mapUnplayed]} accessible accessibilityLabel={[map.name, map.pick, map.played ? map.score : "nicht gespielt"].filter(Boolean).join(", ")}>
          <View style={styles.mapTop}>
            <Body style={styles.mapName}>{map.name}</Body>
            {map.pick ? <Muted style={[styles.mapPick, map.pickOwn && { color: colors.cyan }]}>{map.pick}</Muted> : null}
            <View style={styles.flex} />
            <Body style={styles.mapScore}>{map.played ? map.score : "nicht gespielt"}</Body>
          </View>
          {map.played ? <ShareBar share={map.share} delay={index * 70} win={map.outcome === "win"} /> : null}
        </View>
      ))}
    </View>
  );
}

/** Der Balken einer Map füllt sich einmal von links - mit „Bewegung reduzieren“ sofort. */
function ShareBar({ share, delay, win }: { share: number; delay: number; win: boolean }) {
  const reduce = useReduceMotion();
  const fill = useRef(new Animated.Value(reduce ? share : 0)).current;
  useEffect(() => {
    if (reduce) {
      fill.setValue(share);
      return undefined;
    }
    const animation = Animated.timing(fill, { toValue: share, duration: 700, delay, easing: motionEasing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [delay, fill, reduce, share]);
  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.barFill, { backgroundColor: win ? colors.cyan : "rgba(255,255,255,0.35)", transform: [{ scaleX: fill }] }]} />
    </View>
  );
}

function OtherMatches({ card }: { card: MatchdayCard }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.others}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.othersToggle, pressed && styles.pressed]}
        testID={`season-matchday-others-${card.key}`}
      >
        <Muted style={styles.othersText}>{`Weitere Spiele (${card.others.length})`}</Muted>
        <Chevron open={open} />
      </Pressable>
      {open ? (
        <Reveal style={styles.othersList}>
          {card.others.map((other) => (
            <View key={other.key} style={styles.otherRow} accessible accessibilityLabel={`${other.home} ${other.score} ${other.away}`}>
              <Muted style={[styles.otherTeam, styles.otherHome]} numberOfLines={1}>{other.home}</Muted>
              <Body style={styles.otherScore}>{other.score}</Body>
              <Muted style={styles.otherTeam} numberOfLines={1}>{other.away}</Muted>
            </View>
          ))}
        </Reveal>
      ) : null}
    </View>
  );
}

export function LeagueTable({ page }: { page: SeasonPage }) {
  const rows = leagueTableRows(page);
  if (!rows.length) return <Muted style={styles.empty}>Die Tabelle steht hier nach dem ersten Spieltag.</Muted>;
  return (
    <View style={styles.table}>
      <View style={styles.tableHead}>
        <Muted style={[styles.headText, styles.pos]}>#</Muted>
        <Muted style={[styles.headText, styles.flex]}>Team</Muted>
        <Muted style={[styles.headText, styles.played]}>Sp.</Muted>
        <Muted style={[styles.headText, styles.points]}>Pkt.</Muted>
      </View>
      {rows.map((row) => (
        <View
          key={row.key}
          style={[styles.tableRow, row.own && styles.tableRowClub]}
          accessible
          accessibilityLabel={[`Platz ${row.pos}`, row.name, `${row.played} Spiele`, `${row.points} Punkte`, row.own ? "unser Team" : ""].filter(Boolean).join(", ")}
          testID={`season-league-${row.key}`}
        >
          <Body style={styles.pos}>{row.pos}</Body>
          <Body style={[styles.name, styles.flex, row.own && styles.nameClub]}>{row.name}</Body>
          <Body style={[styles.played, styles.playedText]}>{row.played}</Body>
          <Body style={styles.points}>{row.points}</Body>
        </View>
      ))}
    </View>
  );
}

const CELL_LOOK: Record<string, { bg: string; fg: string; text: string; word: string }> = {
  played: { bg: "rgba(41,182,232,0.18)", fg: colors.cyan, text: "✓", word: "gespielt" },
  bench: { bg: "rgba(255,255,255,0.08)", fg: ink.second, text: "E", word: "Ersatz" },
  "": { bg: "transparent", fg: ink.quiet, text: "–", word: "nicht dabei" },
};

/** Kader (#1931): wer an welchem Spieltag gespielt hat („E“ heißt Ersatz), Einsätze und über alle Saisons. */
export function Squad({ page }: { page: SeasonPage }) {
  const groups = squadGroups(page);
  if (!groups.length) return <Muted style={styles.empty}>Noch kein Kader und keine Aufstellung eingetragen.</Muted>;
  return (
    <View style={styles.squad} testID="season-squad">
      <Muted style={styles.intro}>Wer an welchem Spieltag gespielt hat, „E“ heißt Ersatz. Gäste zählen nicht in die Vereinsstatistik.</Muted>
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          {group.label ? <Muted style={styles.groupLabel}>{group.label}</Muted> : null}
          {group.players.map((player) => (
            <View
              key={player.key}
              style={styles.player}
              accessible
              accessibilityLabel={[player.name, player.member ? "Verein" : "", `Einsätze ${player.appearances}`, player.total ? `${player.total} über alle Saisons` : ""].filter(Boolean).join(", ")}
              testID={`season-squad-${player.key}`}
            >
              <View style={styles.flex}>
                <View style={styles.playerTop}>
                  <Body style={[styles.playerName, player.hidden && styles.nameHidden]} numberOfLines={1}>{player.name}</Body>
                  {player.member ? <Muted style={styles.memberChip}>Verein</Muted> : null}
                </View>
                {player.cells.length ? (
                  <View style={styles.cells}>
                    {player.cells.map((cell) => {
                      const look = CELL_LOOK[cell.state];
                      return (
                        <View key={cell.key} style={[styles.cell, { backgroundColor: look.bg }]} accessibilityLabel={`${cell.code}: ${look.word}`}>
                          <Muted style={[styles.cellText, { color: look.fg }]}>{look.text}</Muted>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
              <View style={styles.playerRight}>
                <Body style={styles.appearances}>{player.appearances}</Body>
                <Muted style={styles.total}>{player.total ? `${player.total} gesamt` : "Einsätze"}</Muted>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Maps (#1616): Statistik je Map aus den eigenen Spielen der Saison, darunter der Map-Pool. */
export function SeasonMaps({ page }: { page: SeasonPage }) {
  const stats = mapStatCards(page);
  const groups = poolGroups(page.map_pool);
  if (!stats.length && !groups.length) return <Muted style={styles.empty}>Noch keine Maps.</Muted>;
  return (
    <View style={styles.mapsTab}>
      {stats.length ? (
        <View style={styles.statsWrap} testID="season-map-stats">
          <Muted style={styles.intro}>Aus den eigenen Spielen der Saison: wie oft gespielt, gewonnen, gewählt und gebannt.</Muted>
          <View style={styles.statGrid}>
            {stats.map((stat) => (
              <View key={stat.key} style={styles.statCell} accessible accessibilityLabel={[stat.name, ...stat.figures.map((figure) => `${figure.label} ${figure.value}`)].join(", ")} testID={`season-map-stat-${stat.key}`}>
                <MapImage uri={stat.image}>
                  <View style={styles.statShade}>
                    <Body style={styles.statName} numberOfLines={1}>{stat.name}</Body>
                  </View>
                </MapImage>
                <View style={styles.figures}>
                  {stat.figures.map((figure) => (
                    <View key={figure.key} style={styles.figure}>
                      <Body style={[styles.figureValue, figure.key === "won" && { color: colors.cyan }]}>{String(figure.value)}</Body>
                      <Muted style={styles.figureLabel}>{figure.label}</Muted>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <MapPoolView title="Map-Pool" hint="Die Maps dieser Saison, je Modus." groups={groups} testID="season-map-pool" />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: ink.muted, paddingVertical: 14 },
  flex: { flex: 1, minWidth: 0 },
  cards: { gap: 10, paddingTop: 4 },
  card: { backgroundColor: surfaces.s1, borderColor: ink.cardLine, borderRadius: 12, borderWidth: 1, gap: 10, padding: 12 },
  cardToday: { borderColor: colors.cyan },
  cardCancelled: { opacity: 0.6 },
  cardHead: { alignItems: "center", flexDirection: "row", gap: 10 },
  code: { color: ink.muted, fontSize: 16, fontVariant: ["tabular-nums"], fontWeight: "800", minWidth: 40 },
  when: { color: ink.quiet, fontSize: 12 },
  opponent: { color: ink.text, fontSize: 15, fontWeight: "700", marginTop: 1 },
  ownTeam: { color: colors.cyan, fontSize: 15, fontWeight: "700" },
  score: { alignItems: "center", flexDirection: "row", gap: 6 },
  letter: { backgroundColor: surfaces.s2, borderRadius: 4, color: ink.muted, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1 },
  letterWin: { backgroundColor: "rgba(41,182,232,0.16)", color: colors.cyan },
  scoreText: { color: ink.text, fontSize: 20, fontVariant: ["tabular-nums"], fontWeight: "800" },
  block: { gap: 8 },
  blockDivided: { borderTopColor: ink.line, borderTopWidth: 1, paddingTop: 10 },
  blockHead: { alignItems: "center", flexDirection: "row", gap: 10 },
  bans: { color: ink.quiet, fontSize: 12 },
  veto: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  vetoCard: { borderColor: "rgba(255,255,255,0.1)", borderRadius: 8, borderWidth: 1, gap: 3, padding: 4, width: "31.8%" },
  vetoWin: { borderColor: colors.cyan },
  vetoUnplayed: { opacity: 0.65 },
  vetoLabel: { backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 3, left: 4, paddingHorizontal: 4, paddingVertical: 1, position: "absolute", top: 4 },
  vetoLabelOwn: { backgroundColor: colors.cyan },
  vetoLabelDecider: { backgroundColor: "rgba(255,215,0,0.9)" },
  vetoLabelText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  vetoLabelTextDark: { color: "#06121A" },
  vetoName: { color: ink.text, fontSize: 12, fontWeight: "700", paddingHorizontal: 2 },
  struck: { color: ink.muted, textDecorationLine: "line-through" },
  vetoResult: { paddingHorizontal: 2 },
  vetoScore: { color: ink.text, fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "800" },
  vetoWord: { color: ink.muted, fontSize: 11, paddingHorizontal: 2 },
  maps: { gap: 8 },
  mapRow: { gap: 4 },
  mapUnplayed: { opacity: 0.5 },
  mapTop: { alignItems: "center", flexDirection: "row", gap: 8 },
  mapName: { color: ink.soft, fontSize: 13, fontWeight: "700" },
  mapPick: { color: ink.quiet, fontSize: 11, fontWeight: "700" },
  mapScore: { color: ink.text, fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "800" },
  bar: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 99, height: 3, overflow: "hidden" },
  barFill: { height: "100%", transformOrigin: "left", width: "100%" },
  others: { borderTopColor: ink.line, borderTopWidth: 1, paddingTop: 4 },
  othersToggle: { alignItems: "center", flexDirection: "row", gap: 6, minHeight: 36 },
  othersText: { color: ink.second, fontSize: 13, fontWeight: "600" },
  othersList: { gap: 4, paddingBottom: 4 },
  otherRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  otherTeam: { color: ink.second, flex: 1, fontSize: 13 },
  otherHome: { textAlign: "right" },
  otherScore: { color: ink.text, fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "800", minWidth: 36, textAlign: "center" },
  table: { gap: 2 },
  tableHead: { flexDirection: "row", gap: 10, paddingHorizontal: 8, paddingVertical: 6 },
  headText: { color: ink.quiet, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  tableRow: { alignItems: "center", borderLeftColor: "transparent", borderLeftWidth: 3, borderRadius: 6, flexDirection: "row", gap: 10, paddingHorizontal: 8, paddingVertical: 10 },
  tableRowClub: { backgroundColor: "rgba(41,182,232,0.08)", borderLeftColor: colors.cyan },
  pos: { color: ink.muted, fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "800", width: 28 },
  name: { color: ink.text, fontSize: 15, fontWeight: "500" },
  nameClub: { fontWeight: "800" },
  nameHidden: { color: ink.muted, fontStyle: "italic" },
  played: { minWidth: 32, textAlign: "right" },
  playedText: { color: ink.second, fontSize: 15, fontVariant: ["tabular-nums"] },
  points: { color: ink.text, fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "800", minWidth: 44, textAlign: "right" },
  squad: { gap: 14 },
  intro: { color: ink.muted, fontSize: 13, lineHeight: 18 },
  group: { gap: 2 },
  groupLabel: { color: ink.quiet, fontSize: 11, fontWeight: "800", letterSpacing: 1.6, paddingBottom: 4, textTransform: "uppercase" },
  player: { alignItems: "center", borderBottomColor: ink.rowLine, borderBottomWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 10 },
  playerTop: { alignItems: "center", flexDirection: "row", gap: 6 },
  playerName: { color: ink.text, flexShrink: 1, fontSize: 15, fontWeight: "700" },
  memberChip: { borderColor: "rgba(41,182,232,0.45)", borderRadius: 4, borderWidth: 1, color: colors.cyan, fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 5, textTransform: "uppercase" },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: 3, marginTop: 6 },
  cell: { alignItems: "center", borderRadius: 3, height: 18, justifyContent: "center", width: 18 },
  cellText: { fontSize: 10, fontWeight: "800" },
  playerRight: { alignItems: "flex-end", minWidth: 64 },
  appearances: { color: ink.text, fontSize: 16, fontVariant: ["tabular-nums"], fontWeight: "800" },
  total: { color: ink.quiet, fontSize: 11 },
  mapsTab: { gap: 18 },
  statsWrap: { gap: 10 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCell: { gap: 6, width: "48.3%" },
  statShade: { backgroundColor: "rgba(0,0,0,0.55)", bottom: 0, left: 0, paddingHorizontal: 8, paddingVertical: 4, position: "absolute", right: 0 },
  statName: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  figures: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  figure: { minWidth: 44 },
  figureValue: { color: ink.text, fontSize: 16, fontVariant: ["tabular-nums"], fontWeight: "800" },
  figureLabel: { color: ink.quiet, fontSize: 10 },
  pressed: { opacity: 0.72 },
});
