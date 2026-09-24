import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { feeCard, formatMoney, linkPrompt, STATUS_LABELS, TYPE_LABELS, type DolibarrView } from "../../lib/memberArea";
import type { InvoiceList } from "../../lib/memberDocuments";
import { changedFields, exitLine, fieldLabel, selfRequestLine, validWishedDay, changedWebsiteFields, websiteFieldText, websiteStateLine, type IdentityState, type SelfService, type WebsiteField, type WebsiteProfile } from "../../lib/selfService";
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
  // Vereinsakte (#324 Teil 1) und eigene Daten/Austritt (#329 Teil 2): dieselben Routen wie im Web.
  const [identity, setIdentity] = useState<IdentityState | null>(null);
  const [self, setSelf] = useState<SelfService | null>(null);
  const [code, setCode] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [wishedDay, setWishedDay] = useState("");
  const [busy, setBusy] = useState<"" | "claim" | "save" | "exit" | "website">("");
  // Eigenes Website-Profil (#260): liegt in der Vereinsakte, sichtbar nur mit Einwilligung.
  const [website, setWebsite] = useState<WebsiteProfile | null>(null);
  const [websiteDraft, setWebsiteDraft] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      const [my, list, ident, selfView, websiteView] = await Promise.all([
        api.get<MembershipMe>("/membership/me"),
        api.get<InvoiceList>("/account/invoices").catch(() => null),
        api.get<IdentityState>("/membership/me/identity").catch(() => null),
        api.get<SelfService>("/membership/me/self-service").catch(() => null),
        api.get<WebsiteProfile>("/membership/me/website-profile").catch(() => null),
      ]);
      setMe(my.data || null);
      setInvoices(list?.data || null);
      setIdentity(ident?.data && ident.data.available === true ? ident.data : null);
      setSelf(selfView?.data && selfView.data.available === true && selfView.data.profile ? selfView.data : null);
      setDraft({});
      setWebsite(websiteView?.data && websiteView.data.available === true ? websiteView.data : null);
      setWebsiteDraft({});
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

  const claimCode = async () => {
    if (!code.trim() || busy) return;
    setBusy("claim");
    try {
      await api.post("/membership/me/identity", { code: code.trim() });
      setCode("");
      Alert.alert("Verbunden", "Deine Unterlagen aus der Vereinsakte stehen jetzt unter Vereinsdokumente.");
      load();
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Der Code wurde nicht angenommen."));
    } finally {
      setBusy("");
    }
  };

  const profile = self?.profile || null;
  const changeable = self?.changeable || [];
  const changed = profile ? changedFields(profile, draft, changeable) : {};
  const saveChanges = async () => {
    if (!profile || busy || !Object.keys(changed).length) return;
    setBusy("save");
    try {
      const { data } = await api.post<{ status?: string }>("/membership/me/self-service/changes", { version: profile.version, changes: changed });
      Alert.alert(data?.status === "applied" ? "Übernommen" : "Eingereicht", data?.status === "applied" ? "Deine Daten sind aktuell." : "Der Vorstand prüft die Änderung.");
      load();
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Die Änderung wurde nicht angenommen."));
    } finally {
      setBusy("");
    }
  };
  const sendExit = async () => {
    setBusy("exit");
    try {
      const { data } = await api.post<{ last_day?: string; wished_too_early?: boolean }>("/membership/me/self-service/exit", wishedDay ? { wished_last_day: wishedDay } : {});
      Alert.alert("Austritt eingegangen", `Letzter Tag der Mitgliedschaft: ${formatDate(data?.last_day)}${data?.wished_too_early ? " – dein Wunschdatum lag vor der Kündigungsfrist." : "."}`);
      setWishedDay("");
      load();
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Die Erklärung wurde nicht angenommen."));
    } finally {
      setBusy("");
    }
  };
  const websiteChanged = website ? changedWebsiteFields(website, websiteDraft) : {};
  const websiteValue = (field: WebsiteField) => (field.code in websiteDraft ? websiteDraft[field.code] : field.value);
  const saveWebsite = async () => {
    if (!website || busy || !Object.keys(websiteChanged).length) return;
    setBusy("website");
    try {
      const { data } = await api.put<WebsiteProfile>("/membership/me/website-profile", { fields: websiteChanged });
      setWebsite(data && data.available === true ? data : website);
      setWebsiteDraft({});
      Alert.alert("Gespeichert", "Dein Website-Profil ist aktualisiert.");
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Das Profil wurde nicht angenommen."));
    } finally {
      setBusy("");
    }
  };

  // Eingabe je Feldart (Vereine 1.2): Text, langer Text, Zahl, Datum, Ja/Nein, eine Option, mehrere Optionen.
  const renderWebsiteField = (field: WebsiteField) => {
    const testID = `membership-website-${field.code}`;
    const value = websiteValue(field);
    const set = (next: unknown) => setWebsiteDraft((current) => ({ ...current, [field.code]: next }));
    if (!field.editable) return <Muted testID={testID}>{websiteFieldText(field) || "–"}</Muted>;
    if (field.type === "boolean") return <Switch value={!!value} onValueChange={set} testID={testID} />;
    if (field.type === "select" || field.type === "multi") {
      const chosen = field.type === "multi" ? (Array.isArray(value) ? (value as string[]) : []) : value ? [String(value)] : [];
      return (
        <View style={styles.chips} testID={testID}>
          {(field.options ?? []).map((option) => {
            const active = chosen.includes(option.code);
            const next = field.type === "multi" ? (active ? chosen.filter((c) => c !== option.code) : [...chosen, option.code]) : active ? null : option.code;
            return (
              <Pressable key={option.code} onPress={() => set(next)} style={[styles.chip, active && styles.chipActive]} testID={`${testID}-${option.code}`}>
                <Muted style={active ? styles.chipTextActive : undefined}>{option.label}</Muted>
              </Pressable>
            );
          })}
        </View>
      );
    }
    return (
      <TextInput
        style={[styles.input, field.type === "textarea" && styles.multiline]}
        value={value === null || value === undefined ? "" : String(value)}
        onChangeText={set}
        placeholder={field.type === "date" ? "JJJJ-MM-TT" : undefined}
        placeholderTextColor={colors.muted}
        multiline={field.type === "textarea"}
        keyboardType={field.type === "number" ? "numeric" : "default"}
        maxLength={field.max_length ?? (field.type === "textarea" ? 2000 : 255)}
        testID={testID}
      />
    );
  };

  const askExit = () => {
    if (busy) return;
    if (!validWishedDay(wishedDay.trim())) {
      Alert.alert("Wunschdatum", "Bitte als JJJJ-MM-TT eintragen, z. B. 2026-12-31.");
      return;
    }
    Alert.alert(
      "Austritt aus dem Verein erklären?",
      `Die Erklärung geht heute bei der Vereinsverwaltung ein. Wann die Mitgliedschaft endet, ergibt die Kündigungsregel des Vereins${wishedDay ? ` – dein Wunschdatum gilt nur, wenn es nicht davor liegt` : ""}. Das lässt sich in der App nicht zurücknehmen.`,
      [{ text: "Abbrechen", style: "cancel" }, { text: "Austritt erklären", style: "destructive", onPress: () => { sendExit(); } }],
    );
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

        {identity ? (
          <Card style={[styles.card, identity.status === "bound" ? styles.ok : styles.info]} testID="membership-identity">
            <Heading>Vereinsakte</Heading>
            {identity.status === "bound" && identity.via === "member" ? (
              <Muted testID="membership-identity-bound">
                Über deine Mitgliedsnummer{identity.member_ref ? ` ${identity.member_ref}` : ""} verbunden – Unterlagen, eigene Daten und Website-Profil kommen von selbst aus der Mitgliederverwaltung.
                {identity.right_missing ? " Die Website darf dort noch nicht im Namen der Mitglieder handeln – der Vorstand richtet das Recht ein." : ""}
              </Muted>
            ) : identity.status === "bound" ? (
              <Muted testID="membership-identity-bound">
                Verbunden seit {formatDate(identity.linked_at)}{identity.capability_labels?.length ? ` (${identity.capability_labels.join(", ")})` : ""}. Deine Unterlagen stehen unter Vereinsdokumente.
              </Muted>
            ) : (
              <>
                <Muted>
                  {identity.status === "revoked"
                    ? "Der Verein hat die Verbindung widerrufen. Mit einem neuen Code vom Vorstand verbindest du dein Konto wieder."
                    : identity.module_too_old
                      ? "Dein Konto ist deinem Mitgliedseintrag zugeordnet – ohne Code geht es ab Vereinsmodul 1.4.0. Bis dahin: Einladungscode vom Vorstand."
                      : "Sobald dein Konto deinem Mitgliedseintrag zugeordnet ist (E-Mail-Abgleich oder Vorstand), kommen deine Unterlagen von selbst. Alternativ: Einladungscode vom Vorstand (eine Stunde, genau einmal)."}
                </Muted>
                <TextInput
                  style={styles.input}
                  placeholder="Einladungscode"
                  placeholderTextColor={colors.muted}
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  testID="membership-identity-code"
                />
                <Button label={busy === "claim" ? "Prüfe …" : "Verbinden"} onPress={claimCode} disabled={busy !== "" || !code.trim()} testID="membership-identity-claim" />
              </>
            )}
          </Card>
        ) : null}

        {self && profile ? (
          <Card style={styles.card} testID="membership-self">
            <Heading>Meine Daten</Heading>
            <Muted testID="membership-self-identity">
              {profile.firstname} {profile.lastname} · {profile.member_type}{profile.ref ? ` · Nr. ${profile.ref}` : ""}{profile.birth ? ` · geboren ${formatDate(profile.birth)}` : ""}
            </Muted>
            <Muted style={styles.hint}>
              Name und Geburtsdatum ändert nur der Vorstand.{profile.direct?.length ? ` ${profile.direct.map(fieldLabel).join(" und ")} übernimmt der Verein sofort;` : ""} alles andere prüft der Vorstand.
            </Muted>
            {changeable.map((key) => (
              <View key={key} style={styles.field}>
                <Muted style={styles.factLabel}>{fieldLabel(key)}</Muted>
                <TextInput
                  style={styles.input}
                  value={key in draft ? draft[key] : String((profile as Record<string, unknown>)[key] ?? "")}
                  onChangeText={(value) => setDraft((current) => ({ ...current, [key]: value }))}
                  placeholderTextColor={colors.muted}
                  autoCapitalize={key === "email" ? "none" : "sentences"}
                  keyboardType={key === "email" ? "email-address" : key.startsWith("phone") ? "phone-pad" : "default"}
                  testID={`membership-self-field-${key}`}
                />
              </View>
            ))}
            <Button label={busy === "save" ? "Sende …" : "Änderung senden"} onPress={saveChanges} disabled={busy !== "" || !Object.keys(changed).length} testID="membership-self-save" />
            {self.requests?.length ? (
              <View style={styles.requests} testID="membership-self-requests">
                <Muted style={styles.factLabel}>Eingereicht</Muted>
                {self.requests.slice().reverse().map((row) => (
                  <View key={row.external_id} style={styles.request} testID={`membership-self-request-${row.external_id}`}>
                    <Body>{selfRequestLine(row)}</Body>
                    <Muted>{row.status_label || row.status || ""}{row.reason ? ` – ${row.reason}` : ""}</Muted>
                  </View>
                ))}
              </View>
            ) : null}
            {profile.exit ? (
              <Muted style={styles.exitPlanned} testID="membership-self-exit-planned">{exitLine(profile)}</Muted>
            ) : (
              <View style={styles.exitBox} testID="membership-self-exit">
                <Muted style={styles.factLabel}>Austritt – Wunschdatum (optional, JJJJ-MM-TT)</Muted>
                <TextInput
                  style={styles.input}
                  placeholder="2026-12-31"
                  placeholderTextColor={colors.muted}
                  value={wishedDay}
                  onChangeText={setWishedDay}
                  autoCapitalize="none"
                  testID="membership-self-exit-date"
                />
                <Button label="Austritt erklären" variant="secondary" onPress={askExit} disabled={busy !== ""} testID="membership-self-exit-button" />
              </View>
            )}
          </Card>
        ) : null}

        {website ? (
          <Card style={styles.card} testID="membership-website">
            <Heading>Mein Website-Profil</Heading>
            <Muted testID="membership-website-state">{websiteStateLine(website)}</Muted>
            {!(website.fields ?? []).length ? <Muted testID="membership-website-empty">Der Verein hat noch keine Felder für das Website-Profil gewählt.</Muted> : null}
            {(website.fields ?? []).map((field) => (
              <View key={field.code} style={styles.field}>
                <Muted style={styles.factLabel}>{field.label}{field.editable ? "" : " · pflegt der Verein"}</Muted>
                {renderWebsiteField(field)}
              </View>
            ))}
            {(website.fields ?? []).some((field) => field.editable) ? (
              <Button label={busy === "website" ? "Sende …" : "Profil speichern"} onPress={saveWebsite} disabled={busy !== "" || !Object.keys(websiteChanged).length} testID="membership-website-save" />
            ) : null}
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
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    borderColor: colors.gold,
  },
  chipTextActive: {
    color: colors.gold,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  hint: {
    fontSize: 12,
  },
  field: {
    gap: 4,
  },
  requests: {
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 10,
  },
  request: {
    borderLeftColor: "rgba(255, 215, 0, 0.4)",
    borderLeftWidth: 2,
    gap: 2,
    paddingLeft: 10,
  },
  exitBox: {
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 10,
  },
  exitPlanned: {
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: 1,
    color: colors.white,
    paddingTop: 10,
  },
  error: {
    color: colors.live,
  },
  pressed: {
    opacity: 0.72,
  },
});
