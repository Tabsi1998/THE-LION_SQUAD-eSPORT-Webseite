import React from "react";
import { StyleSheet, View } from "react-native";
import { ListItemFadeIn, useListEntrance } from "../../FadeIn";
import { Body, Muted } from "../../Text";
import { ink } from "../parts";
import { driverCards, type SeasonPage } from "../../../lib/referenceSeason";
import { surfaces } from "../../../theme";

// Fahrer (Garage) einer Rennliga (#1945, #1974): je öffentlichem Vereinsfahrer Platz, Team mit „im Team seit“ (#1960),
// Punkte und seine Saison - mit Läufen (#1930) Poles je Runde, Ø Start und das Quali-Duell gegen den Teamkollegen -,
// darunter seine Anpassungen mit Grund (#1960). Die Karten bauen sich gestaffelt auf.

export function SeasonDrivers({ page }: { page: SeasonPage }) {
  const cards = driverCards(page);
  const entrance = useListEntrance();
  if (!cards.length) return <Muted style={styles.empty}>Hier stehen die Vereinsfahrer, sobald sie in der Wertung sind.</Muted>;
  return (
    <View style={styles.cards}>
      {cards.map((card, index) => (
        <ListItemFadeIn key={card.key} entrance={entrance} id={`driver-${card.key}`} index={index}>
          <View style={styles.card} testID={`season-driver-${card.key}`}>
            <View style={styles.cardTop}>
              <Body style={[styles.cardName, styles.flex]}>{card.name}</Body>
              {card.pos ? <Body style={styles.cardPos}>{card.pos}</Body> : null}
            </View>
            <Muted style={styles.cardMeta}>{card.meta}</Muted>
            {card.stats ? <Muted style={styles.cardStats}>{card.stats}</Muted> : null}
            {card.adjustments.length ? (
              <View style={styles.adjustments} accessibilityLabel="Anpassungen" testID={`season-driver-adjustments-${card.key}`}>
                {card.adjustments.map((item) => (
                  <View key={item.key} style={styles.adjustment}>
                    <Body style={[styles.adjustmentPoints, { color: item.negative ? "#FCA5A5" : "#6EE7B7" }]}>{item.points}</Body>
                    <Muted style={styles.adjustmentText}>{item.text}</Muted>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </ListItemFadeIn>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: ink.muted, paddingVertical: 14 },
  cards: { gap: 10, paddingTop: 4 },
  card: { backgroundColor: surfaces.s1, borderColor: ink.cardLine, borderRadius: 12, borderWidth: 1, gap: 6, padding: 14 },
  cardTop: { flexDirection: "row", gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  cardName: { color: ink.text, fontWeight: "700" },
  cardPos: { color: ink.text, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "800" },
  cardMeta: { color: ink.muted, fontSize: 13 },
  cardStats: { color: ink.second, fontSize: 13, lineHeight: 18 },
  adjustments: { borderTopColor: ink.line, borderTopWidth: 1, gap: 3, marginTop: 4, paddingTop: 8 },
  adjustment: { flexDirection: "row", gap: 8 },
  adjustmentPoints: { fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "800", minWidth: 28 },
  adjustmentText: { color: ink.second, flex: 1, fontSize: 13 },
});
