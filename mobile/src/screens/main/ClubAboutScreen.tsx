import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import { BrandLogo } from "../../components/BrandLogo";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { useBranding } from "../../branding/BrandingProvider";
import { api } from "../../lib/api";
import { aboutNumbers, firstParagraph, pillarList, type AboutPayload } from "../../lib/clubAbout";
import { boardContacts, type BoardPosition } from "../../lib/memberArea";
import { openLink } from "../../lib/openLink";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import type { AppStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Über uns, Vorstand, Werte und Kontakt in der App (#1024, Fabians Auswahl Idee 24): kurz und mit denselben Inhalten
// wie die Website - ein paar Sätze, die Zahlen, der Vorstand mit Bild und Aufgabe, Werte und Ziele, Kontakt und
// „Mitglied werden“. Lange Seiten (Vereinsmitglieder, Server, Rechtliches, Kontaktformular) bleiben auf der Website;
// die App verlinkt sie über den gemeinsamen Link-Weg statt sie nachzubauen.

type Props = NativeStackScreenProps<AppStackParamList, "ClubAbout">;

const WEB_LINKS: Array<{ key: string; title: string; path: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "members", title: "Vereinsmitglieder", path: "/members", icon: "people-outline" },
  { key: "servers", title: "Server", path: "/servers", icon: "server-outline" },
  { key: "contact", title: "Kontaktformular", path: "/contact", icon: "mail-outline" },
  { key: "imprint", title: "Impressum", path: "/imprint", icon: "document-text-outline" },
  { key: "privacy", title: "Datenschutz", path: "/privacy", icon: "shield-outline" },
];

export function ClubAboutScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { clubName } = useBranding();
  const [about, setAbout] = useState<AboutPayload | null>(null);
  const [board, setBoard] = useState<ReturnType<typeof boardContacts>>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [aboutResult, boardResult, settingsResult] = await Promise.allSettled([
      api.get<AboutPayload>("/home/about"),
      api.get<BoardPosition[]>("/board", { params: { active_only: true } }),
      api.get<{ contact_email?: string | null }>("/settings/public"),
    ]);
    if (aboutResult.status === "fulfilled") setAbout(aboutResult.value.data || {});
    if (boardResult.status === "fulfilled") setBoard(boardContacts(Array.isArray(boardResult.value.data) ? boardResult.value.data : [], 12));
    if (settingsResult.status === "fulfilled") setEmail(String(settingsResult.value.data?.contact_email || "").trim());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const texts = about?.texts || {};
  const name = String(texts.hero_title || about?.organization?.name || clubName || "THE LION SQUAD").replace(/\s+/g, " ").trim();
  const intro = firstParagraph(texts.hero_text);
  const values = firstParagraph(texts.values_text, 420);
  const pillars = pillarList(about);
  const numbers = aboutNumbers(about);
  const member = Boolean(user?.is_club_member);

  const shareEmail = async () => {
    if (!email) return;
    try {
      // Kopieren geht über das Teilen-Menü des Handys („Kopieren“) - ohne zusätzliches Paket in der App.
      await Share.share({ message: email, title: `Kontakt ${clubName}` });
    } catch {
      // Abbrechen ist kein Fehler.
    }
  };

  if (loading) return <Screen><SkeletonList count={3} hasImage={false} /></Screen>;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.cyan} />}>
        <View style={styles.hero} testID="club-about-hero">
          <BrandLogo variant="mascot" style={styles.heroLion} testID="club-about-lion" />
          <Muted style={styles.eyebrow}>{String(texts.hero_eyebrow || "eSports-Verein").toUpperCase()}</Muted>
          <Title style={styles.heroTitle}>{name}</Title>
        </View>
        {intro ? <Body testID="club-about-intro">{intro}</Body> : null}

        {numbers.length ? (
          <View style={styles.numbers} testID="club-about-numbers">
            {numbers.map((number, index) => (
              <Card key={number.key} style={styles.number}>
                <Body style={[styles.numberValue, index === 1 && styles.gold]}>{String(number.value)}</Body>
                <Muted>{number.label}</Muted>
              </Card>
            ))}
          </View>
        ) : null}

        {board.length ? (
          <Card style={styles.card} testID="club-about-board">
            <Heading>Vorstand</Heading>
            {board.map((person) => (
              <Pressable
                key={person.id}
                disabled={!person.username}
                onPress={() => person.username && navigation.navigate("PublicProfile", { username: person.username })}
                style={({ pressed }) => [styles.person, pressed && styles.pressed]}
                accessibilityRole={person.username ? "button" : undefined}
                testID={`club-about-board-${person.id}`}
              >
                <MediaImage uri={person.avatar} style={styles.avatar} fallback={<Body style={styles.initials}>{(person.name || "?").slice(0, 2).toUpperCase()}</Body>} />
                <View style={styles.flex}>
                  <Body style={styles.strong}>{person.name}</Body>
                  <Muted>{person.title}</Muted>
                </View>
                {person.username ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
              </Pressable>
            ))}
          </Card>
        ) : null}

        {values || pillars.length ? (
          <Card style={styles.card} testID="club-about-values">
            <Heading>{String(texts.values_title || "Werte und Ziele")}</Heading>
            {values ? <Body>{values}</Body> : null}
            {pillars.length ? (
              <View style={styles.pillars}>
                {pillars.map((pillar) => <View key={pillar} style={styles.pillar}><Muted style={styles.pillarText}>{pillar}</Muted></View>)}
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card style={styles.card} testID="club-about-contact">
          <Heading>Kontakt</Heading>
          {email ? (
            <>
              <Pressable onPress={shareEmail} accessibilityRole="button" style={({ pressed }) => [styles.contact, pressed && styles.pressed]} testID="club-about-email">
                <View style={styles.contactIcon}><Ionicons name="mail-outline" size={18} color={colors.cyan} /></View>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{email}</Body>
                  <Muted>Antippen zum Kopieren oder Teilen</Muted>
                </View>
              </Pressable>
              <Button label="E-Mail schreiben" variant="secondary" onPress={() => { Linking.openURL(`mailto:${email}`).catch(() => {}); }} testID="club-about-mail" />
            </>
          ) : (
            <Muted>Schreib uns über das Kontaktformular auf der Website.</Muted>
          )}
        </Card>

        {!member ? (
          <Card style={[styles.card, styles.join]} testID="club-about-join">
            <Heading>Mitglied werden</Heading>
            <Muted>Mitgliedskarte, Mitreden bei Versammlungen und interne Events – der Antrag geht auf der Website.</Muted>
            <Button label="Mitglied werden" onPress={() => { openLink(`${WEB_BASE_URL}/membership/join`); }} testID="club-about-join-button" />
          </Card>
        ) : null}

        <Card style={styles.card} testID="club-about-web">
          <Heading>Mehr auf der Website</Heading>
          {WEB_LINKS.map((link) => (
            <Pressable key={link.key} onPress={() => { openLink(`${WEB_BASE_URL}${link.path}`); }} accessibilityRole="link" style={({ pressed }) => [styles.webRow, pressed && styles.pressed]} testID={`club-about-link-${link.key}`}>
              <Ionicons name={link.icon} size={18} color={colors.cyan} />
              <Body style={styles.flex}>{link.title}</Body>
              <Ionicons name="open-outline" size={16} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 18, paddingBottom: 34 },
  hero: { backgroundColor: "#0d2533", borderColor: colors.border, borderRadius: 10, borderWidth: 1, gap: 4, minHeight: 110, justifyContent: "flex-end", overflow: "hidden", padding: 16 },
  heroLion: { height: 170, opacity: 0.16, position: "absolute", right: -30, top: -30, width: 170 },
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  heroTitle: { fontSize: 26 },
  numbers: { flexDirection: "row", gap: 10 },
  number: { flex: 1, gap: 2, minHeight: 78 },
  numberValue: { color: colors.cyan, fontSize: 22, fontWeight: "900" },
  gold: { color: colors.gold },
  card: { gap: 10 },
  person: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 12, paddingTop: 10 },
  avatar: { borderColor: colors.border, borderRadius: 22, borderWidth: 1, height: 44, overflow: "hidden", width: 44 },
  initials: { color: colors.cyan, fontWeight: "900" },
  flex: { flex: 1, gap: 2 },
  strong: { fontWeight: "900" },
  pressed: { opacity: 0.72 },
  pillars: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pillar: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.35)", borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  pillarText: { color: colors.cyan, fontWeight: "800" },
  contact: { alignItems: "center", borderColor: colors.border, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, padding: 10 },
  contactIcon: { alignItems: "center", backgroundColor: "rgba(41,182,232,0.1)", borderRadius: 8, height: 36, justifyContent: "center", width: 36 },
  join: { borderColor: "rgba(255,215,0,0.35)" },
  webRow: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 12, minHeight: 44, paddingTop: 8 },
});
