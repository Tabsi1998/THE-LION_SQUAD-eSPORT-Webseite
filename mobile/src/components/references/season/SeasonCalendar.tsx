import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ListItemFadeIn, useListEntrance } from "../../FadeIn";
import { Body, Muted } from "../../Text";
import { CountryFlag } from "../CountryFlag";
import { OriginalsButton } from "../OriginalViewer";
import { ink } from "../parts";
import { SessionChips, StateChip } from "../seriesParts";
import { roundRows, type SeasonPage, type SeasonRound } from "../../../lib/referenceSeason";
import { sessionKey } from "../../../lib/referenceRound";
import { colors, roles } from "../../../theme";

// Kalender einer Saison (#1945, #1974): je Runde eine Zeile (#1930) - Kürzel, Flagge und Ort, Stand der Runde, Tag, die
// Läufe als Chips mit Uhrzeit, „Ohne Wertung“ je Lauf (#1960) und je gewertetem Rennen Sieger bzw. bester
// Vereinsfahrer. Mit Rundennummer vom Server öffnet die Zeile das Ergebnis der Runde, ein Chip die Runde mit diesem
// Lauf (#1950). Die Zeilen bauen sich beim ersten Zeigen gestaffelt auf.

export function SeasonCalendar({ page, onOpenRound }: { page: SeasonPage; onOpenRound?: (round: number, session?: string) => void }) {
  const rows = roundRows(page);
  const entrance = useListEntrance();
  if (!rows.length) return <Muted style={styles.empty}>Noch keine Termine.</Muted>;
  return (
    <View>
      {rows.map((row, index) => {
        const number = row.number;
        const open = number && onOpenRound ? () => onOpenRound(number) : null;
        const body = (
          <>
            <Body style={[styles.code, row.final && { color: roles.honor }]}>{row.code}</Body>
            <View style={styles.roundBody}>
              <View style={styles.roundTop}>
                {row.country ? (
                  <View testID="season-round-country">
                    <CountryFlag code={row.country} height={15} />
                  </View>
                ) : null}
                <Body style={[styles.venue, row.tone === "cancelled" && styles.cancelled]}>{row.place || row.code}</Body>
                <View style={styles.spacer} />
                <StateChip label={row.state} tone={row.tone} />
              </View>
              <Muted style={styles.when}>{[row.when, row.moved].filter(Boolean).join(" · ")}</Muted>
              {row.sessions.length ? (
                <SessionChips<SeasonRound>
                  rounds={row.sessions}
                  onOpen={number && onOpenRound ? (round) => onOpenRound(number, sessionKey(round.session)) : null}
                  testID={`season-round-sessions-${row.key}`}
                />
              ) : null}
              {row.notes.map((note) => <Muted key={note} style={styles.note} testID="series-no-score">{note}</Muted>)}
              {row.results.map((line) => (line.kind === "winner"
                ? <Muted key={line.key} style={styles.who}>{`${line.label}: `}<Body style={styles.whoName}>{line.text}</Body></Muted>
                : <Muted key={line.key} style={styles.who}>{`${line.label}: ${line.text}`}</Muted>))}
            </View>
            {open ? <Ionicons name="chevron-forward" size={16} color={colors.cyan} style={styles.chevron} /> : null}
          </>
        );
        return (
          <ListItemFadeIn key={row.key} entrance={entrance} id={`round-${row.key}`} index={index}>
            <View style={styles.round}>
              {open ? (
                <Pressable
                  onPress={open}
                  accessibilityRole="button"
                  accessibilityLabel={[row.code, row.place, row.state, row.when, "Ergebnis ansehen"].filter(Boolean).join(", ")}
                  style={({ pressed }) => [styles.roundMain, pressed && styles.pressed]}
                  testID={`season-round-${row.key}`}
                >
                  {body}
                </Pressable>
              ) : (
                <View style={styles.roundMain} testID={`season-round-${row.key}`}>{body}</View>
              )}
              {/* Original-Bilder des Veranstalters (#1933) - neben der Zeile, damit der Vorleser den Knopf einzeln findet. */}
              <OriginalsButton items={row.originals} title={row.originalsTitle} style={styles.originals} testID={`season-round-originals-${row.key}`} />
            </View>
          </ListItemFadeIn>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: ink.muted, paddingVertical: 14 },
  round: { borderBottomColor: ink.rowLine, borderBottomWidth: 1, paddingVertical: 14 },
  roundMain: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  // Unter dem Text der Zeile: Kürzel (44) und Abstand (12) daneben.
  originals: { marginLeft: 56, marginTop: 8 },
  code: { color: ink.muted, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "800", width: 44 },
  roundBody: { flex: 1, gap: 6, minWidth: 0 },
  roundTop: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  venue: { color: ink.text, flexShrink: 1, fontSize: 15, fontWeight: "700" },
  cancelled: { color: ink.muted, textDecorationLine: "line-through" },
  spacer: { flex: 1 },
  when: { color: ink.quiet, fontSize: 13 },
  note: { color: "rgba(253,230,138,0.85)", fontSize: 12 },
  who: { color: ink.second, fontSize: 13 },
  whoName: { color: ink.text, fontSize: 13, fontWeight: "700" },
  chevron: { alignSelf: "center" },
  pressed: { opacity: 0.72 },
});
