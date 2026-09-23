import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { feeCard, formatMoney, linkPrompt, STATUS_LABELS, TYPE_LABELS, type DolibarrView } from "../../lib/memberArea";
import type { InvoiceList } from "../../lib/memberDocuments";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Meine Mitgliedschaft in der App (#339): Stand aus der Mitgliederverwaltung (Beitrag, Typ,
// Nummer) - und wer noch nicht zugeordnet ist, kann es anfragen. Die Belege selbst stehen unter
// „Meine Rechnungen“ (#320): Rechnungen gehören zum Konto, der Mitgliederbereich bleibt Verein.

type Props = NativeStackScreenProps<MoreStackParamList, "MyMembership">;

type MembershipMe = {
  membership?: { member_number?: string | null; member_since?: string | null; member_status?: string | null; membership_type?: string | null } | null;
  is_active_member?: boolean;
  dolibarr?: DolibarrView;
};

export function MyMembershipScreen({ navigation }: Props) {
  const [me, setMe] = useState<MembershipMe | null>(null);
  const [invoices, setInvoices] = useState<InvoiceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [memberRef, setMemberRef] = useState("");
  const [linkState, setLinkState] = useState<"idle" | "sending" | "sent">("idle");

  const load = useCallback(async () => {
    setError("");
    try {
      const [my, list] = await Promise.all([
        api.get<MembershipMe>("/membership/me"),
        api.get<InvoiceList>("/account/invoices").catch(() => null),
      ]);
      setMe(my.data || null);
      setInvoices(list?.data || null);
    } catch (err) {
      setError(errorMessage(err, "Die Mitgliedschaft konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const requestLink = async () => {
    setLinkState("sending");
    try {
      await api.post("/membership/dolibarr/link-request", { member_ref: memberRef.trim() || null });
      setLinkState("sent");
      load();
    } catch (err) {
      setLinkState("idle");
      setError(errorMessage(err, "Die Anfrage ging nicht raus."));
    }
  };

  const membership = me?.membership || null;
  const view = me?.dolibarr || null;
  const fee = feeCard(view);
  const prompt = linkPrompt(view);
  const status = String(membership?.member_status || (me?.is_active_member ? "active" : "none"));

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={3} hasImage={false} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
      >
        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        <Card style={styles.card} testID="membership-status">
          <View style={styles.rowBetween}>
            <Heading>{STATUS_LABELS[status] || status}</Heading>
            {view?.type_label || membership?.membership_type ? <Badge label={view?.type_label || TYPE_LABELS[String(membership?.membership_type)] || String(membership?.membership_type)} /> : null}
          </View>
          <View style={styles.facts}>
            <Fact label="Mitgliedsnummer" value={view?.member_ref || membership?.member_number || "–"} mono />
            <Fact label="Mitglied seit" value={membership?.member_since ? formatDate(membership.member_since) : "–"} />
          </View>
          {view?.functions?.length ? <Muted>Funktion: {view.functions.map((fn) => fn.label).filter(Boolean).join(", ")}</Muted> : null}
          <Pressable onPress={() => navigation.navigate("MemberCard")} accessibilityRole="button" testID="membership-card-link" style={({ pressed }) => [styles.inlineLink, pressed && styles.pressed]}>
            <Ionicons name="qr-code-outline" color={colors.gold} size={16} />
            <Body style={styles.inlineLinkText}>Mitgliedskarte anzeigen</Body>
          </Pressable>
        </Card>

        {fee ? (
          <Card style={[styles.card, fee.tone === "warn" ? styles.warn : fee.tone === "info" ? styles.info : styles.ok]} testID="membership-fee">
            <View style={styles.rowBetween}>
              <Heading>Beitrag</Heading>
              <Badge label={fee.label} tone={fee.tone} />
            </View>
            {fee.amount ? <Body style={styles.amount}>{fee.amount}</Body> : null}
            {fee.lines.map((line) => <Muted key={line}>{line}</Muted>)}
            {fee.asOf ? <Muted style={styles.asOf}>Stand {formatDateTime(fee.asOf)}{fee.stale ? " · älterer Stand, die Mitgliederverwaltung antwortet gerade nicht" : ""}</Muted> : null}
          </Card>
        ) : null}

        {prompt === "ask" ? (
          <Card style={styles.card} testID="membership-link">
            <Heading>Du bist Vereinsmitglied?</Heading>
            <Muted>Dein Konto ist noch nicht mit der Mitgliederverwaltung verbunden. Die Vereinsverwaltung prüft deine Anfrage und schaltet Beitrag, Belege und Karte frei.</Muted>
            <TextInput
              style={styles.input}
              placeholder="Mitgliedsnummer (falls bekannt)"
              placeholderTextColor={colors.muted}
              value={memberRef}
              onChangeText={setMemberRef}
              autoCapitalize="characters"
              testID="membership-link-ref"
            />
            <Button label={linkState === "sending" ? "Wird gesendet …" : "Zuordnung anfragen"} onPress={requestLink} disabled={linkState !== "idle"} />
          </Card>
        ) : null}
        {prompt === "requested" || linkState === "sent" ? (
          <Card style={[styles.card, styles.info]} testID="membership-link-requested">
            <Heading>Anfrage eingegangen</Heading>
            <Muted>Die Vereinsverwaltung bestätigt die Zuordnung. Danach siehst du hier Beitrag und Belege.</Muted>
          </Card>
        ) : null}
        {prompt === "conflict" ? (
          <Card style={[styles.card, styles.warn]}>
            <Heading>Bitte melde dich beim Verein</Heading>
            <Muted>Zu deinem Konto passen mehrere Einträge in der Mitgliederverwaltung. Die Vereinsverwaltung klärt das.</Muted>
          </Card>
        ) : null}

        <Card style={styles.card} testID="membership-invoices">
          <Heading>Belege</Heading>
          {invoices?.summary?.open_count ? (
            <Muted style={styles.openSummary}>
              {invoices.summary.open_count} offen · {formatMoney(invoices.summary.open_total, invoices.currency)}
              {invoices.summary.overdue_count ? ` · ${invoices.summary.overdue_count} überfällig` : ""}
            </Muted>
          ) : null}
          <Muted>Beitrag, Events und Turniere – alle deine Rechnungen stehen gesammelt unter „Meine Rechnungen“.</Muted>
          <Button label="Meine Rechnungen" variant="secondary" onPress={() => navigation.navigate("MyInvoices")} testID="membership-invoices-link" />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fact}>
      <Muted style={styles.factLabel}>{label}</Muted>
      <Body style={[styles.factValue, mono && styles.mono]}>{value}</Body>
    </View>
  );
}

function Badge({ label, tone = "gold" }: { label: string; tone?: "gold" | "ok" | "warn" | "info" }) {
  const color = tone === "ok" ? colors.success : tone === "warn" ? colors.live : tone === "info" ? colors.cyan : colors.gold;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Muted style={[styles.badgeText, { color }]}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 32,
  },
  card: {
    gap: 10,
  },
  ok: {
    borderColor: "rgba(0, 255, 136, 0.32)",
  },
  warn: {
    borderColor: "rgba(255, 59, 48, 0.5)",
  },
  info: {
    borderColor: "rgba(41, 182, 232, 0.4)",
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  facts: {
    flexDirection: "row",
    gap: 14,
  },
  fact: {
    flex: 1,
    gap: 2,
  },
  factLabel: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  factValue: {
    fontWeight: "900",
  },
  mono: {
    color: colors.gold,
    fontFamily: "monospace",
  },
  amount: {
    color: colors.white,
    fontSize: 26,
    fontWeight: "900",
  },
  asOf: {
    fontSize: 11,
  },
  inlineLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  inlineLinkText: {
    color: colors.gold,
    fontWeight: "900",
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.white,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  section: {
    gap: 10,
  },
  openSummary: {
    color: colors.white,
    fontWeight: "900",
  },
  invoice: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  invoiceText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  invoiceTitle: {
    fontWeight: "900",
  },
  invoiceRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  invoiceAmount: {
    fontWeight: "900",
  },
  badge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "900",
  },
  error: {
    color: colors.live,
  },
  pressed: {
    opacity: 0.72,
  },
});
