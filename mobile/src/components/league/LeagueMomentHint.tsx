import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { isLeagueMoment, replayMoment, type LeagueMoment } from "../../lib/leagueMoments";
import { openLink } from "../../lib/openLink";
import { colors, roles } from "../../theme";
import { Button } from "../Button";
import { Card } from "../Card";
import { StaggerIn } from "../motion";
import { Body, Heading, Muted } from "../Text";
import { CREST_METALS, CrestBadge } from "./LeagueCrest";

// Hinweis „Saisonende“ an Profil und Team (#2584, docs/LIGA.md F.8, Web: components/tls/league/LeagueMomentHint.jsx): je Co-Team der
// jüngste bestätigte Ausgang der Season (Aufstieg, Abstieg, Meister) mit Abzeichen, Satz und Link zum Endstand. Der Server liefert nur,
// was die betrachtende Person sehen darf (Feld `league_moments`), die Texte kommen von dort. „Moment ansehen“ (nur für die Person
// selbst bzw. Mitglieder des Teams) spielt ihn noch einmal ab - ohne Zählung, nur einmal in der Schlange.

const ICONS: Record<LeagueMoment["outcome"], keyof typeof Ionicons.glyphMap> = { up: "arrow-up", down: "arrow-down", champion: "trophy" };
const TONES: Record<LeagueMoment["outcome"], string> = { up: roles.ok, down: CREST_METALS.calm.light, champion: roles.honor };

export function LeagueMomentHint({ rows, canReplay = false, testID = "league-moments" }: { rows?: Array<LeagueMoment | null | undefined> | null; canReplay?: boolean; testID?: string }) {
  const list = (rows || []).filter(isLeagueMoment);
  if (!list.length) return null;
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.titleRow}>
        <Ionicons name="flag-outline" size={18} color={roles.brand} />
        <Heading accessibilityRole="header">Saisonende</Heading>
      </View>
      <StaggerIn style={styles.list}>
        {list.map((row) => {
          const texts = row.texts || {};
          const tone = TONES[row.outcome];
          return (
            <View key={row.id} style={styles.row} testID={`${testID}-${row.id}`}>
              <CrestBadge badge={row.badge_to} size={36} metal={row.outcome === "down" ? "calm" : undefined} />
              <View style={styles.main}>
                <View style={styles.label}>
                  <Ionicons name={ICONS[row.outcome]} size={14} color={tone} />
                  <Text style={[styles.kind, { color: tone }]}>{texts.label || texts.kicker}</Text>
                  {row.corrected ? <Muted style={styles.corrected}>· Endstand korrigiert</Muted> : null}
                </View>
                <Body style={styles.summary}>{texts.summary || texts.line}</Body>
                <View style={styles.where}>
                  <Muted style={styles.small}>{row.title}</Muted>
                  {row.url ? (
                    <Text style={[styles.small, styles.link]} onPress={() => { openLink(row.url); }} accessibilityRole="link" accessibilityLabel={`Endstand von ${row.title}`} suppressHighlighting>
                      Endstand
                    </Text>
                  ) : null}
                </View>
                {canReplay ? (
                  <Button compact variant="secondary" icon="play" arrow={false} label="Moment ansehen" accessibilityLabel={`Moment ansehen: ${texts.label || ""} ${row.title || ""}`.trim()}
                    onPress={() => replayMoment(row)} testID={`${testID}-${row.id}-replay`} />
                ) : null}
              </View>
            </View>
          );
        })}
      </StaggerIn>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  list: { gap: 10 },
  row: { alignItems: "flex-start", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 12, paddingTop: 10 },
  main: { flex: 1, gap: 4, minWidth: 0 },
  label: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kind: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  corrected: { fontSize: 12 },
  summary: { fontWeight: "700" },
  where: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  small: { fontSize: 12 },
  link: { color: roles.brand, fontWeight: "700", minHeight: 24, paddingVertical: 2 },
});
