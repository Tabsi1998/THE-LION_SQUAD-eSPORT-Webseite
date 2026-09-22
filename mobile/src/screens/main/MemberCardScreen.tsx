import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { QrCode } from "../../components/QrCode";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { cardExpired, refreshDelayMs, validUntilLine, type MemberCard } from "../../lib/memberCard";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Die Mitgliedskarte (#346): Name, Nummer, Art, gültig bis - und ein QR-Code, den ein Partner
// mit der Handykamera prüft. Der Code erneuert sich vor Ablauf von selbst und sobald die App
// aus dem Hintergrund zurückkommt.

type Props = NativeStackScreenProps<MoreStackParamList, "MemberCard">;

export function MemberCardScreen(_: Props) {
  const [card, setCard] = useState<MemberCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<MemberCard>("/account/member-card");
      setCard(data);
    } catch (err) {
      setError(errorMessage(err, "Die Karte konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, []);

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

  const accent = card.accent_color || colors.gold;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={[styles.card, { borderColor: accent }]} testID="member-card">
          <View style={styles.head}>
            <View>
              <Muted style={[styles.eyebrow, { color: accent }]}>{card.club_name}</Muted>
              <Heading>Mitgliedskarte</Heading>
            </View>
            <Ionicons name="ribbon-outline" color={accent} size={28} />
          </View>

          <View style={styles.qrWrap}>
            <QrCode value={card.verify_url} size={224} testID="member-card-qr" />
          </View>

          <View style={styles.facts}>
            <Body style={styles.name}>{card.name}</Body>
            <Muted>{card.type_label}</Muted>
            <View style={styles.factRow}>
              {card.member_number ? <Fact label="Nummer" value={card.member_number} accent={accent} /> : null}
              {card.member_since ? <Fact label="Seit" value={formatDate(card.member_since)} accent={accent} /> : null}
            </View>
            <Muted style={styles.valid}>{validUntilLine(card)}</Muted>
          </View>
        </Card>

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

function Fact({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View style={styles.fact}>
      <Muted style={styles.factLabel}>{label}</Muted>
      <Body style={[styles.factValue, { color: accent }]}>{value}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: colors.black,
    borderWidth: 1.5,
    gap: 16,
    padding: 18,
  },
  head: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  qrWrap: {
    alignItems: "center",
  },
  facts: {
    gap: 4,
  },
  name: {
    fontSize: 22,
    fontWeight: "900",
  },
  factRow: {
    flexDirection: "row",
    gap: 18,
    marginTop: 8,
  },
  fact: {
    gap: 1,
  },
  factLabel: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  factValue: {
    fontFamily: "monospace",
    fontWeight: "900",
  },
  valid: {
    color: colors.white,
    marginTop: 8,
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
