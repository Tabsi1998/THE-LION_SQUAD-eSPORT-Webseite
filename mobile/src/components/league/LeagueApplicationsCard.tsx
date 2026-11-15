import React, { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { api, errorMessage } from "../../lib/api";
import { applicationTone, applicationsForSquads, carryLine, teamStateLabel, type ApplicationTone, type TeamApplication } from "../../lib/leagueTeam";
import { openLink } from "../../lib/openLink";
import { colors, radius, roles } from "../../theme";
import { Button } from "../Button";
import { Card } from "../Card";
import { StaggerIn } from "../motion";
import { Body, Heading, Muted } from "../Text";

// Liga-Anmeldung am Team (#2173, Web: components/tls/league/application/SquadApplicationStatus.jsx, docs/LIGA.md B.4 und F.2): je
// Co-Team der Stand der Anmeldung mit Link zur Ligaseite. Anmelden mit Co-Team geht auf der Ligaseite im Web - die App zeigt den Stand.
// Aus der Vorgänger-Season übernommen (F.2): Herkunft, Frist und „Abmelden“ stehen hier, auch solange die Season noch nicht sichtbar ist.

const TONE_COLORS: Record<ApplicationTone, string> = { quiet: roles.quiet, info: roles.brand, ok: roles.ok, warn: roles.warn };

export function LeagueApplicationsCard({ squadIds, enabled = true }: { squadIds: Array<string | null | undefined>; enabled?: boolean }) {
  const [items, setItems] = useState<TeamApplication[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const key = squadIds.filter(Boolean).join(",");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ items?: TeamApplication[] }>("/me/league-applications");
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      // Ein Teil der Team-Seite: kommt er nicht, steht er einfach nicht da (wie im Web).
    }
  }, []);

  useEffect(() => {
    if (!enabled || !key) return;
    void load();
  }, [enabled, key, load]);

  const rows = applicationsForSquads(items, squadIds);
  if (!enabled || !rows.length) return null;

  const withdraw = (row: TeamApplication) => {
    Alert.alert(
      "Von der Season abmelden?",
      `Ihr spielt dann nicht in ${row.title}. Der Platz geht an die Warteliste oder neue Anmeldungen. Zurück geht es nur über eine neue Anmeldung.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Abmelden",
          style: "destructive",
          onPress: async () => {
            setBusy(row.id);
            setError("");
            setMessage("");
            try {
              await api.post(`/me/league-applications/${encodeURIComponent(row.id)}/withdraw`, {});
              setMessage("Abgemeldet. Der Platz ist frei.");
              await load();
            } catch (err) {
              setError(errorMessage(err, "Abmelden hat nicht geklappt."));
            } finally {
              setBusy("");
            }
          },
        },
      ],
    );
  };

  return (
    <Card style={styles.card} testID="team-league-applications">
      <Heading>Liga-Anmeldungen</Heading>
      {message ? <Muted style={{ color: roles.ok }}>{message}</Muted> : null}
      {error ? <Muted style={{ color: roles.live }}>{error}</Muted> : null}
      <StaggerIn style={styles.list}>
        {rows.map((row) => {
          const color = TONE_COLORS[applicationTone(row.status)];
          return (
            <View key={row.id} style={styles.row} testID={`squad-application-${row.id}`}>
              <View style={styles.head}>
                <Body style={[styles.title, row.url ? styles.link : null]} numberOfLines={2} onPress={row.url ? () => { openLink(row.url); } : undefined} accessibilityRole={row.url ? "link" : undefined}>
                  {row.title}
                </Body>
                <Text style={[styles.badge, { borderColor: color, color }]} testID={`squad-application-state-${row.id}`}>{teamStateLabel(row.status, row)}</Text>
              </View>
              {row.carry_over ? <Muted style={styles.small} testID={`squad-application-carry-${row.id}`}>{carryLine(row.carry_over)}</Muted> : null}
              {row.staffel ? <Muted style={styles.small}>{row.staffel_left ? `Nicht mehr in ${row.staffel}.` : `Spielt in ${row.staffel}.`}</Muted> : null}
              {row.decision_reason ? <Muted style={styles.small}>Grund: {row.decision_reason}</Muted> : null}
              {row.carry_over && row.can_withdraw ? (
                <Button compact variant="quiet" label={busy === row.id ? "Meldet ab ..." : "Abmelden"} disabled={Boolean(busy)} busy={busy === row.id} onPress={() => withdraw(row)} testID={`squad-application-withdraw-${row.id}`} />
              ) : null}
            </View>
          );
        })}
      </StaggerIn>
      <Muted style={styles.small}>Mit einem Co-Team anmelden geht auf der Ligaseite im Web – dort stehen auch Regelwerk und Plätze.</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  list: { gap: 10 },
  row: { borderTopColor: colors.border, borderTopWidth: 1, gap: 4, paddingTop: 10 },
  head: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  title: { flexShrink: 1, fontWeight: "800" },
  link: { color: roles.brand },
  badge: { borderRadius: radius.sm, borderWidth: 1, fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  small: { fontSize: 13 },
});
