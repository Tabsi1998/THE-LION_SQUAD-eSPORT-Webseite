import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { Card } from "./Card";
import { Body, Heading, Muted } from "./Text";
import { api, errorMessage } from "../lib/api";
import { colors } from "../theme";

// Ehrungen aus der Mitgliederakte (#848) - wie im Web: alle eigenen mit dem Hinweis, welche der Verein freigibt;
// aufs öffentliche Profil nur mit dem eigenen Schalter. HonourList zeigt dieselben Karten auf fremden Profilen.
// Darunter die eigenen Teilnahmen (#906) - nur für die Person selbst, nie öffentlich.

export type Honour = { kind: string; kind_label: string; title: string; years: number; label: string; given_on: string; publishable?: boolean };

export type Participation = { kind: string; kind_label: string; title: string; day: string; hours: number | null; source: string; source_label: string };

export type HonoursView = {
  available: boolean;
  reason?: string | null;
  text?: string;
  public: boolean;
  shown?: number;
  honours: Honour[];
  participations?: Participation[];
  participations_text?: string;
};

export function honourDay(day: string): string {
  return day ? day.split("-").reverse().join(".") : "";
}

export function honourLine(honour: Honour): string {
  return [honour.given_on ? `Verliehen am ${honourDay(honour.given_on)}` : "", honour.years ? `${honour.years} Jahre im Verein` : ""].filter(Boolean).join(" · ");
}

/** „14.03.2026 · Wettbewerb · 2,5 Std. · von der Website gemeldet“ - wie im Web. */
export function participationLine(row: Participation): string {
  const hours = typeof row.hours === "number" && row.hours > 0 ? `${String(row.hours).replace(".", ",")} Std.` : "";
  return [honourDay(row.day), row.kind_label, hours, row.source_label].filter(Boolean).join(" · ");
}

/** Neueste zuerst, je Jahr eine Gruppe. */
export function participationsByYear(rows: Participation[]): { year: string; rows: Participation[] }[] {
  const groups: { year: string; rows: Participation[] }[] = [];
  for (const row of rows) {
    const year = String(row.day || "").slice(0, 4) || "ohne Datum";
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.rows.push(row);
    else groups.push({ year, rows: [row] });
  }
  return groups;
}

function ParticipationsCard({ view }: { view: HonoursView }) {
  const groups = participationsByYear(view.participations || []);
  return (
    <Card style={styles.card} testID="profile-participations">
      <Heading>Meine Teilnahmen</Heading>
      <Muted>Was deine Mitgliederakte als Teilnahme führt: Vereinsevents mit Check-in, Turniere, Helferdienste und was der Vorstand einträgt. Nur du siehst das.</Muted>
      {view.participations_text ? (
        <Muted testID="profile-participations-reason">{view.participations_text}</Muted>
      ) : groups.length ? (
        groups.map((group) => (
          <View key={group.year} style={styles.list} testID={`profile-participations-${group.year}`}>
            <Muted style={styles.year}>{`${group.year} · ${group.rows.length} ${group.rows.length === 1 ? "Teilnahme" : "Teilnahmen"}`}</Muted>
            {group.rows.map((row, index) => (
              <View key={`${row.day}-${row.title}-${index}`} style={styles.participation} testID="participation-row">
                <Body style={styles.title}>{row.title}</Body>
                <Muted style={styles.meta}>{participationLine(row)}</Muted>
              </View>
            ))}
          </View>
        ))
      ) : (
        <Muted testID="profile-participations-empty">In deiner Mitgliederakte steht noch keine Teilnahme.</Muted>
      )}
    </Card>
  );
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
    <>
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
      {view.available ? <ParticipationsCard view={view} /> : null}
    </>
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
  year: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  participation: {
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 6,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
