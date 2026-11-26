import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import { canStartApplication, type ApplyView } from "../../lib/leagueApply";
import { afterStartLine, seasonApiPath, seasonParts, windowLine, type ApplicationWindow } from "../../lib/leagueTeam";
import { isGuestUser } from "../../live";
import { roles } from "../../theme";
import { Button } from "../Button";
import { Card } from "../Card";
import { StaggerIn } from "../motion";
import { Body, Heading, Muted } from "../Text";

// Die Season einer Liga-Staffel auf der Turnierseite (#2173, Web: components/tls/league/application/LeagueApplicationPanel.jsx und die
// Navigation der Ligaseite): das Anmeldefenster mit seinem wirksamen Ende (Nachmeldefrist, #2422 Nr. 184 - der Server rechnet es) und der
// Weg zur Gesamtwertung (F.5), wenn die Season zu einem Zeitraum gehört. Mit Co-Team anmelden (#2542, B.4): Ist das Fenster offen und hat
// die angemeldete Person ein Co-Team, das sie anmelden darf (Captain, Vertreter), führt ein Knopf zu den vier Schritten. Kommt die Season
// nicht oder sagt sie nichts davon (ältere Server), steht nichts da.

type SeasonPage = { application?: ApplicationWindow | null; overall?: { period_id?: string; name?: string | null } | null };

export function LeagueSeasonCard({ publicPath, title, onOpenOverall, onApply, testID = "league-season-card" }: {
  publicPath?: string | null;
  title?: string | null;
  onOpenOverall: (target: { league: string; season: string }) => void;
  onApply?: (target: { league: string; season: string }) => void;
  testID?: string;
}) {
  const { user } = useAuth();
  const signedIn = Boolean(user && !isGuestUser(user));
  const path = seasonApiPath(publicPath);
  const [page, setPage] = useState<SeasonPage | null>(null);
  const [view, setView] = useState<ApplyView | null>(null);
  useEffect(() => {
    setPage(null);
    if (!path) return undefined;
    let active = true;
    api.get<SeasonPage>(path)
      .then(({ data }) => { if (active) setPage(data || null); })
      .catch(() => { /* ein Teil der Turnierseite - kommt er nicht, steht er nicht da */ });
    return () => { active = false; };
  }, [path]);
  // Die eigenen Co-Teams (nur angemeldet, nur bei offenem Fenster): darf eins angemeldet werden?
  const open = page?.application?.state === "open";
  const canApply = Boolean(onApply);
  useEffect(() => {
    setView(null);
    if (!path || !signedIn || !open || !canApply) return undefined;
    let active = true;
    api.get<ApplyView>(`${path}/application`)
      .then(({ data }) => { if (active) setView(data || null); })
      .catch(() => { /* ohne Antwort kein Knopf - die Seite bleibt */ });
    return () => { active = false; };
  }, [canApply, open, path, signedIn]);
  const parts = seasonParts(publicPath);
  const window = windowLine(page?.application);
  const after = afterStartLine(page?.application);
  const overall = page?.overall && parts ? page.overall : null;
  const apply = parts && onApply && canStartApplication(view) ? parts : null;
  if (!page || (!window && !overall)) return null;
  return (
    <StaggerIn>
      <Card style={styles.card} testID={testID}>
        <View style={styles.titleRow}>
          <Ionicons name="layers-outline" size={18} color={roles.brand} />
          <Heading accessibilityRole="header">{title || "Season"}</Heading>
        </View>
        {window ? <Body testID={`${testID}-window`}>{window}</Body> : null}
        {after ? <Muted testID={`${testID}-after-start`}>{after}</Muted> : null}
        {apply ? <Button icon="clipboard-outline" label="Mit Co-Team anmelden" onPress={() => onApply?.(apply)} testID={`${testID}-apply`} /> : null}
        {overall && parts ? (
          <Button variant="secondary" arrow icon="trophy-outline" label={overall.name ? `Gesamtwertung ${overall.name}` : "Gesamtwertung"}
            onPress={() => onOpenOverall(parts)} testID={`${testID}-overall`} />
        ) : null}
      </Card>
    </StaggerIn>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
});
