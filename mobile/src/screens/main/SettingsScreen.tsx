import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { NavigationContext } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { BlockedUsersCard } from "../../components/BlockedUsersCard";
import { Card } from "../../components/Card";
import { PasskeysCard } from "../../components/PasskeysCard";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { availabilityText } from "../../lib/appLock";
import { formatDateTime } from "../../lib/format";
import { openLink } from "../../lib/openLink";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import { isGuestUser } from "../../live";
import { useAppLock } from "../../lock/AppLockProvider";
import { DecoSetting } from "../../seasons/DecoSetting";
import { colors } from "../../theme";
import { useOptionalAppUpdate } from "../../update/AppUpdateProvider";
import { dmOptions, MatrixToggle, notificationChannels, notificationLabels, notificationPreferenceKey, profileStyles, Toggle, type DiscordDmState } from "./profile/parts";

// Einstellungen an einem Ort (#1146): eine Seite mit Gruppen, Ort ist das Zahnrad oben im Profil (Fabians Wahl A).
// Reihenfolge wie auf der Website (/profile): Darstellung, Benachrichtigungen, Sicherheit, Privatsphäre, Konto, Über die
// App. Gäste sehen nur Darstellung und Über die App - im Profil-Tab unter dem Anmelde-Hinweis. Neue Einstellungen späterer
// Tickets (Aufruf-Ton, Vibration, Ruhezeit …) kommen nur hierher.

/** Die Gruppen in ihrer Reihenfolge - dieselben wie im Web (ein Test hält beide Listen gleich). */
export const SETTINGS_GROUPS = ["Darstellung", "Benachrichtigungen", "Sicherheit", "Privatsphäre", "Konto", "Über die App"] as const;
export const GUEST_SETTINGS_GROUPS = ["Darstellung", "Über die App"] as const;

export function SettingsScreen() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} testID="settings-screen">
        <SettingsGroups />
      </ScrollView>
    </Screen>
  );
}

/** Alle Gruppen der Einstellungen - auch im Profil-Tab für Gäste (nur Darstellung und Über die App). */
export function SettingsGroups() {
  const { user } = useAuth();
  const guest = !user || isGuestUser(user);
  return (
    <View style={styles.groups}>
      <Group title="Darstellung" testID="settings-group-appearance">
        <DecoSetting title={null} />
      </Group>
      {guest ? null : <AccountSettings />}
      <AboutGroup />
    </View>
  );
}

function Group({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.group} testID={testID}>
      <Muted style={styles.groupTitle} accessibilityRole="header">{title}</Muted>
      {children}
    </View>
  );
}

const SETTING_FIELDS = ["privacy_public_profile", "privacy_achievements_public", "show_twitch_embed", "privacy_season_finds_public", "dm_privacy", "newsletter_consent", "notification_preferences"] as const;

function settingsForm(user: Record<string, any> | null | undefined) {
  const u = user || {};
  return {
    privacy_public_profile: u.privacy_public_profile ?? true,
    privacy_achievements_public: u.privacy_achievements_public ?? true,
    show_twitch_embed: Boolean(u.show_twitch_embed),
    // Saison-Fundstücke (#678): Standard aus - erst mit dem Schalter sehen andere die Summen.
    privacy_season_finds_public: u.privacy_season_finds_public ?? false,
    dm_privacy: u.dm_privacy || "everyone",
    newsletter_consent: Boolean(u.newsletter_consent),
    notification_preferences: { ...(u.notification_preferences || {}) } as Record<string, boolean>,
  };
}

