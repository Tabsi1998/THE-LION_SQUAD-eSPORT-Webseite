import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { FadeIn, ListItemFadeIn, useListEntrance } from "../../FadeIn";
import { Body, Muted } from "../../Text";
import { FilterChip, ink, medalTone } from "../parts";
import { roundWhen, type SeasonPage } from "../../../lib/referenceSeason";
import { bonusRulesLabel, dayLines, dayRounds, dayRoundsLabel, dayTable, hasLobbies, isDoubleUp, lobbies, placeTone, roundsOfDay, type PlaceTone } from "../../../lib/seriesDays";
import { formatNumber, roundLabel } from "../../../lib/seriesFormat";
import { colors, roles } from "../../../theme";

// Turniertage einer Turnierserie (#1961, #1974) nach der Handy-Ansicht der Serienseite: Chips je Turniertag (der letzte
// zuerst gewählt), darüber die Regeln (Runden je Tag, Sonderboni); je Spieler der Tagesplatz, R1…Rn in der Farbe des
// Platzes, GES P und die Saisonpunkte - gestrichene durchgestrichen; bei Double Up „mit Partner“; Abzeichen
// „Ausgestiegen“ und „Bingo +3“. Mit Lobbys umschaltbar auf die Lobbys je Runde. Zeilen bauen sich gestaffelt auf.

const TONES: Record<NonNullable<PlaceTone>, { fg: string; bg: string }> = {
  gold: { fg: medalTone(1)?.fg || roles.honor, bg: "rgba(255,215,0,0.12)" },
  silver: { fg: medalTone(2)?.fg || roles.silver, bg: "rgba(201,206,214,0.12)" },
  bronze: { fg: medalTone(3)?.fg || roles.bronze, bg: "rgba(208,138,78,0.12)" },
  top: { fg: roles.ok, bg: "rgba(31,208,142,0.1)" },
};

