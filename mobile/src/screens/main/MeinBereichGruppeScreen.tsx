import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AnkerBereich, AnkerView, useAnker } from "../../components/Anker";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { LeagueSanctionsList } from "../../components/league/LeagueSanctionsList";
import { Press } from "../../components/motion";
import { Screen } from "../../components/Screen";
import { SignInRequired } from "../../components/SignInRequired";
import { Body, Heading, Muted } from "../../components/Text";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { formatMoney } from "../../lib/memberArea";
import { einstellungenDer, einstellungZiel, gruppe as gruppeMeta, siehtVerein, type Einstellung } from "../../lib/meinBereich";
import { openLink, openWebsite } from "../../lib/openLink";
import { isGuestUser } from "../../live";
import { navigateToUrl } from "../../navigation/rootNavigation";
import type { AppStackParamList } from "../../navigation/types";
import { colors, radius } from "../../theme";
import { GruppenEinstellungen } from "./SettingsScreen";
import type { ModerationStanding } from "./profile/parts";
import { JOIN_REASONS, JOIN_URL } from "./VereinScreen";

// Eine Gruppe von Mein Bereich (#2059, #1677): eine kurze Seite statt einer langen. Profil, Mitgliedschaft, Rechnungen &
// Unterlagen und Verein sind Listen mit je einem Knopf zu den bisherigen Screens (MyInvoices, MyMembership, Versammlungen …
// - kein zweites System); Benachrichtigungen, Konto & Sicherheit und Datenschutz tragen die Einstellungen selbst. Jede Zeile
// kommt aus derselben Liste wie die Suche (lib/meinBereich.ts, EINSTELLUNGEN) - was die Suche findet, steht hier, zwei Tipps
// ab dem Tab. `ziel` rollt zur Stelle und lässt sie einmal aufleuchten.

type Props = NativeStackScreenProps<AppStackParamList, "MeinBereichGruppe">;

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  "profil-bearbeiten": "create-outline",
  "profil-ansehen": "eye-outline",
  erfolge: "trophy-outline",
  trophaeen: "medal-outline",
  status: "card-outline",
  mitgliedskarte: "qr-code-outline",
  nummer: "keypad-outline",
  "meine-daten": "location-outline",
  "website-profil": "globe-outline",
  austritt: "exit-outline",
  rechnungen: "receipt-outline",
  unterlagen: "document-text-outline",
  gewinne: "gift-outline",
  versammlungen: "people-outline",
  helfen: "hand-left-outline",
  dokumente: "folder-open-outline",
  news: "newspaper-outline",
  vorteile: "pricetag-outline",
};

export function MeinBereichGruppeScreen({ route }: Props) {
  const { user } = useAuth();
  const key = route.params?.gruppe;
  const ziel = route.params?.ziel;
  const meta = gruppeMeta(key);
  const scrollRef = useRef<ScrollView>(null);
  const anker = useAnker(scrollRef, ziel);
  const gast = !user || isGuestUser(user);
  const mitglied = siehtVerein(user);
  if (!meta || meta.key === "start") return null;
  const einstellungen = meta.key === "benachrichtigungen" || meta.key === "konto" || meta.key === "datenschutz";

  return (
    <Screen padded={false}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID={`mein-bereich-gruppe-${meta.key}`}>
        <AnkerBereich api={anker}>
          <Muted style={styles.intro} testID="mein-bereich-gruppe-intro">{meta.text}</Muted>
          {gast && meta.key !== "konto" ? (
            <SignInRequired text={`${meta.label} gibt es mit einem Konto – dasselbe wie auf der Website.`} testID="mein-bereich-gruppe-anmelden" />
          ) : einstellungen ? (
            <AnkerView id="einstellungen">
              <GruppenEinstellungen gruppe={meta.key as "benachrichtigungen" | "konto" | "datenschutz"} ziel={ziel} />
            </AnkerView>
          ) : meta.key === "verein" && !mitglied ? (
            <Beitreten text="Versammlungen, Helferdienste, Vereinsdokumente und interne News gibt es für Vereinsmitglieder." />
          ) : (
            <Liste gruppe={meta.key as "profil" | "mitgliedschaft" | "rechnungen" | "verein"} mitglied={mitglied} />
          )}
        </AnkerBereich>
      </ScrollView>
    </Screen>
  );
}

/** Profil, Mitgliedschaft, Rechnungen & Unterlagen, Verein: je Eintrag ein Knopf - mit Zahlen, wo sie helfen. */
function Liste({ gruppe, mitglied }: { gruppe: "profil" | "mitgliedschaft" | "rechnungen" | "verein"; mitglied: boolean }) {
  const items = einstellungenDer(gruppe, { mitglied });
  const details = useDetails(gruppe);
  const zeilen = items.filter((item) => item.ziel !== "beitreten" && item.ziel !== "strafen");
  return (
    <>
      {zeilen.length ? (
        <AnkerView id={`${gruppe}-liste`}>
          <Card style={styles.list}>
            {zeilen.map((item, index) => (
              <AnkerView key={item.ziel} id={item.ziel}>
                <Zeile item={item} detail={details[item.ziel]} border={index > 0} />
              </AnkerView>
            ))}
          </Card>
        </AnkerView>
      ) : null}
      {items.some((item) => item.ziel === "beitreten") ? (
        <AnkerView id="beitreten">
          <Beitreten text="Als Mitglied bekommst du deinen Ausweis, wählst deine Nummer und bist bei Versammlungen, Helferdiensten und internen Events dabei." />
        </AnkerView>
      ) : null}
      {items.some((item) => item.ziel === "strafen") ? (
        <AnkerView id="strafen">
          <Strafen />
        </AnkerView>
      ) : null}
    </>
  );
}

