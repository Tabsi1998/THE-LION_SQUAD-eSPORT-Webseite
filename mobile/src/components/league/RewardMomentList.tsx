import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { artLines, metalColor, type RewardAward } from "../../lib/leagueRewards";
import { radius, surfaces } from "../../theme";
import { Glow, StaggerIn } from "../motion";
import { Body, Muted } from "../Text";
import { RewardArt } from "./RewardArt";

// Die Belohnungen einer Zeremonie (#2173, Web: RewardCardContent in components/tls/rewards/RewardMoment.jsx): je Belohnung die Vorlage,
// Art, Name und Season - gestaffelt, jede Vorlage leuchtet einmal in ihrem Metall auf. Dieselbe Liste in der Belohnungs-Zeremonie und
// als zweite Karte des Meister-Moments (#2584). Lange Namen brechen um, nichts wird abgeschnitten.

export function RewardMomentList({ rewards }: { rewards: RewardAward[] }) {
  return (
    <StaggerIn style={styles.list}>
      {rewards.map((award, index) => (
        <View key={award.id} style={[styles.row, { borderColor: metalColor(award.reward?.art?.metal) }]} testID={`reward-moment-${award.id}`}>
          <RewardArt reward={award.reward} size={56} />
          <View style={styles.text}>
            <Text style={[styles.kind, { color: metalColor(award.reward?.art?.metal) }]}>{award.reward?.kind_label}</Text>
            <Body style={styles.name}>{award.reward?.name}</Body>
            <Muted style={styles.meta}>{artLines(award.reward?.art).join(" · ")}</Muted>
            {award.team?.name ? <Muted style={styles.meta}>{award.team.name}</Muted> : null}
          </View>
          <Glow active color={metalColor(award.reward?.art?.metal)} peak={0.25} delay={300 + index * 120} />
        </View>
      ))}
    </StaggerIn>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { alignItems: "center", backgroundColor: surfaces.s1, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 12, overflow: "hidden", padding: 10 },
  text: { flex: 1, minWidth: 0 },
  kind: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  name: { fontWeight: "900" },
  meta: { fontSize: 12 },
});