/** Benachrichtigungen, Sicherheit, Privatsphäre und Konto - nur mit Konto. Schalter speichern kurz nach dem letzten Tipp. */
function AccountSettings() {
  const { user, logout, refreshMe } = useAuth();
  const navigation = useContext(NavigationContext);
  const appLock = useAppLock();
  const [form, setForm] = useState(() => settingsForm(user as Record<string, any>));
  const [discordDm, setDiscordDm] = useState<DiscordDmState | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showTopics, setShowTopics] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<{ preferences?: Record<string, boolean>; discord?: DiscordDmState } | Record<string, boolean>>("/users/me/notification-preferences")
      .then(({ data }) => {
        setDiscordDm(((data as any)?.discord as DiscordDmState | undefined) || null);
        const preferences = ((data as any)?.preferences || data || {}) as Record<string, boolean>;
        setForm((current) => ({ ...current, notification_preferences: { ...current.notification_preferences, ...preferences } }));
      })
      .catch(() => {});
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage("");
    try {
      const payload: Record<string, unknown> = {};
      SETTING_FIELDS.forEach((key) => { payload[key] = formRef.current[key]; });
      await api.patch("/users/me", payload);
      setMessage("Gespeichert.");
      await refreshMe().catch(() => {});
    } catch (err) {
      setMessage(errorMessage(err, "Einstellung konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }, [refreshMe]);

  const change = useCallback((key: keyof ReturnType<typeof settingsForm>, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, 700);
  }, [save]);
  const changePreference = (key: string, value: boolean) => change("notification_preferences", { ...formRef.current.notification_preferences, [key]: value });

  const visibleChannels = notificationChannels.filter((channel) => channel.key !== "discord" || Boolean(discordDm?.linked));
  const channelEnabled = (key: string) => {
    if (key === "discord") return Boolean(form.notification_preferences.discord);
    const pref = form.notification_preferences;
    if (Object.prototype.hasOwnProperty.call(pref, key)) return Boolean(pref[key]);
    return true;
  };
  const topicEnabled = (channel: string, topic: string) => {
    if (channel === "email" && topic === "news_events" && !form.newsletter_consent) return false;
    const pref = form.notification_preferences;
    const key = notificationPreferenceKey(channel, topic);
    if (Object.prototype.hasOwnProperty.call(pref, key)) return Boolean(pref[key]);
    if (Object.prototype.hasOwnProperty.call(pref, topic)) return Boolean(pref[topic]);
    if (topic === "news_events") return Boolean(form.newsletter_consent);
    return true;
  };

  // Konto löschen (#390): derselbe Weg wie auf der Website (Anonymisierung), zweimal bestätigt.
  // Google Play verlangt das in der App, weil man sich hier auch registrieren kann.
  const deleteAccount = () => {
    Alert.alert(
      "Konto löschen?",
      "Dein Konto wird dauerhaft anonymisiert: Name, E-Mail, verknüpfte Konten, Profiltexte und Bilder werden entfernt, Chatnachrichten als gelöscht markiert. Turnier-Ergebnisse bleiben ohne Namen erhalten; Rechnungen bleiben in der Vereinsbuchhaltung, weil das Gesetz es verlangt. Das lässt sich nicht rückgängig machen.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Weiter",
          style: "destructive",
          onPress: () => Alert.alert("Wirklich löschen?", "Danach kannst du dich mit diesem Konto nicht mehr anmelden.", [
            { text: "Abbrechen", style: "cancel" },
            {
              text: "Konto löschen",
              style: "destructive",
              onPress: async () => {
                try {
                  await api.post("/dsgvo/anonymize-me");
                  await logout();
                } catch (error) {
                  Alert.alert("Das hat nicht geklappt", errorMessage(error, "Bitte später noch einmal versuchen oder an dsgvo@lionsquad.at schreiben."));
                }
              },
            },
          ]),
        },
      ],
    );
  };

  return (
    <>
      <Group title="Benachrichtigungen" testID="settings-group-notifications">
        <Card style={styles.card}>
          <Toggle first label="Newsletter" detail="Grundsätzliche Zustimmung für News und Events." value={form.newsletter_consent} onValueChange={(v) => change("newsletter_consent", v)} testID="settings-toggle-newsletter" />
          <Muted style={profileStyles.sectionText}>Kanäle</Muted>
          {visibleChannels.map((item) => (
            <Toggle key={item.key} label={item.label} detail={item.detail} value={channelEnabled(item.key)} onValueChange={(v) => changePreference(item.key, v)} />
          ))}
          {discordDm && !discordDm.linked ? <Muted testID="settings-discord-dm-unlinked">Discord als Kanal: erst auf der Website unter Socials „Mit Discord verknüpfen“ – dann kommen Benachrichtigungen auf Wunsch als Direktnachricht vom Vereins-Bot.</Muted> : null}
          {discordDm?.linked && discordDm.hint ? <Muted style={profileStyles.warningText}>{discordDm.hint}</Muted> : null}
          <Pressable onPress={() => setShowTopics((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded: showTopics }} style={styles.expand} testID="settings-topics-toggle">
            <Body style={styles.expandText}>{showTopics ? "Themen ausblenden" : "Jede Benachrichtigung pro Kanal"}</Body>
            <Ionicons name={showTopics ? "chevron-up" : "chevron-down"} color={colors.cyan} size={16} />
          </Pressable>
          {showTopics ? notificationLabels.map((item) => (
            <View key={item.key} style={profileStyles.notificationTopic}>
              <Body style={profileStyles.strong}>{item.label}</Body>
              <Muted>{item.detail}</Muted>
              {item.key === "news_events" && !form.newsletter_consent ? <Muted style={profileStyles.warningText}>E-Mail benötigt Newsletter-Zustimmung.</Muted> : null}
              <View style={profileStyles.notificationMatrix}>
                {visibleChannels.filter((channel) => !item.channels || item.channels.includes(channel.key)).map((channel) => {
                  const key = notificationPreferenceKey(channel.key, item.key);
                  const enabledChannel = channelEnabled(channel.key);
                  const disabled = !enabledChannel || (channel.key === "email" && item.key === "news_events" && !form.newsletter_consent);
                  return <MatrixToggle key={key} label={channel.label} value={enabledChannel && topicEnabled(channel.key, item.key)} disabled={disabled} onValueChange={(v) => changePreference(key, v)} />;
                })}
              </View>
            </View>
          )) : null}
        </Card>
      </Group>

      <Group title="Sicherheit" testID="settings-group-security">
        <Card style={styles.card}>
          {/* App-Sperre (#217): Einschalten fragt einmal den Fingerabdruck ab; ohne Gerätesperre bleibt der Schalter aus. */}
          <Toggle first label="App-Sperre mit Fingerabdruck" detail={`${availabilityText(appLock.availability)} Gilt nur auf diesem Gerät.`} value={appLock.enabled} onValueChange={(v) => { void appLock.setEnabled(v); }} testID="settings-toggle-app-lock" />
        </Card>
        {/* Passkeys (#919): dieselben wie auf der Website - anlegen und entfernen mit dem aktuellen Passwort. */}
        <PasskeysCard style={styles.card} />
        <SessionsCard />
      </Group>

      <Group title="Privatsphäre" testID="settings-group-privacy">
        <Card style={styles.card}>
          <Toggle first label="Öffentliches Profil" detail="Profil ist in der Community-Suche sichtbar." value={Boolean(form.privacy_public_profile)} onValueChange={(v) => change("privacy_public_profile", v)} testID="settings-toggle-public-profile" />
          {/* Wie im Web (#619): eigene Erfolge öffentlich oder privat - privat heißt auch keine Ranglisten. */}
          <Toggle
            label="Erfolge öffentlich"
            detail={`Angeheftete und erreichte Erfolge stehen in deinem Profil, und du stehst in den Ranglisten und im Erfolg der Woche. Die Verein-Kategorie sehen nur Mitglieder.${form.privacy_public_profile ? "" : " Wirkt erst, sobald das Profil öffentlich ist."}`}
            value={form.privacy_achievements_public !== false}
            onValueChange={(v) => change("privacy_achievements_public", v)}
            testID="settings-toggle-achievements-public"
          />
          <Toggle label="Twitch im Profil anzeigen" detail="Live-Embed darf auf deinem öffentlichen Profil erscheinen." value={Boolean(form.show_twitch_embed)} onValueChange={(v) => change("show_twitch_embed", v)} />
          <Toggle label="Saison-Fundstücke öffentlich" detail="Dein öffentliches Profil zeigt, was du über die Jahreszeiten gesammelt hast – nur die Summen, nie wann." value={form.privacy_season_finds_public === true} onValueChange={(v) => change("privacy_season_finds_public", v)} />
          <Muted>Direktnachrichten</Muted>
          <View style={profileStyles.optionGrid}>
            {dmOptions.map(([value, label]) => (
              <Pressable key={value} onPress={() => change("dm_privacy", value)} accessibilityRole="radio" accessibilityState={{ selected: form.dm_privacy === value }} style={[profileStyles.option, form.dm_privacy === value && profileStyles.optionActive]}>
                <Muted style={[profileStyles.optionText, form.dm_privacy === value && profileStyles.optionTextActive]}>{label}</Muted>
              </Pressable>
            ))}
          </View>
        </Card>
        {/* Blockierte Benutzer (#414): wie auf der Website unter Privatsphäre. */}
        <BlockedUsersCard style={styles.card} />
      </Group>

      {message ? <Muted style={message.includes("konnte") ? profileStyles.error : profileStyles.success} testID="settings-message">{saving ? "Speichert …" : message}</Muted> : null}

      <Group title="Konto" testID="settings-group-account">
        <Card style={styles.list}>
          <Row icon="create-outline" label="Profil bearbeiten" detail="Name, Bio, Spiele und Konten" onPress={() => navigation?.navigate("ProfileEdit" as never)} testID="settings-edit-profile" />
          <Row icon="document-lock-outline" label="Meine Daten" detail="Auskunft und Export auf der Website" onPress={() => openLink(`${WEB_BASE_URL}/privacy-account`)} testID="settings-data" border />
          <Row icon="log-out-outline" label="Abmelden" detail="Dieses Gerät aus deinem Konto ausloggen." onPress={() => { void logout(); }} tone="danger" testID="settings-logout" border />
          <Row icon="trash-outline" label="Konto löschen" detail="Dauerhaft anonymisieren – wie auf der Website unter Datenschutz." onPress={deleteAccount} tone="danger" testID="settings-delete" border />
        </Card>
      </Group>
    </>
  );
}