function Zeile({ item, detail, border }: { item: Einstellung; detail?: string; border: boolean }) {
  return (
    <Press onPress={() => { navigateToUrl(einstellungZiel(item)); }} accessibilityRole="button" style={[styles.row, border && styles.rowBorder]} testID={`mein-bereich-zeile-${item.ziel}`}>
      <Ionicons name={ICONS[item.ziel] || "ellipse-outline"} color={item.ziel === "austritt" ? colors.muted : colors.cyan} size={20} />
      <View style={styles.flex}>
        <Body style={styles.strong}>{item.label}</Body>
        {detail || item.detail ? <Muted>{detail || item.detail}</Muted> : null}
      </View>
      <Ionicons name="chevron-forward" color={colors.muted} size={16} />
    </Press>
  );
}

/** Zahlen für Rechnungen & Unterlagen - wie „Nur für dich“ im Profil: offene Rechnungen und Gewinne. */
function useDetails(gruppe: string): Record<string, string> {
  const [details, setDetails] = useState<Record<string, string>>({});
  useEffect(() => {
    if (gruppe !== "rechnungen") return undefined;
    let current = true;
    void Promise.allSettled([
      api.get<{ summary?: { open_count?: number; open_total?: number; overdue_count?: number } | null; currency?: string }>("/account/invoices"),
      api.get<{ count?: number }>("/prizes/me/open-count"),
    ]).then(([invoices, prizes]) => {
      if (!current) return;
      const next: Record<string, string> = {};
      if (invoices.status === "fulfilled") {
        const summary = invoices.value.data?.summary;
        const open = Number(summary?.open_count) || 0;
        next.rechnungen = open
          ? `${open} offen · ${formatMoney(summary?.open_total, invoices.value.data?.currency || "EUR")}${summary?.overdue_count ? ` · ${summary.overdue_count} überfällig` : ""}`
          : "Keine offenen Rechnungen";
      }
      if (prizes.status === "fulfilled") {
        const count = Number(prizes.value.data?.count) || 0;
        next.gewinne = count ? `${count} offen oder bereit zum Abholen` : "Keine offenen Gewinne";
      }
      setDetails(next);
    });
    return () => {
      current = false;
    };
  }, [gruppe]);
  return details;
}

/** Strafen: der eigene Stand bei der Moderation (Einspruch und Verlauf im Web) und die Strafen der Liga. */
function Strafen() {
  const [standing, setStanding] = useState<ModerationStanding | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    api.get<ModerationStanding | null>("/moderation/me/standing")
      .then(({ data }) => { if (current) setStanding(data || null); })
      .catch(() => { if (current) setStanding(null); });
    return () => {
      current = false;
    };
  }, []);
  const hits = standing ? standing.strike_count : 0;
  const detail = standing?.active
    ? `${standing.active.label}${standing.active.chat_blocked_until ? ` · Chat gesperrt bis ${formatDate(standing.active.chat_blocked_until)}` : ""}`
    : hits
      ? `${hits} Treffer in den letzten ${standing?.strike_ttl_months} Monaten`
      : "Keine Treffer – alles in Ordnung.";
  return (
    <View style={styles.section}>
      <Muted style={styles.sectionTitle} accessibilityRole="header">Strafen</Muted>
      <Card style={styles.list}>
        <Press
          // Die Website leitet /my/penalties nach Mein Bereich → Strafen - die Adresse ist kein App-Link, sie bleibt im Browser.
          onPress={() => openWebsite("/my/penalties")}
          accessibilityRole="link"
          style={styles.row}
          testID="mein-bereich-strafen-moderation"
        >
          <Ionicons name="shield-outline" color={standing?.active || hits ? colors.live : colors.cyan} size={20} />
          <View style={styles.flex}>
            <Body style={styles.strong}>Moderation</Body>
            <Muted>{standing === undefined ? "Wird geladen …" : detail}</Muted>
            <Muted style={styles.small}>Details und Einspruch auf der Website.</Muted>
          </View>
          <Ionicons name="open-outline" color={colors.muted} size={16} />
        </Press>
      </Card>
      {/* Strafen der Liga (E.3, #2173): gegen dich oder dein Co-Team, mit Einspruch - wie „Meine Strafen“ im Web. */}
      <LeagueSanctionsList />
    </View>
  );
}

/** Noch kein Mitglied: der Weg hinein - wie im Web unter Mitgliedschaft. */
function Beitreten({ text }: { text: string }) {
  return (
    <Card style={styles.join} testID="membership-join">
      <Ionicons name="ribbon-outline" color={colors.gold} size={24} />
      <Heading>Mitglied werden</Heading>
      <Muted>{text}</Muted>
      {JOIN_REASONS.map((reason) => (
        <View key={reason.title} style={styles.reason}>
          <Ionicons name={reason.icon} color={colors.gold} size={18} />
          <View style={styles.flex}>
            <Body style={styles.strong}>{reason.title}</Body>
            <Muted>{reason.detail}</Muted>
          </View>
        </View>
      ))}
      <Button label="Antrag stellen" onPress={() => { openLink(JOIN_URL); }} testID="membership-join-cta" />
      <Muted style={styles.small}>Schon Mitglied, aber hier steht nichts? Melde dich beim Vorstand – er verbindet dein Konto mit deinem Eintrag.</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 36,
  },
  intro: {
    fontSize: 13,
  },
  flex: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  strong: {
    fontWeight: "800",
  },
  small: {
    fontSize: 12,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  list: {
    gap: 0,
    padding: 0,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  join: {
    backgroundColor: "rgba(255,215,0,0.04)",
    borderColor: "rgba(255,215,0,0.3)",
    borderRadius: radius.lg,
    gap: 10,
  },
  reason: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
});
