import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../Button";
import { CountUp } from "../../motion";
import { Body, Muted } from "../../Text";
import { FilterChip, Reveal, ink } from "../parts";
import { AdjustmentMark } from "../seriesParts";
import {
  adjustmentLines,
  mobileRows,
  racingRuleLines,
  racingTableRows,
  seasonKind,
  tableKinds,
  teamRuleLabel,
  type SeasonPage,
  type TableLine,
} from "../../../lib/referenceSeason";
import { ruleChangeLines, LINEUP_TOTAL_TEXT, teamDeviationText, teamModeLabel, teamSourceLabel } from "../../../lib/seriesSpecialRules";
import { countDelay, countsUp } from "../../../lib/countUp";
import { colors, surfaces } from "../../../theme";

// Tabelle einer Rennliga bzw. Turnierserie (#1945, #1974): Fahrer- oder Gesamtwertung, umschaltbar auf die Wertung je
// Lauf „Gesamt · Rennen · Sprint · Quali“ (#1930) und auf die Teams. Am Handy die ersten zehn und jedes Vereinsmitglied
// dahinter. Über der Tabelle der Ablauf je Runde (Punkte je Lauf, umgekehrte Startaufstellung) und die
// Regeländerungen (#1960); an den Punkten die Marke „−5“, darunter die Anpassungen mit Grund - am Handy gibt es keinen
// Tooltip. Bei den Teams Quelle und Modus der Teamwertung, „aktuelle Besetzung“ und die Abweichung zur eigenen Rechnung.
// Sonderboni einer Turnierserie (#1961) stehen klein unter den Punkten.