export function TournamentDays({ page }: { page: SeasonPage }) {
  const rounds = dayRounds(page);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "lobbies">("table");
  const [lobbyRound, setLobbyRound] = useState(0);
  const current = rounds.find((round) => round.id === picked) || rounds[rounds.length - 1];
  if (!current) return <Muted style={styles.empty}>Noch keine Turniertage.</Muted>;
  const table = dayTable(page.standings?.rows, current.id);
  const count = roundsOfDay(table);
  const lines = dayLines(page, current.id);
  const withLobbies = hasLobbies(table);
  const shownView = withLobbies ? view : "table";
  const rules = [
    { key: "day", label: "Turniertag", text: dayRoundsLabel(page.rules) },
    { key: "bonus", label: "Boni", text: bonusRulesLabel(page.rules) },
  ].filter((line) => line.text);
  return (
    <View style={styles.wrap} testID="season-days">
      {rules.length ? (
        <View style={styles.rules}>
          {rules.map((line) => <Muted key={line.key} style={styles.rule}><Muted style={styles.ruleLabel}>{`${line.label} `}</Muted>{line.text}</Muted>)}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Turniertage">
        {rounds.map((round) => (
          <FilterChip key={round.id} label={roundLabel(round)} selected={round.id === current.id} onPress={() => { setPicked(round.id); setLobbyRound(0); }} testID={`season-day-${round.id}`} />
        ))}
      </ScrollView>
      {withLobbies ? (
        <View style={styles.views}>
          <FilterChip label="Tabelle" selected={shownView === "table"} onPress={() => setView("table")} testID="season-days-table" />
          <FilterChip label="Lobbys" selected={shownView === "lobbies"} onPress={() => setView("lobbies")} testID="season-days-lobbies" />
        </View>
      ) : null}
      <View style={styles.headLine}>
        <Muted style={styles.when}>{roundWhen(current)}</Muted>
        {isDoubleUp(table) ? <Muted style={styles.doubleUp} testID="season-days-double-up">Double Up</Muted> : null}
      </View>
      <Muted style={styles.hint}>{`${count ? `${count} ${count === 1 ? "Runde" : "Runden"} · ` : ""}GES P bestimmt den Tagesplatz, daraus die Saisonpunkte`}</Muted>
      <FadeIn trigger={`${current.id}-${shownView}-${lobbyRound}`}>
        {shownView === "table" ? <DayTable lines={lines} dayKey={current.id} /> : <Lobbies page={page} table={table} count={count} index={lobbyRound} onPick={setLobbyRound} />}
      </FadeIn>
    </View>
  );
}

function DayTable({ lines, dayKey }: { lines: ReturnType<typeof dayLines>; dayKey: string }) {
  const entrance = useListEntrance();
  return (
    <View style={styles.list}>
      {lines.map((line, index) => {
        const tone = line.tone ? TONES[line.tone] : null;
        return (
          <ListItemFadeIn key={line.key} entrance={entrance} id={`${dayKey}-${line.key}`} index={index}>
            <View
              style={[styles.row, line.club && styles.rowClub]}
              accessible
              accessibilityLabel={[`Platz ${line.place}`, line.name, line.partner, ...line.badges, `GES P ${line.total}`, `${line.points} Saisonpunkte${line.dropped ? ", gestrichen" : ""}`, line.club ? "Verein" : ""].filter(Boolean).join(", ")}
              testID={`season-day-row-${line.key}`}
            >
              <View style={[styles.place, tone ? { backgroundColor: tone.bg } : null]}>
                <Body style={[styles.placeText, tone ? { color: tone.fg } : null]}>{line.place}</Body>
              </View>
              <View style={styles.flex}>
                <View style={styles.nameLine}>
                  <Body style={[styles.name, line.hidden && styles.hidden, line.club && styles.nameClub]} numberOfLines={1}>{line.name}</Body>
                  {line.club ? <Muted style={styles.club}>Verein</Muted> : null}
                </View>
                {line.partner ? <Muted style={styles.partner}>{line.partner}</Muted> : null}
                {line.badges.length ? (
                  <View style={styles.badges}>
                    {line.badges.map((badge) => <Muted key={badge} style={[styles.badge, badge === "Ausgestiegen" && styles.badgeLeft]}>{badge}</Muted>)}
                  </View>
                ) : null}
                {line.cells.length ? (
                  <View style={styles.cells}>
                    {line.cells.map((cell) => {
                      const look = cell.tone ? TONES[cell.tone] : null;
                      return (
                        <View key={cell.key} style={[styles.cell, look ? { backgroundColor: look.bg } : null]} accessible accessibilityLabel={cell.label}>
                          <Muted style={styles.cellCode}>{cell.key}</Muted>
                          <Body style={[styles.cellText, look ? { color: look.fg } : null]}>{cell.text}</Body>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
              <View style={styles.right}>
                <Body style={styles.total}>{line.total}</Body>
                <Muted style={[styles.points, line.dropped && styles.dropped]}>{`${line.points} Pkt`}</Muted>
              </View>
            </View>
          </ListItemFadeIn>
        );
      })}
    </View>
  );
}

function Lobbies({ page, table, count, index, onPick }: { page: SeasonPage; table: ReturnType<typeof dayTable>; count: number; index: number; onPick: (index: number) => void }) {
  const scheme = (page.rules?.day_rounds?.points_by_place || []).map(Number);
  const groups = lobbies(table, index, scheme);
  return (
    <View style={styles.lobbyWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Runden">
        {Array.from({ length: count }, (_, position) => (
          <FilterChip key={position} label={`R${position + 1}`} selected={position === index} onPress={() => onPick(position)} testID={`season-lobby-round-${position + 1}`} />
        ))}
      </ScrollView>
      {groups ? groups.map((group) => (
        <View key={group.lobby} style={styles.lobby} testID={`season-lobby-${group.lobby}`}>
          <Muted style={styles.lobbyHead}>{`Lobby ${group.lobby}`}</Muted>
          {group.members.map(({ item, entry, place }) => {
            const tone = placeTone(place);
            const look = tone ? TONES[tone] : null;
            return (
              <View key={item.key} style={styles.lobbyRow} accessible accessibilityLabel={[place ? `Platz ${place}` : "", item.name, `${formatNumber(entry.points)} Punkte`].filter(Boolean).join(", ")}>
                <Body style={[styles.lobbyPlace, look ? { color: look.fg } : null]}>{place ? String(place) : "–"}</Body>
                <Body style={[styles.lobbyName, item.hidden && styles.hidden, item.club_member && styles.nameClub]} numberOfLines={1}>{item.name}</Body>
                <Body style={styles.lobbyPoints}>{formatNumber(entry.points)}</Body>
              </View>
            );
          })}
        </View>
      )) : <Muted style={styles.empty}>Für diese Runde sind keine Lobbys eingetragen.</Muted>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  empty: { color: ink.muted, paddingVertical: 14 },
  rules: { gap: 4 },
  rule: { color: ink.second, fontSize: 13, lineHeight: 18 },
  ruleLabel: { color: ink.quiet, fontSize: 13 },
  chips: { gap: 6, paddingRight: 4 },
  views: { flexDirection: "row", gap: 6 },
  headLine: { alignItems: "center", flexDirection: "row", gap: 8 },
  when: { color: ink.second, fontSize: 13 },
  doubleUp: { backgroundColor: "rgba(159,122,234,0.16)", borderRadius: 4, color: roles.event, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1, textTransform: "uppercase" },
  hint: { color: ink.quiet, fontSize: 12 },
  list: { gap: 2 },
  row: { alignItems: "flex-start", borderBottomColor: ink.rowLine, borderBottomWidth: 1, borderLeftColor: "transparent", borderLeftWidth: 3, flexDirection: "row", gap: 10, paddingHorizontal: 6, paddingVertical: 10 },
  rowClub: { backgroundColor: "rgba(41,182,232,0.06)", borderLeftColor: colors.cyan, borderRadius: 6 },
  place: { alignItems: "center", borderRadius: 6, height: 30, justifyContent: "center", width: 30 },
  placeText: { color: ink.text, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "800" },
  flex: { flex: 1, minWidth: 0 },
  nameLine: { alignItems: "center", flexDirection: "row", gap: 6 },
  name: { color: ink.text, flexShrink: 1, fontSize: 15, fontWeight: "600" },
  nameClub: { fontWeight: "800" },
  hidden: { color: ink.muted, fontStyle: "italic" },
  club: { borderColor: "rgba(41,182,232,0.45)", borderRadius: 4, borderWidth: 1, color: colors.cyan, fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 5, textTransform: "uppercase" },
  partner: { color: ink.second, fontSize: 12 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 3 },
  badge: { backgroundColor: "rgba(255,215,0,0.12)", borderRadius: 4, color: roles.honor, fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 5, paddingVertical: 1 },
  badgeLeft: { backgroundColor: "rgba(255,159,67,0.12)", color: roles.warn },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  cell: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 4, minWidth: 30, paddingHorizontal: 4, paddingVertical: 2 },
  cellCode: { color: ink.quiet, fontSize: 9, fontWeight: "700" },
  cellText: { color: ink.second, fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "800" },
  right: { alignItems: "flex-end", minWidth: 52 },
  total: { color: ink.text, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "800" },
  points: { color: ink.quiet, fontSize: 12, fontVariant: ["tabular-nums"] },
  dropped: { textDecorationLine: "line-through" },
  lobbyWrap: { gap: 10 },
  lobby: { borderColor: ink.cardLine, borderRadius: 10, borderWidth: 1, gap: 4, padding: 10 },
  lobbyHead: { color: ink.quiet, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, paddingBottom: 2, textTransform: "uppercase" },
  lobbyRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  lobbyPlace: { color: ink.muted, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "800", width: 22 },
  lobbyName: { color: ink.text, flex: 1, fontSize: 14 },
  lobbyPoints: { color: ink.text, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "800" },
});