type Session = { id: string; client?: string; device?: string; user_agent?: string; last_active?: string | null; current?: boolean };

/** Angemeldete Geräte (wie im Web unter Sicherheit): einzelne abmelden oder alle anderen. */
function SessionsCard() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Session[]>("/auth/sessions");
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const others = (sessions || []).filter((session) => !session.current);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Bitte später noch einmal versuchen."));
    } finally {
      setBusy(false);
    }
  };
  if (!sessions?.length) return null;
  return (
    <Card style={styles.card} testID="settings-sessions">
      <Body style={profileStyles.strong}>Angemeldete Geräte</Body>
      {sessions.map((session) => (
        <View key={session.id} style={styles.session}>
          <Ionicons name={session.client === "mobile" ? "phone-portrait-outline" : "desktop-outline"} color={session.current ? colors.cyan : colors.muted} size={18} />
          <View style={styles.flex}>
            <Body numberOfLines={1}>{session.device || (session.client === "mobile" ? "App" : "Browser")}{session.current ? " · dieses Gerät" : ""}</Body>
            {session.last_active ? <Muted>Zuletzt {formatDateTime(session.last_active)}</Muted> : null}
          </View>
          {!session.current ? (
            <Pressable disabled={busy} onPress={() => { void run(() => api.delete(`/auth/sessions/${session.id}`)); }} accessibilityRole="button" hitSlop={8} testID={`settings-session-${session.id}`}>
              <Muted style={styles.danger}>Abmelden</Muted>
            </Pressable>
          ) : null}
        </View>
      ))}
      {others.length ? (
        <Pressable disabled={busy} onPress={() => { void run(() => api.post("/auth/sessions/logout-all")); }} accessibilityRole="button" style={styles.expand} testID="settings-sessions-all">
          <Body style={[styles.expandText, styles.danger]}>Alle anderen abmelden ({others.length})</Body>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** Über die App: Version, „Was ist neu“, Datenschutz und Impressum - auch für Gäste. */
function AboutGroup() {
  const openWhatsNew = useOptionalAppUpdate()?.openWhatsNew;
  const version = Constants.expoConfig?.version ?? "?";
  const build = Constants.expoConfig?.android?.versionCode;
  return (
    <Group title="Über die App" testID="settings-group-about">
      <Card style={styles.list}>
        <Row icon="information-circle-outline" label="Version" detail={`LionsAPP v${version}${build ? ` · Build ${build}` : ""}`} testID="settings-version" />
        {openWhatsNew ? <Row icon="sparkles-outline" label="Was ist neu" onPress={openWhatsNew} testID="more-whats-new" border /> : null}
        <Row icon="shield-outline" label="Datenschutz" onPress={() => openLink(`${WEB_BASE_URL}/privacy`)} testID="settings-privacy-policy" border />
        <Row icon="document-text-outline" label="Impressum" onPress={() => openLink(`${WEB_BASE_URL}/imprint`)} testID="settings-imprint" border />
      </Card>
    </Group>
  );
}

function Row({ icon, label, detail, onPress, tone, testID, border = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail?: string; onPress?: () => void; tone?: "danger"; testID?: string; border?: boolean }) {
  const color = tone === "danger" ? colors.live : colors.cyan;
  const content = (
    <>
      <Ionicons name={icon} color={color} size={20} />
      <View style={styles.flex}>
        <Body style={[profileStyles.strong, tone === "danger" && styles.danger]}>{label}</Body>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" color={colors.muted} size={16} /> : null}
    </>
  );
  if (!onPress) return <View style={[styles.row, border && styles.rowBorder]} testID={testID}>{content}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, border && styles.rowBorder, pressed && styles.pressed]} testID={testID}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 36,
  },
  groups: {
    gap: 20,
  },
  group: {
    gap: 8,
  },
  groupTitle: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  card: {
    gap: 12,
  },
  list: {
    gap: 0,
    padding: 0,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  danger: {
    color: colors.live,
  },
  expand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 40,
  },
  expandText: {
    color: colors.cyan,
    fontWeight: "800",
  },
  session: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  pressed: {
    opacity: 0.72,
  },
});