export function SeasonStandings({ page }: { page: SeasonPage }) {
  const [scope, setScope] = useState<"drivers" | "teams">("drivers");
  const [kind, setKind] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const racing = seasonKind(page) === "racing";
  const hasTeams = racingTableRows(page, "teams").length > 0;
  const shownScope = hasTeams ? scope : "drivers";
  const kinds = shownScope === "drivers" ? tableKinds(page) : [];
  const shownKind = kinds.some((item) => item.key === kind) ? kind : "all";
  const all = racingTableRows(page, shownScope, shownKind);
  const shown = mobileRows(all, { expanded });
  const adjustments = shownKind === "all" ? adjustmentLines(page, shownScope) : [];
  const rules = racing && shownScope === "drivers" ? racingRuleLines(page) : [];
  const changes = racing && shownScope === "drivers" ? ruleChangeLines(page.rule_changes) : [];
  if (!all.length) return <Muted style={styles.empty}>Die Tabelle steht hier nach der ersten gewerteten Runde.</Muted>;
  return (
    <View style={styles.wrap}>
      {hasTeams ? (
        <View style={styles.scope}>
          <FilterChip label={racing ? "Fahrer" : "Gesamt"} selected={shownScope === "drivers"} onPress={() => setScope("drivers")} testID="season-table-scope-drivers" />
          <FilterChip label="Teams" selected={shownScope === "teams"} onPress={() => setScope("teams")} testID="season-table-scope-teams" />
        </View>
      ) : null}
      {kinds.length ? (
        <View style={styles.kinds} accessibilityLabel="Wertung je Lauf" testID="season-table-kinds">
          {kinds.map((item) => {
            const on = item.key === shownKind;
            return (
              <Pressable
                key={item.key}
                onPress={() => setKind(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={item.key === "all" ? "Gesamt" : `${item.label}-Wertung`}
                style={({ pressed }) => [styles.kind, on && styles.kindOn, pressed && styles.pressed]}
                testID={`season-table-kind-${item.key}`}
              >
                <Body style={[styles.kindText, on && styles.kindTextOn]}>{item.label}</Body>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {rules.length || changes.length ? (
        <View style={styles.rules} testID="season-table-rules">
          {rules.map((line) => <Muted key={line.key} style={styles.rule}><Muted style={styles.ruleLabel}>{`${line.label} `}</Muted>{line.text}</Muted>)}
          {changes.length ? (
            <View style={styles.changes} accessibilityLabel="Regeländerungen" testID="series-rule-changes">
              <Muted style={styles.changesHead}>Regeländerungen</Muted>
              {changes.map((line) => (
                <View key={line.key} style={styles.change}>
                  <Body style={styles.changeHead}>{line.head}</Body>
                  <Muted style={styles.changeText}>{line.text}</Muted>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {shownScope === "teams" ? <TeamSource page={page} /> : null}
      {shownKind !== "all" ? <Muted style={styles.caption}>{`${kinds.find((item) => item.key === shownKind)?.label}-Wertung`}</Muted> : null}
      <TableRows rows={shown} idPrefix="season-table" page={page} playKey={`${shownScope}:${shownKind}`} />
      {shown.length < all.length ? (
        <Button label={`Ganze Tabelle zeigen (${all.length})`} variant="quiet" compact onPress={() => setExpanded(true)} testID="season-table-all" style={styles.more} />
      ) : null}
      {adjustments.length ? (
        <View style={styles.adjustments} accessibilityLabel="Anpassungen" testID="series-adjustments">
          <Muted style={styles.changesHead}>Anpassungen</Muted>
          {adjustments.map((item) => (
            <View key={item.key} style={styles.adjustment}>
              <Body style={[styles.adjustmentPoints, { color: item.negative ? "#FCA5A5" : "#6EE7B7" }]}>{item.points}</Body>
              <Muted style={styles.adjustmentText}>{item.text}</Muted>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Quelle und Modus der Teamwertung (#1960) - weicht die Wertung des Veranstalters von der eigenen Rechnung ab, je Team
 * ein Prüfhinweis zum Aufklappen. */
function TeamSource({ page }: { page: SeasonPage }) {
  const [open, setOpen] = useState(false);
  const teams = page.racing?.teams;
  const scoring = page.racing?.team_scoring;
  const rule = teamRuleLabel(scoring);
  if (!teams) return null;
  const deviations = (teams.rows || []).map(teamDeviationText).filter(Boolean);
  return (
    <View style={styles.rules} testID="racing-team-source">
      {rule ? <Muted style={styles.rule}>{rule}</Muted> : null}
      <Muted style={styles.rule}>
        <Muted style={styles.ruleLabel}>Quelle </Muted>{teamSourceLabel(teams, page.rounds)}
        <Muted style={styles.ruleLabel}> · Modus </Muted>{teamModeLabel(scoring)}
      </Muted>
      {scoring?.mode === "current_lineup" ? <Muted style={styles.note} testID="racing-team-lineup-note">{LINEUP_TOTAL_TEXT}</Muted> : null}
      {deviations.length ? (
        <View>
          <Pressable onPress={() => setOpen((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.toggle} testID="racing-team-deviations">
            <Muted style={styles.toggleText}>{`Eigene Rechnung weicht bei ${deviations.length === 1 ? "einem Team" : `${deviations.length} Teams`} ab`}</Muted>
          </Pressable>
          {open ? (
            <Reveal style={styles.deviations}>
              {deviations.map((line) => <Muted key={line} style={styles.note}>{line}</Muted>)}
            </Reveal>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// Punkte zählen beim Öffnen und bei jedem Wechsel von Wertung oder Teams hoch (#1969), je Zeile leicht versetzt.
function TableRows({ rows, idPrefix, page, playKey }: { rows: TableLine[]; idPrefix: string; page: SeasonPage; playKey: string }) {
  return (
    <View style={styles.table}>
      {rows.map((row, index) => (
        <View
          key={row.key}
          style={[styles.tableRow, row.club && styles.tableRowClub]}
          accessible
          accessibilityLabel={[`Platz ${row.pos}`, row.name, row.team, `${row.points} Punkte`, row.bonus ? `davon ${row.bonus} Sonderbonus` : "", ...row.driverMarks.map((mark) => mark.title), row.club ? "Verein" : ""].filter(Boolean).join(", ")}
          testID={`${idPrefix}-${row.key}`}
        >
          <Body style={styles.pos}>{row.pos}</Body>
          <View style={styles.flex}>
            <Body style={[styles.name, row.club && styles.nameClub, row.hidden && styles.nameHidden]}>{row.name}</Body>
            {row.team ? <Muted style={styles.team}>{row.team}</Muted> : null}
          </View>
          <View style={styles.pointsBox}>
            <View style={styles.pointsLine}>
              {row.adjust ? <AdjustmentMark row={row.adjust} rounds={page.rounds || []} /> : null}
              <CountUp value={row.points} playKey={playKey} delay={countDelay(index)} play={countsUp(index)} style={styles.points} />
            </View>
            {row.bonus ? <Muted style={styles.bonus} testID="season-table-bonus">{`${row.bonus} Boni`}</Muted> : null}
            {/* Fahrer-Anpassungen, die fürs Team zählen (#2000): „−5 (Anna Probe)“ klein unter der Teamsumme. */}
            {row.driverMarks.map((mark) => (
              <Muted key={mark.key} style={[styles.driverMark, { color: mark.negative ? "#FCA5A5" : "#6EE7B7" }]} testID="season-table-driver-adjustment">{mark.text}</Muted>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  empty: { color: ink.muted, paddingVertical: 14 },
  scope: { flexDirection: "row", gap: 6 },
  kinds: { alignSelf: "flex-start", backgroundColor: surfaces.s1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 8, borderWidth: 1, flexDirection: "row", padding: 3 },
  kind: { borderRadius: 6, justifyContent: "center", minHeight: 34, paddingHorizontal: 12 },
  kindOn: { backgroundColor: "rgba(41,182,232,0.16)" },
  kindText: { color: ink.muted, fontSize: 13, fontWeight: "700" },
  kindTextOn: { color: ink.text },
  rules: { gap: 4 },
  rule: { color: ink.second, fontSize: 13, lineHeight: 18 },
  ruleLabel: { color: ink.quiet, fontSize: 13 },
  note: { color: ink.quiet, fontSize: 12, lineHeight: 17 },
  changes: { borderLeftColor: "rgba(41,182,232,0.5)", borderLeftWidth: 2, gap: 4, marginTop: 4, paddingLeft: 10 },
  changesHead: { color: ink.quiet, fontSize: 11, fontWeight: "800", letterSpacing: 1.6, textTransform: "uppercase" },
  change: { gap: 1 },
  changeHead: { color: ink.text, fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "700" },
  changeText: { color: ink.second, fontSize: 13 },
  toggle: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
  toggleText: { color: colors.cyan, fontSize: 12, textDecorationLine: "underline" },
  deviations: { gap: 2 },
  caption: { color: ink.quiet, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  table: { gap: 2 },
  tableRow: { alignItems: "center", borderLeftColor: "transparent", borderLeftWidth: 3, borderRadius: 6, flexDirection: "row", gap: 10, paddingHorizontal: 8, paddingVertical: 10 },
  tableRowClub: { backgroundColor: "rgba(41,182,232,0.08)", borderLeftColor: colors.cyan },
  pos: { color: ink.muted, fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "800", width: 28 },
  flex: { flex: 1, minWidth: 0 },
  name: { color: ink.text, fontSize: 15, fontWeight: "500" },
  nameClub: { fontWeight: "800" },
  nameHidden: { color: ink.muted, fontStyle: "italic" },
  team: { color: ink.quiet, fontSize: 12 },
  pointsBox: { alignItems: "flex-end", minWidth: 44 },
  pointsLine: { alignItems: "baseline", flexDirection: "row", gap: 6 },
  points: { color: ink.text, fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "800", textAlign: "right" },
  bonus: { color: "#FFD700", fontSize: 11, fontVariant: ["tabular-nums"] },
  driverMark: { fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "700", textAlign: "right" },
  more: { alignSelf: "flex-start" },
  adjustments: { borderTopColor: ink.line, borderTopWidth: 1, gap: 4, paddingTop: 10 },
  adjustment: { flexDirection: "row", gap: 8 },
  adjustmentPoints: { fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "800", minWidth: 28 },
  adjustmentText: { color: ink.second, flex: 1, fontSize: 13 },
  pressed: { opacity: 0.72 },
});
