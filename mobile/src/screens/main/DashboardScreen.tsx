import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { displayName, formatDate, formatStatus } from "../../lib/format";
import { isGuestUser } from "../../live";
import { colors } from "../../theme";
import type { ClubEvent, Match, Sponsor, Tournament } from "../../types";

type DashboardData = {
  matches: Match[];
  openPrizes: number;
  penalties: unknown[];
  publicTournaments: Tournament[];
  publicEvents: ClubEvent[];
  publicSponsors: Sponsor[];
};

export function DashboardScreen() {
  const { user, refreshMe } = useAuth();
  const [data, setData] = useState<DashboardData>({ matches: [], openPrizes: 0, penalties: [], publicTournaments: [], publicEvents: [], publicSponsors: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      if (isGuestUser(user)) {
        const [tournaments, events, sponsors] = await Promise.all([
          api.get<Tournament[]>("/tournaments").catch(() => ({ data: [] })),
          api.get<ClubEvent[]>("/events").catch(() => ({ data: [] })),
          api.get<Sponsor[]>("/sponsors").catch(() => ({ data: [] })),
        ]);
        setData({
          matches: [],
          openPrizes: 0,
          penalties: [],
          publicTournaments: Array.isArray(tournaments.data) ? tournaments.data : [],
          publicEvents: Array.isArray(events.data) ? events.data : [],
          publicSponsors: Array.isArray(sponsors.data) ? sponsors.data : [],
        });
        return;
      }
      const [matches, prizes, penalties] = await Promise.all([
        api.get<Match[]>("/matches/upcoming").catch(() => ({ data: [] })),
        api.get<{ count?: number }>("/prizes/me/open-count").catch(() => ({ data: { count: 0 } })),
        api.get<unknown[]>("/penalties/me").catch(() => ({ data: [] })),
      ]);
      setData({
        matches: Array.isArray(matches.data) ? matches.data : [],
        openPrizes: prizes.data?.count || 0,
        penalties: Array.isArray(penalties.data) ? penalties.data : [],
        publicTournaments: [],
        publicEvents: [],
        publicSponsors: [],
      });
      await refreshMe().catch(() => {});
    } catch (err) {
      setError(errorMessage(err, "Dashboard konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshMe, user]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Dashboard wird geladen ..." />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#f0b429" />}
      >
        <View style={styles.header}>
          <Muted>Willkommen zurück</Muted>
          <Title>{displayName(user)}</Title>
          <Body>{isGuestUser(user) ? "Öffentliche Live-Daten von lionsquad.at werden direkt geladen." : "Deine wichtigsten Nutzerbereiche sind direkt erreichbar."}</Body>
        </View>
        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        <View style={styles.grid}>
          <Stat label={isGuestUser(user) ? "Turniere" : "Offene Matches"} value={String(isGuestUser(user) ? data.publicTournaments.length : data.matches.length)} />
          <Stat label={isGuestUser(user) ? "Events" : "Preise"} value={String(isGuestUser(user) ? data.publicEvents.length : data.openPrizes)} tone="gold" />
          <Stat label={isGuestUser(user) ? "Sponsoren" : "Strafen"} value={String(isGuestUser(user) ? data.publicSponsors.length : data.penalties.length)} />
        </View>
        <Card style={styles.section}>
          <Heading>{isGuestUser(user) ? "Live-Turniere" : "Nächste Matches"}</Heading>
          {isGuestUser(user) ? (
            data.publicTournaments.length ? data.publicTournaments.slice(0, 4).map((tournament) => (
              <View key={tournament.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Body style={styles.rowTitle}>{tournament.title}</Body>
                  <Muted>{formatDate(tournament.start_date)} · {tournament.public_phase?.label || formatStatus(tournament.status)}</Muted>
                </View>
              </View>
            )) : <EmptyState title="Keine Live-Turniere" detail="Die öffentliche API hat aktuell keine Turniere geliefert." />
          ) : data.matches.length ? (
            data.matches.slice(0, 4).map((match) => (
              <View key={match.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Body style={styles.rowTitle}>{match.tournament_title || match.opponent_name || "Match"}</Body>
                  <Muted>{formatDate(match.scheduled_at)} · {formatStatus(match.status)}</Muted>
                </View>
              </View>
            ))
          ) : (
            <EmptyState title="Keine offenen Matches" detail="Sobald du eingeteilt bist, erscheinen sie hier." />
          )}
        </Card>
        <Button label="Aktualisieren" variant="secondary" onPress={load} />
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "gold" }) {
  return (
    <Card style={styles.stat}>
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{value}</Body>
      <Muted>{label}</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    gap: 16,
  },
  header: {
    gap: 7,
  },
  error: {
    color: colors.live,
  },
  grid: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    flex: 1,
    minHeight: 82,
    justifyContent: "center",
  },
  statValue: {
    fontSize: 26,
    fontWeight: "900",
    color: colors.cyan,
  },
  gold: {
    color: colors.gold,
  },
  section: {
    gap: 12,
  },
  row: {
    paddingVertical: 10,
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: 1,
  },
  rowText: {
    gap: 3,
  },
  rowTitle: {
    fontWeight: "800",
  },
});
