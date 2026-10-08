import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MemberCardArt } from "../../components/MemberCardArt";
import { QrCode } from "../../components/QrCode";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { cardExpired, refreshDelayMs, validUntilLine, type MemberCard } from "../../lib/memberCard";
import { loadOfflineCard, saveOfflineCard, standLine, type OfflineCard } from "../../lib/memberCardOffline";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Die Mitgliedskarte (#346): Name, Nummer, Art, gültig bis - und ein QR-Code, den ein Partner
// mit der Handykamera prüft. Der Code erneuert sich vor Ablauf von selbst und sobald die App
// aus dem Hintergrund zurückkommt. Seit #1335 sieht die Karte aus wie im Web (schwarz mit Gold, Lichtkante); der
// Prüfcode steht groß darunter auf Weiß, damit er sich gut scannen lässt. Ohne Netz (#1256) erscheint die zuletzt
// geladene Karte mit „Stand“ - statt des Codes „Prüfcode braucht Netz“, wie auf der Website.

type Props = NativeStackScreenProps<MoreStackParamList, "MemberCard">;

export function MemberCardScreen(_: Props) {
  const { user } = useAuth();
  const userId = user?.id || "";
  const [card, setCard] = useState<MemberCard | null>(null);
  const [offline, setOffline] = useState<OfflineCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<MemberCard>("/account/member-card");
      setCard(data);
      setOffline(null);
      // Nur was auf der Karte steht, nur für dieses Konto - für den Fall, dass am Eingang das Netz fehlt.
      if (data?.status === "valid") await saveOfflineCard(userId, data);
    } catch (err) {
      setError(errorMessage(err, "Die Karte konnte nicht geladen werden."));
      setOffline(await loadOfflineCard(userId));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Erneuern, bevor der Code abläuft.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const delay = refreshDelayMs(card);
    if (delay === null) return undefined;
    timer.current = setTimeout(load, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [card, load]);

  // Aus dem Hintergrund zurück: sofort prüfen, ob der Code noch gilt.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && cardExpired(card)) load();
    });
    return () => subscription.remove();
  }, [card, load]);

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={2} hasImage={false} />
      </Screen>
    );
  }

  if ((!card || card.status !== "valid") && offline) {
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={styles.content}>
          <View testID="member-card-offline" style={styles.stack}>
            <MemberCardArt name={offline.card.name} number={offline.card.member_number} since={offline.card.member_since} typeLabel={offline.card.type_label} validUntil={offline.card.valid_until} clubName={offline.card.club_name} />
            <Card style={styles.card}>
              <View style={styles.offlineBox}>
                <Ionicons name="cloud-offline-outline" color={colors.gold} size={28} />
                <Body style={styles.offlineTitle}>Prüfcode braucht Netz</Body>
                <Muted style={styles.hint} testID="member-card-offline-stand">{standLine(offline.saved_at)}</Muted>
              </View>
            </Card>
          </View>
          <Muted style={styles.hint}>Ohne Netz zeigt die App die zuletzt geladene Karte. Den Prüfcode für Partner gibt es, sobald wieder Netz da ist – er gilt nur fünf Minuten.</Muted>
          <Pressable onPress={load} accessibilityRole="button" testID="member-card-retry" style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
            <Ionicons name="refresh-outline" color={colors.gold} size={16} />
            <Body style={styles.retryText}>Noch einmal versuchen</Body>
          </Pressable>
        </ScrollView>
      </Screen>
    );
  }

  if (!card || card.status !== "valid") {
    return (
      <Screen>
        <EmptyState
          icon="card-outline"
          tone="gold"
          title={card?.status === "ended" ? "Mitgliedschaft beendet" : error ? "Karte nicht verfügbar" : "Keine Mitgliedskarte"}
          detail={error || (card?.status === "ended" ? "Deine Mitgliedschaft ist ausgelaufen. Bei Fragen hilft die Vereinsverwaltung." : "Die Karte gibt es für aktive Vereinsmitglieder. Unter „Mitgliedschaft“ kannst du die Zuordnung anfragen.")}
        />
        {error ? (
          <Pressable onPress={load} accessibilityRole="button" style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
            <Body style={styles.retryText}>Noch einmal versuchen</Body>
          </Pressable>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View testID="member-card" style={styles.stack}>
          <MemberCardArt name={card.name} number={card.member_number} since={card.member_since} typeLabel={card.type_label} validUntil={card.valid_until} clubName={card.club_name} />
          <Card style={styles.card}>
            <View style={styles.qrWrap}>
              <QrCode value={card.verify_url} size={224} testID="member-card-qr" />
            </View>
            <Body style={styles.valid}>{validUntilLine(card)}</Body>
          </Card>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        <Muted style={styles.hint}>
          Zum Prüfen scannt ein Partner den Code mit der Handykamera und sieht nur: gültig, dein Vorname, die Mitgliedsart. Der Code erneuert sich alle paar Minuten – ein Foto davon gilt nicht.
        </Muted>
        <Pressable onPress={load} accessibilityRole="button" testID="member-card-refresh" style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
          <Ionicons name="refresh-outline" color={colors.gold} size={16} />
          <Body style={styles.retryText}>Code erneuern</Body>
        </Pressable>
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
  stack: {
    gap: 14,
  },
  card: {
    backgroundColor: colors.black,
    gap: 12,
    padding: 18,
  },
  qrWrap: {
    alignItems: "center",
  },
  offlineBox: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
  },
  offlineTitle: {
    color: colors.white,
    fontWeight: "900",
  },
  valid: {
    color: colors.white,
    textAlign: "center",
  },
  hint: {
    textAlign: "center",
  },
  retry: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 8,
    paddingVertical: 8,
  },
  retryText: {
    color: colors.gold,
    fontWeight: "900",
  },
  error: {
    color: colors.live,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
