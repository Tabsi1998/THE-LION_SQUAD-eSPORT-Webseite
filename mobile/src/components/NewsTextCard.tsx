import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LionArt } from "./LionArt";
import { Body, Muted } from "./Text";
import { newsCategoryColorDark, newsResult, textCardSentence } from "../lib/newsCards";
import { roles, surfaces } from "../theme";

// Text-Karte für News ohne Bild (#1912, App-Teil von #1343) - wie NewsTextCard.jsx im Web: statt leerer Fläche die
// dunkle Kategorie-Farbe mit einem Satz aus der News und dem angeschnittenen Vereinslöwen unten rechts. Ergebnis-News
// (der Server liefert `result`) zeigen stattdessen Pokal und „1. Sieger“ in Gold.
//
// size: "thumb" (kleines Vorschaubild in der Liste: Löwe; bei Ergebnis-News Pokal und Sieger klein), "md" (große Karte).

type Props = {
  news: { category?: string | null; excerpt?: string | null; summary?: string | null; title?: string | null; result?: { winner?: string; tournament?: string | null } | null };
  size?: "thumb" | "md";
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function NewsTextCard({ news, size = "md", style, testID = "news-text-card" }: Props) {
  const result = newsResult(news);
  const thumb = size === "thumb";
  return (
    <View
      style={[styles.card, { backgroundColor: result ? surfaces.s2 : newsCategoryColorDark(news.category) }, style]}
      testID={testID}
    >
      {result ? <View style={styles.glow} /> : null}
      <View style={[styles.lion, thumb ? styles.lionThumb : styles.lionMd]} pointerEvents="none">
        <LionArt art="plain" size={thumb ? 110 : 190} color={result ? "rgba(255,215,0,0.10)" : "rgba(255,255,255,0.12)"} testID={`${testID}-lion`} />
      </View>
      {result ? (
        <View style={[styles.body, thumb ? styles.bodyThumb : styles.bodyMd]}>
          <Ionicons name="trophy" color={roles.honor} size={thumb ? 18 : 28} />
          <Body style={[styles.winner, thumb ? styles.winnerThumb : styles.winnerMd]} numberOfLines={2} testID={`${testID}-winner`}>
            1. {result.winner}
          </Body>
          {!thumb && result.tournament ? <Muted style={styles.tournament} numberOfLines={1}>{result.tournament}</Muted> : null}
        </View>
      ) : !thumb ? (
        <View style={[styles.body, styles.bodyMd]}>
          <Body style={styles.sentence} numberOfLines={4} testID={`${testID}-sentence`}>{textCardSentence(news)}</Body>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", position: "relative" },
  // Sanfter Goldschein unten links wie der radiale Verlauf im Web.
  glow: { backgroundColor: "rgba(255,215,0,0.10)", borderRadius: 999, bottom: "-60%", height: "120%", left: "-30%", position: "absolute", width: "90%" },
  lion: { position: "absolute" },
  lionMd: { bottom: -46, right: -18 },
  lionThumb: { bottom: -34, right: -30 },
  body: { flex: 1, justifyContent: "flex-end" },
  bodyMd: { padding: 16, paddingRight: "30%" },
  bodyThumb: { gap: 2, padding: 8 },
  sentence: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", lineHeight: 24 },
  winner: { color: roles.honor, fontWeight: "900" },
  winnerMd: { fontSize: 22, lineHeight: 27, marginTop: 8 },
  winnerThumb: { fontSize: 12, lineHeight: 15 },
  tournament: { color: "rgba(255,255,255,0.65)", fontSize: 13, fontWeight: "600", marginTop: 2 },
});
