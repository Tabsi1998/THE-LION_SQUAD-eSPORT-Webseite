import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import { displayName } from "../../lib/format";
import { isGuestUser } from "../../live";
import { colors } from "../../theme";

export function ProfileScreen() {
  const { user, logout, refreshMe } = useAuth();
  const [achievements, setAchievements] = useState<any[]>([]);
  const [completeness, setCompleteness] = useState<number | null>(null);

  const loadProfileData = useCallback(async () => {
    if (isGuestUser(user)) return;
    const [achievementResult, completenessResult] = await Promise.all([
      api.get<any[]>("/achievements/me").catch(() => ({ data: [] })),
      api.get<{ score?: number; profile_completeness?: number }>("/users/me/profile-completeness").catch(() => ({ data: {} })),
    ]);
    setAchievements(Array.isArray(achievementResult.data) ? achievementResult.data.slice(0, 8) : []);
    const completenessData = completenessResult.data as { score?: number; profile_completeness?: number };
    setCompleteness(completenessData.score ?? completenessData.profile_completeness ?? null);
  }, [user]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Muted>Profil</Muted>
          <Title>{displayName(user)}</Title>
          <Body>{user?.email}</Body>
          <View style={styles.pillRow}>
            <Pill label={user?.is_club_member ? "Vereinsmitglied" : "Community"} accent={user?.is_club_member ? "success" : "default"} />
            <Pill label={user?.role || "player"} />
            <Pill label={`${achievements.length} Achievements`} />
            {completeness != null ? <Pill label={`${completeness}% Profil`} /> : null}
          </View>
        </View>
        <Card style={styles.card}>
          <Heading>Account</Heading>
          <Info label="Benutzername" value={user?.username} />
          <Info label="Rolle" value={user?.role || "player"} />
          <Info label="Nutzertyp" value={user?.user_type || "community_user"} />
          <Info label="Vereinsmitglied" value={user?.is_club_member ? "Ja" : "Nein"} />
        </Card>
        <Card style={styles.card}>
          <Heading>Achievements</Heading>
          {achievements.length ? (
            <View style={styles.achievementGrid}>
              {achievements.map((achievement) => (
                <View key={achievement.code || achievement.id} style={[styles.achievement, { borderColor: achievement.accent_color || achievement.level_color || colors.cyan }]}>
                  <Muted style={[styles.achievementTier, { color: achievement.accent_color || achievement.level_color || colors.cyan }]}>{achievement.category || achievement.level_name || "Achievement"}</Muted>
                  <Body style={styles.achievementName}>{achievement.name}</Body>
                  <Muted>{achievement.points || achievement.earned_count || 0} Punkte</Muted>
                </View>
              ))}
            </View>
          ) : (
            <Muted>{isGuestUser(user) ? "Melde dich an, um deine persönlichen Achievements zu sehen." : "Noch keine Achievements hinterlegt."}</Muted>
          )}
        </Card>
        <Card style={styles.card}>
          <Heading>Referenzen</Heading>
          <Muted>Turnier- und Team-Referenzen werden hier aus deinem echten Live-Profil gesammelt, sobald der persönliche Referenzen-Endpunkt aktiv ist.</Muted>
        </Card>
        <Card style={styles.card}>
          <Heading>Profil-Ausbau</Heading>
          <Muted>Als nächste Live-Anbindung fehlen noch Profil bearbeiten, Gaming-IDs, Datenschutz-Sichtbarkeit, Freunde und Direktnachrichten.</Muted>
        </Card>
        <Button
          label={isGuestUser(user) ? "Live-Gastmodus aktiv" : "Profil aktualisieren"}
          variant="secondary"
          onPress={isGuestUser(user) ? () => {} : async () => { await refreshMe(); await loadProfileData(); }}
        />
        <Button label="Abmelden" variant="danger" onPress={logout} />
      </ScrollView>
    </Screen>
  );
}

function Pill({ label, accent = "default" }: { label: string; accent?: "default" | "success" }) {
  return (
    <View style={[styles.pill, accent === "success" && styles.pillSuccess]}>
      <Muted style={[styles.pillText, accent === "success" && styles.pillSuccessText]}>{label}</Muted>
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.info}>
      <Muted>{label}</Muted>
      <Body style={styles.infoValue}>{value || "-"}</Body>
    </View>
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
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  pill: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillSuccess: {
    backgroundColor: "rgba(0, 255, 136, 0.12)",
    borderColor: "rgba(0, 255, 136, 0.32)",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "900",
  },
  pillSuccessText: {
    color: colors.success,
  },
  card: {
    gap: 12,
  },
  info: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 2,
  },
  infoValue: {
    fontWeight: "800",
  },
  achievementGrid: {
    gap: 10,
  },
  achievement: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    padding: 12,
  },
  achievementTier: {
    fontWeight: "900",
    textTransform: "uppercase",
  },
  achievementName: {
    fontWeight: "900",
  },
  reference: {
    alignItems: "flex-start",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  referencePlace: {
    color: colors.gold,
    fontWeight: "900",
    minWidth: 58,
  },
  referenceText: {
    flex: 1,
    gap: 2,
  },
});
