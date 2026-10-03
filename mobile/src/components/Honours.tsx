import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { Card } from "./Card";
import { Body, Heading, Muted } from "./Text";
import { api, errorMessage } from "../lib/api";
import { colors } from "../theme";

// Ehrungen aus der Mitgliederakte (#848) - wie im Web: alle eigenen mit dem Hinweis, welche der Verein freigibt;
// aufs öffentliche Profil nur mit dem eigenen Schalter. HonourList zeigt dieselben Karten auf fremden Profilen.

export type Honour = { kind: string; kind_label: string; title: string; years: number; label: string; given_on: string; publishable?: boolean };

export type HonoursView = {
  available: boolean;
  reason?: string | null;
  text?: string;
  public: boolean;
  shown?: number;
  honours: Honour[];
};

export function honourDay(day: string): string {
  return day ? day.split("-").reverse().join(".") : "";
}

export function honourLine(honour: Honour): string {
  return [honour.given_on ? `Verliehen am ${honourDay(honour.given_on)}` : "", honour.years ? `${honour.years} Jahre im Verein` : ""].filter(Boolean).join(" · ");
}

export function HonourList({ honours, showReach = false }: { honours: Honour[]; showReach?: boolean }) {
  return (
    <View style={styles.list}>
      {honours.map((honour) => (
        <View key={`${honour.kind}-${honour.given_on}-${honour.title}`} style={styles.honour} testID="honour-card">
          <View style={styles.medal}>
            <Ionicons name="ribbon" size={20} color={colors.gold} />
          </View>
          <View style={styles.text}>
            <Muted style={styles.kind}>{honour.kind_label || "Ehrung"}</Muted>
            <Body style={styles.title}>{honour.title}</Body>
            {honour.label ? <Muted>{honour.label}</Muted> : null}
            {honourLine(honour) ? <Muted style={styles.meta}>{honourLine(honour)}</Muted> : null}
            {showReach ? (
              <Muted style={honour.publishable ? styles.reachOn : styles.reachOff}>
                {honour.publishable ? "Darf aufs Profil – mit deinem Schalter" : "Nur für dich – der Verein gibt sie nicht frei"}
              </Muted>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function HonoursCard() {
  const [view, setView] = useState<HonoursView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<HonoursView>("/me/honours");
      setView(data);
    } catch {
      setView(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!view) return null;
  // Ohne Verbindung zur Akte erklärt „Meine Mitgliedschaft“ den Weg; hier steht nur, was die Ehrungen betrifft.
  if (!view.available && view.reason === "not_bound") return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.put<HonoursView>("/me/honours/public", { on });
      setView(data);
    } catch (problem) {
      setError(errorMessage(problem, "Nicht gespeichert."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card} testID="profile-honours">
      <Heading>Meine Ehrungen</Heading>
      {!view.available ? (
        <Muted testID="profile-honours-reason">{view.text}</Muted>
      ) : (
        <>
          <View style={styles.switchRow}>
            <View style={styles.text}>
              <Body style={styles.switchLabel}>Auf meinem öffentlichen Profil zeigen</Body>
              <Muted>Nur Ehrungen, die der Verein veröffentlichen lässt.{view.public ? ` Gerade öffentlich: ${view.shown || 0}.` : ""}</Muted>
            </View>
            <Switch value={!!view.public} disabled={busy} onValueChange={toggle} accessibilityLabel="Ehrungen auf meinem öffentlichen Profil zeigen" testID="profile-honours-public" />
          </View>
          {view.honours.length ? <HonourList honours={view.honours} showReach /> : <Muted testID="profile-honours-empty">In deiner Mitgliederakte steht noch keine Ehrung.</Muted>}
          {error ? <Muted style={styles.error}>{error}</Muted> : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  list: { gap: 8 },
  honour: {
    backgroundColor: "rgba(255, 215, 0, 0.06)",
    borderColor: "rgba(255, 215, 0, 0.35)",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  medal: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.1)",
    borderColor: "rgba(255, 215, 0, 0.6)",
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  text: { flex: 1, gap: 2 },
  kind: { color: colors.gold, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { fontWeight: "800" },
  meta: { fontSize: 12 },
  reachOn: { color: "#00FF88", fontSize: 12 },
  reachOff: { fontSize: 12 },
  switchRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  switchLabel: { fontWeight: "700" },
  error: { color: "#FF8A80" },
});
