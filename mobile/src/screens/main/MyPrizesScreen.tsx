import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Muted } from "../../components/Text";
import { api } from "../../lib/api";
import { prizeTarget } from "../../lib/prizes";
import type { AppStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { PrizePickup } from "../../types";
import { PrizeCard, profileStyles, Stat } from "./profile/parts";

// Meine Gewinne (#1149): früher ein Reiter im Profil, jetzt hinter „Nur für dich“ - Preise aus Turnieren und Fast-Lap-
// Challenges, sobald sie für dein Konto oder Team hinterlegt sind. Ein Tipp öffnet das Turnier oder die Fast Lap.

type Props = NativeStackScreenProps<AppStackParamList, "MyPrizes">;

export function prizeCounts(prizes: PrizePickup[]) {
  return {
    open: prizes.filter((item) => ["pending", "ready"].includes(String(item.status || "pending"))).length,
    ready: prizes.filter((item) => String(item.status || "") === "ready").length,
    pickedUp: prizes.filter((item) => String(item.status || "") === "picked_up").length,
  };
}

export function MyPrizesScreen({ navigation }: Props) {
  const [prizes, setPrizes] = useState<PrizePickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get<PrizePickup[]>("/prizes/me");
      setPrizes(Array.isArray(data) ? data : []);
    } catch {
      setPrizes([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const counts = useMemo(() => prizeCounts(prizes), [prizes]);

  const open = (item: PrizePickup) => {
    const target = prizeTarget(item);
    if (!target.id) return;
    navigation.navigate(target.kind === "fastlap" ? "FastLapDetail" : "TournamentDetail", { id: target.id });
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.gold} />}>
        <Card style={profileStyles.card}>
          <Muted>Preise aus Turnieren und Fast-Lap-Challenges, sobald sie für dein Konto oder Team hinterlegt sind.</Muted>
          <View style={profileStyles.statGrid}>
            <Stat label="Offen" value={String(counts.open)} />
            <Stat label="Bereit" value={String(counts.ready)} tone="gold" />
            <Stat label="Abgeholt" value={String(counts.pickedUp)} />
          </View>
        </Card>
        {loading ? <SkeletonList count={3} hasImage={false} /> : null}
        {!loading && !prizes.length ? (
          <EmptyState icon="trophy-outline" title="Noch keine Gewinne" detail="Sobald ein Preis für dich oder dein Team eingetragen wird, erscheint er hier." tone="gold" />
        ) : null}
        {prizes.map((item) => <PrizeCard key={item.id} item={item} onOpen={open} />)}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 32,
  },
});
