import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

type Props = NativeStackScreenProps<MoreStackParamList, "MoreHub">;

const modules: Array<{ title: string; detail: string; badge: string; section?: NonNullable<NonNullable<MoreStackParamList["InfoCenter"]>["section"]>; screen?: "NewsList" }> = [
  { title: "News", detail: "Aktuelle Ankuendigungen, Updates, Events und verknuepfte Turniere.", screen: "NewsList", badge: "Live" },
  { title: "Sponsoren", detail: "Hinterlegte Unterstützer mit Kurzinfo und Link-Logik.", section: "sponsors", badge: "Club" },
  { title: "Partner", detail: "Kooperationen, Ligen, Community-Partner und Event-Bezug.", section: "partners", badge: "Netzwerk" },
  { title: "Events", detail: "Community-Abende, LAN, Festival-Auftritte und Anmeldestatus.", section: "events", badge: "Kalender" },
  { title: "Mitgliedervorteile", detail: "Dynamische Vorteile für aktive Vereinsmitglieder.", section: "benefits", badge: "Member" },
  { title: "Spielerprofile", detail: "Profile finden, Rollen sehen und Achievements vergleichen.", section: "profiles", badge: "Social" },
];

export function MoreScreen({ navigation }: Props) {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Heading>Weitere Nutzerbereiche</Heading>
          <Muted>Info, Verein, Community und Profil-Funktionen sind hier als native App-Bereiche gebündelt.</Muted>
        </View>
        {modules.map((item) => (
          <Pressable key={item.title} onPress={() => item.screen ? navigation.navigate(item.screen) : navigation.navigate("InfoCenter", { section: item.section })} style={({ pressed }) => [pressed && styles.pressed]}>
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <Body style={styles.title}>{item.title}</Body>
                <Muted style={styles.badge}>{item.badge}</Muted>
              </View>
              <Muted>{item.detail}</Muted>
              <Muted style={styles.openHint}>Bereich öffnen</Muted>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    gap: 12,
    paddingBottom: 28,
  },
  header: {
    gap: 6,
    marginBottom: 4,
  },
  card: {
    gap: 6,
  },
  cardTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    fontWeight: "900",
  },
  badge: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.32)",
    borderRadius: 6,
    borderWidth: 1,
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 3,
    textTransform: "uppercase",
  },
  openHint: {
    color: colors.cyan,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.72,
  },
});
