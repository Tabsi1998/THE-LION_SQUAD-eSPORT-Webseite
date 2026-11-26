import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { NavigationContext } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AnkerView } from "../../components/Anker";
import { BlockedUsersCard } from "../../components/BlockedUsersCard";
import { Card } from "../../components/Card";
import { MemberConsents } from "../../components/MemberConsents";
import { PasskeysCard } from "../../components/PasskeysCard";
import { Body, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { friendsSharing } from "../../lib/eventRecap";
import { availabilityText } from "../../lib/appLock";
import { formatDateTime } from "../../lib/format";
import { BEREICH, siehtVerein } from "../../lib/meinBereich";
import { openLink, openWebsite } from "../../lib/openLink";
import { ACCOUNT_CHANGED_MESSAGE } from "../../lib/profileSaveQueue";
import { useProfileSaveQueue } from "../../lib/useProfileSaveQueue";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import { bugReportUrl } from "../../lib/contactLinks";
import { isGuestUser } from "../../live";
import { useAppLock } from "../../lock/AppLockProvider";
import { DecoSetting } from "../../seasons/DecoSetting";
import { colors } from "../../theme";
import { useOptionalAppUpdate } from "../../update/AppUpdateProvider";
import { quietHoursForm, readNotificationServer, type DigestRhythm, type NotificationServerInfo, type Prefs, type QuietHours } from "../../lib/notificationLevels";
import { NotificationLevels } from "./profile/NotificationLevels";
import { dmOptions, MatrixToggle, notificationChannels, notificationLabels, notificationPreferenceKey, profileStyles, Toggle, type DiscordDmState } from "./profile/parts";
import { PushOffHint } from "../../components/PushOffHint";
import { selectFeedback } from "../../components/motion/Press";

// Die Einstellungen in Mein Bereich (#2059, #1677): früher eine lange Seite hinter dem Zahnrad im Profil (#1146), jetzt dort,
// wo man sie sucht - dieselben Gruppen wie im Web: Benachrichtigungen, Konto & Sicherheit, Datenschutz. Jede Gruppe ist eine
// kurze Seite (MeinBereichGruppeScreen) und hat ihre eigene Speicher-Warteschlange; Schalter speichern kurz nach dem letzten
// Tipp. Jede Stelle ist ein Sprungziel (AnkerView) - die Suche in Mein Bereich führt genau dorthin. Gäste sehen nur
// Darstellung und „Über die App“ (in der Übersicht unter dem Anmelde-Hinweis).

/** Die Gruppen von Mein Bereich, deren Inhalt hier steht. */
export type SettingsGruppe = "benachrichtigungen" | "konto" | "datenschutz";

/** Die Abschnitte je Gruppe in ihrer Reihenfolge - Titel wie im Web. */
export const SETTINGS_SECTIONS: Record<SettingsGruppe, string[]> = {
  benachrichtigungen: ["Benachrichtigungen"],
  konto: ["Sicherheit", "Darstellung", "Kalender", "Über die App", "Abmelden"],
  datenschutz: ["Sichtbarkeit", "Einwilligungen", "Daten herunterladen", "Konto löschen"],
};
export const GUEST_SETTINGS_SECTIONS = ["Darstellung", "Über die App"] as const;

/** Die Einstellungen einer Gruppe von Mein Bereich - ohne Konto nur das, was auch Gäste haben (Konto & Sicherheit). */
export function GruppenEinstellungen({ gruppe, ziel }: { gruppe: SettingsGruppe; ziel?: string }) {
  const { user } = useAuth();
  const guest = !user || isGuestUser(user);
  if (guest) return gruppe === "konto" ? <GuestSettings /> : null;
  return <AccountSettings gruppe={gruppe} ziel={ziel} />;
}

/** Für Gäste: Darstellung und „Über die App“ - in der Übersicht von Mein Bereich unter dem Anmelde-Hinweis. */
export function GuestSettings() {
  return (
    <View style={styles.groups}>
      <AppearanceGroup />
      <AboutGroup />
    </View>
  );
}

/** Ein Abschnitt mit Überschrift - zugleich ein Sprungziel. Die innere Hülle liegt bei 0, Ziele darin rechnen richtig. */
function Group({ id, title, children, testID }: { id: string; title: string; children: React.ReactNode; testID?: string }) {
  return (
    <AnkerView id={id}>
      <View testID={testID} style={styles.group}>
        <Muted style={styles.groupTitle} accessibilityRole="header">{title}</Muted>
        {children}
      </View>
    </AnkerView>
  );
}

function AppearanceGroup() {
  return (
    <Group id="darstellung" title="Darstellung" testID="settings-group-appearance">
      <DecoSetting title={null} />
    </Group>
  );
}

function settingsForm(user: Record<string, any> | null | undefined) {
  const u = user || {};
  return {
    privacy_public_profile: u.privacy_public_profile ?? true,
    privacy_achievements_public: u.privacy_achievements_public ?? true,
    // Vereinsinterne Erfolge (#2516): Standard an - ohne Feld sehen Mitglieder auch Internes (Gäste nie).
    privacy_members_see_internal: u.privacy_members_see_internal ?? true,
    show_twitch_embed: Boolean(u.show_twitch_embed),
    // Saison-Fundstücke (#678): Standard aus - erst mit dem Schalter sehen andere die Summen.
    privacy_season_finds_public: u.privacy_season_finds_public ?? false,
    // Freunde beim Event (#1188): Standard an, mit Geburtsdatum unter 14 Jahren aus - der wirksame Stand wie am Server.
    privacy_friends_see_registrations: friendsSharing(u),
    dm_privacy: u.dm_privacy || "everyone",
    newsletter_consent: Boolean(u.newsletter_consent),
    notification_preferences: { ...(u.notification_preferences || {}) } as Record<string, boolean>,
    // Ruhezeit (#2444, Web #1206): Wiener Zeit, Standard aus. Geht nur mit, wenn sie geändert wurde - ein älterer Server
    // bekommt das Feld so nie.
    quiet_hours: quietHoursForm(u.quiet_hours) as QuietHours,
    // Sammel-Mail (#1662): sofort, täglich oder wöchentlich - ohne eigene Wahl (null) gilt die Vorgabe des Vereins.
    mail_digest: (["instant", "daily", "weekly"].includes(u.mail_digest) ? u.mail_digest : null) as DigestRhythm | null,
  };
}

type SettingsForm = ReturnType<typeof settingsForm>;

/** Benachrichtigungen, Konto & Sicherheit oder Datenschutz - mit Konto. */
function AccountSettings({ gruppe, ziel }: { gruppe: SettingsGruppe; ziel?: string }) {
  const { user, logout, refreshMe } = useAuth();
  const navigation = useContext(NavigationContext);
  const appLock = useAppLock();
  const [discordDm, setDiscordDm] = useState<DiscordDmState | null>(null);
  const [showTopics, setShowTopics] = useState(false);
  // Stufen, Themen und Ruhezeit (#2444): was der Server dazu sagt. `serverKind` gilt für den Server, nicht für das Konto - beim
  // Kontowechsel bleibt die Ansicht, bis die neuen Daten da sind. Ein älterer Server ohne Stufen zeigt die bisherige Ansicht.
  const [server, setServer] = useState<{ status: "loading" | "ready" | "failed"; info: NotificationServerInfo | null }>({ status: "loading", info: null });
  const [serverKind, setServerKind] = useState<"unknown" | "levels" | "legacy">("unknown");
  const [loadRound, setLoadRound] = useState(0);
  // Die vollständigen Benachrichtigungs-Vorgaben vom Server; das Konto selbst speichert nur Abweichungen. Sie gehören
  // genau einem Konto - für jedes andere gelten sie nicht (nach Codex-Prüfung von #1528).
  const preferenceDefaults = useRef<{ account: string | null; prefs: Record<string, boolean> }>({ account: null, prefs: {} });
  const fromServer = useCallback((data: Record<string, any>) => {
    const next = settingsForm(data);
    const owner = data?.id != null ? String(data.id) : null;
    const defaults = owner != null && preferenceDefaults.current.account === owner ? preferenceDefaults.current.prefs : {};
    return { ...next, notification_preferences: { ...defaults, ...next.notification_preferences } };
  }, []);
  // Speicher-Warteschlange (#1061): ein PATCH zur Zeit, nur Geändertes, nie ins falsche Konto.
  const saver = useProfileSaveQueue<SettingsForm>({
    user: user as Record<string, any> | null,
    fromServer,
    onSaved: () => { void refreshMe().catch(() => {}); },
  });
  const form = saver.form;
  const { queue } = saver;
  const notifications = gruppe === "benachrichtigungen";

  // Je Konto neu laden (nur die Seite Benachrichtigungen braucht die Stufen). Kommt die Antwort erst, nachdem schon
  // gespeichert wurde, verwirft die Warteschlange sie (Stempel); was inzwischen umgeschaltet wurde, bleibt stehen. Eine
  // Antwort für ein Konto, das nicht mehr angemeldet ist, wird ganz verworfen.
  const account = user?.id != null ? String(user.id) : null;
  useEffect(() => {
    setDiscordDm(null);
    setServer({ status: "loading", info: null });
    if (account == null || !notifications) return undefined;
    let current = true;
    const stamp = queue.stamp();
    api.get<unknown>("/users/me/notification-preferences")
      .then(({ data }) => {
        const info = readNotificationServer(data);
        // Ob der Server Stufen kennt, sagt auch eine Antwort für ein voriges Konto.
        setServerKind(info.levelsSupported ? "levels" : "legacy");
        if (!current || queue.getState().account !== account) return;
        setDiscordDm((info.discord as DiscordDmState | null) || null);
        const preferences = info.preferences;
        preferenceDefaults.current = { account, prefs: preferences };
        const confirmed = queue.getState().confirmed;
        queue.merge({
          notification_preferences: { ...(confirmed.notification_preferences || {}), ...preferences },
          ...(info.quietHours ? { quiet_hours: info.quietHours } : {}),
          // Sammel-Mail (#1662): die eigene Wahl sagt der Server (`own`, null = Vorgabe des Vereins).
          ...(info.digest ? { mail_digest: info.digest.own } : {}),
        }, stamp);
        setServer({ status: "ready", info });
      })
      .catch(() => {
        if (current) setServer({ status: "failed", info: null });
      });
    return () => {
      current = false;
    };
  }, [account, notifications, queue, loadRound]);

  const change = useCallback((key: keyof SettingsForm, value: unknown) => {
    queue.edit({ [key]: value } as Partial<SettingsForm>);
    saver.schedule();
  }, [queue, saver.schedule]);
  const changePreference = (key: string, value: boolean) => changePreferences({ [key]: value });
  // Eine Stufe stellt viele Schalter auf einmal (#2444) - ein Schritt, ein PATCH.
  const changePreferences = (patch: Prefs) => {
    queue.edit((current) => ({ ...current, notification_preferences: { ...current.notification_preferences, ...patch } }));
    saver.schedule();
  };
  const status = saver.state.status;
  const message = status === "saving"
    ? "Speichert …"
    : status === "error"
      ? (saver.state.error instanceof Error && saver.state.error.message === ACCOUNT_CHANGED_MESSAGE
        ? ACCOUNT_CHANGED_MESSAGE
        : errorMessage(saver.state.error, "Einstellung konnte nicht gespeichert werden."))
      : status === "saved" ? "Gespeichert." : "";

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
                  // Das Konto wird anonymisiert - ein wartender Schalter wird nicht mehr gespeichert.
                  saver.cancel();
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

  const saveState = message ? (
    <View style={styles.saveState}>
      <Muted style={status === "error" ? profileStyles.error : profileStyles.success} testID="settings-message" accessibilityLiveRegion="polite">{message}</Muted>
      {status === "error" ? (
        <Pressable onPress={() => { void saver.save(); }} accessibilityRole="button" style={styles.expand} testID="settings-retry">
          <Body style={styles.expandText}>Erneut versuchen</Body>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  if (gruppe === "benachrichtigungen") {
    return (
      <View style={styles.groups}>
        <Group id="benachrichtigungen" title="Benachrichtigungen" testID="settings-group-notifications">
          {/* Android lässt nichts durch (#1208): hier derselbe leise Weg zum Einschalten wie auf Turnier- und Event-Seiten. */}
          <PushOffHint testID="settings-push-off" />
          {server.status === "failed" ? (
            <View style={styles.loadFailed} accessibilityRole="alert" testID="notification-load-failed">
              <Muted style={styles.loadFailedText}>Die Stufen konnten nicht geladen werden. Deine Themen unten gelten weiter.</Muted>
              <Pressable onPress={() => setLoadRound((value) => value + 1)} accessibilityRole="button" style={styles.expand} testID="notification-load-retry">
                <Body style={styles.expandText}>Erneut versuchen</Body>
              </Pressable>
            </View>
          ) : null}
          {server.status === "ready" && server.info?.levelsSupported ? (
            // Die Hülle ist das Eltern-Ziel der Karten darin (Stufe, Themen, Ruhezeit, Sammel-Mail, Weitere Wege).
            <AnkerView id="benachrichtigungen-karten">
              <NotificationLevels
                info={server.info}
                prefs={form.notification_preferences}
                newsletter={Boolean(form.newsletter_consent)}
                quiet={form.quiet_hours}
                digest={form.mail_digest}
                channelEnabled={channelEnabled}
                topicEnabled={topicEnabled}
                onPrefs={changePreferences}
                onNewsletter={(value) => change("newsletter_consent", value)}
                onQuiet={(next) => change("quiet_hours", next)}
                onDigest={(next) => change("mail_digest", next)}
                moreOpen={ziel === "weitere-wege" || ziel === "newsletter"}
              />
            </AnkerView>
          ) : server.status === "loading" && serverKind !== "legacy" ? (
            <View style={styles.levelSkeleton} accessibilityLabel="Benachrichtigungen werden geladen" testID="notification-levels-loading">
              {[0, 1, 2].map((index) => <View key={index} style={styles.levelSkeletonCard} />)}
            </View>
          ) : (
          <Card style={styles.card} testID="notification-legacy">
            <Toggle first label="Newsletter" detail="Grundsätzliche Zustimmung für News und Events." value={form.newsletter_consent} onValueChange={(v) => change("newsletter_consent", v)} testID="settings-toggle-newsletter" />
            <Muted style={profileStyles.sectionText}>Kanäle</Muted>
            {visibleChannels.map((item) => (
              <Toggle key={item.key} label={item.label} detail={item.detail} value={channelEnabled(item.key)} onValueChange={(v) => changePreference(item.key, v)} />
            ))}
            {discordDm && !discordDm.linked ? <Muted testID="settings-discord-dm-unlinked">Discord als Kanal: erst auf der Website unter Mein Bereich → Profil → Socials „Mit Discord verknüpfen“ – dann kommen Benachrichtigungen auf Wunsch als Direktnachricht vom Vereins-Bot.</Muted> : null}
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
          )}
        </Group>
        {saveState}
      </View>
    );
  }

  if (gruppe === "datenschutz") {
    const mitglied = siehtVerein(user);
    return (
      <View style={styles.groups}>
        <Group id="sichtbarkeit" title="Sichtbarkeit" testID="settings-group-privacy">
          <AnkerView id="sichtbarkeit-karte">
            <Card style={styles.card}>
              <AnkerView id="oeffentliches-profil">
                <Toggle first label="Öffentliches Profil" detail="Profil ist in der Community-Suche sichtbar." value={Boolean(form.privacy_public_profile)} onValueChange={(v) => change("privacy_public_profile", v)} testID="settings-toggle-public-profile" />
              </AnkerView>
              {/* Wie im Web (#619): eigene Erfolge öffentlich oder privat - privat heißt auch keine Ranglisten. */}
              <AnkerView id="erfolge-oeffentlich">
                <Toggle
                  label="Erfolge öffentlich"
                  detail={`Angeheftete und erreichte Erfolge stehen in deinem Profil, und du stehst in den Ranglisten und im Erfolg der Woche. Die Verein-Kategorie sehen nur Mitglieder.${form.privacy_public_profile ? "" : " Wirkt erst, sobald das Profil öffentlich ist."}`}
                  value={form.privacy_achievements_public !== false}
                  onValueChange={(v) => change("privacy_achievements_public", v)}
                  testID="settings-toggle-achievements-public"
                />
              </AnkerView>
              {/* Wie im Web (#2516): bei den Erfolgen eingeordnet - Gäste sehen Internes nie, auch nicht hiermit. */}
              <AnkerView id="vereinsintern">
                <Toggle
                  label="Vereinsinterne Erfolge zeigen"
                  detail={`Mitglieder sehen auch deine vereinsinternen Turniere, Zeiten, Trophäen und Liga-Seasons. Öffentlich sind sie nie zu sehen.${form.privacy_public_profile ? "" : " Wirkt erst, sobald das Profil öffentlich ist."}`}
                  value={form.privacy_members_see_internal !== false}
                  onValueChange={(v) => change("privacy_members_see_internal", v)}
                  testID="settings-toggle-members-internal"
                />
              </AnkerView>
              <AnkerView id="twitch">
                <Toggle label="Twitch im Profil anzeigen" detail="Live-Embed darf auf deinem öffentlichen Profil erscheinen." value={Boolean(form.show_twitch_embed)} onValueChange={(v) => change("show_twitch_embed", v)} testID="settings-toggle-twitch" />
              </AnkerView>
              <AnkerView id="saison-fundstuecke">
                <Toggle label="Saison-Fundstücke öffentlich" detail="Dein öffentliches Profil zeigt, was du über die Jahreszeiten gesammelt hast – nur die Summen, nie wann." value={form.privacy_season_finds_public === true} onValueChange={(v) => change("privacy_season_finds_public", v)} testID="settings-toggle-season-finds" />
              </AnkerView>
              <AnkerView id="freunde-anmeldungen">
                <Toggle
                  label="Freunde sehen, wo ich angemeldet bin"
                  detail="Deine bestätigten Freunde sehen auf der Event-Seite, bei welchen Events und Turnieren du angemeldet bist. Fremde und Gäste sehen das nie."
                  value={form.privacy_friends_see_registrations !== false}
                  onValueChange={(v) => change("privacy_friends_see_registrations", v)}
                  testID="settings-toggle-friends-registrations"
                />
              </AnkerView>
              <AnkerView id="direktnachrichten" style={styles.card}>
                <Muted>Direktnachrichten</Muted>
                <View style={profileStyles.optionGrid}>
                  {dmOptions.map(([value, label]) => (
                    <Pressable
                      key={value}
                      onPress={() => {
                        if (form.dm_privacy === value) return;
                        selectFeedback();
                        change("dm_privacy", value);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: form.dm_privacy === value }}
                      style={[profileStyles.option, form.dm_privacy === value && profileStyles.optionActive]}
                    >
                      <Muted style={[profileStyles.optionText, form.dm_privacy === value && profileStyles.optionTextActive]}>{label}</Muted>
                    </Pressable>
                  ))}
                </View>
              </AnkerView>
            </Card>
          </AnkerView>
          {saveState}
        </Group>
        {/* Blockierte Benutzer (#414): wie auf der Website unter Datenschutz - die Karte trägt ihre eigene Überschrift. */}
        <AnkerView id="blockiert">
          <BlockedUsersCard style={styles.card} />
        </AnkerView>
        {/* Einwilligungen an einem Ort (#2059): die Bedingungen der Website für alle, die des Vereins für Mitglieder. */}
        <Group id="einwilligungen" title="Einwilligungen" testID="settings-group-consents">
          <AnkerView id="einwilligungen-website">
            <Card style={styles.list}>
              <View style={styles.cardText}>
                <Body style={profileStyles.strong}>Website</Body>
                <Muted>Du hast der Datenschutzerklärung und den Nutzungsbedingungen zugestimmt. Ändert sich eine davon, fragt dich die App beim nächsten Start.</Muted>
              </View>
              <Row icon="shield-outline" label="Datenschutzerklärung lesen" onPress={() => openLink(`${WEB_BASE_URL}/privacy`)} testID="settings-consents-privacy" border external />
              <Row icon="document-text-outline" label="Nutzungsbedingungen lesen" onPress={() => openLink(`${WEB_BASE_URL}/terms`)} testID="settings-consents-terms" border external />
            </Card>
          </AnkerView>
          {/* Die Einwilligungen aus der Mitgliederverwaltung (#1537) - die Karte zeigt nur mit Zuordnung etwas. */}
          {mitglied ? <MemberConsents /> : null}
        </Group>
        <Group id="daten" title="Daten herunterladen">
          <Card style={styles.list}>
            <Row icon="download-outline" label="Daten herunterladen" detail="Auskunft und Export auf der Website" onPress={() => openWebsite("/privacy-account")} testID="settings-data" external />
          </Card>
        </Group>
        <Group id="loeschung" title="Konto löschen">
          <Card style={styles.list}>
            <Row icon="trash-outline" label="Konto löschen" detail="Dauerhaft anonymisieren – wie auf der Website unter Datenschutz." onPress={deleteAccount} tone="danger" testID="settings-delete" />
          </Card>
        </Group>
      </View>
    );
  }

  // Konto & Sicherheit
  return (
    <View style={styles.groups}>
      <Group id="sicherheit" title="Sicherheit" testID="settings-group-security">
        {/* Passwort, Zwei-Faktor und Google ändert die Website (wie im Web unter Konto & Sicherheit). */}
        <AnkerView id="passwort">
          <Card style={styles.list}>
            <Row icon="key-outline" label="Passwort, Zwei-Faktor und Google" detail="Auf der Website ändern – dort meldest du dich mit demselben Konto an." onPress={() => openWebsite(`${BEREICH}/konto#passwort`)} testID="settings-password-web" external />
          </Card>
        </AnkerView>
        <AnkerView id="app-sperre">
          <Card style={styles.card}>
            {/* App-Sperre (#217): Einschalten fragt einmal den Fingerabdruck ab; ohne Gerätesperre bleibt der Schalter aus. */}
            <Toggle first label="App-Sperre mit Fingerabdruck" detail={`${availabilityText(appLock.availability)} Gilt nur auf diesem Gerät.`} value={appLock.enabled} onValueChange={(v) => { void appLock.setEnabled(v); }} testID="settings-toggle-app-lock" />
          </Card>
        </AnkerView>
        {/* Passkeys (#919): dieselben wie auf der Website - anlegen und entfernen mit dem aktuellen Passwort. */}
        <AnkerView id="passkeys">
          <PasskeysCard style={styles.card} />
        </AnkerView>
        <AnkerView id="geraete">
          <SessionsCard />
        </AnkerView>
      </Group>

      <AppearanceGroup />

      <Group id="kalender" title="Kalender" testID="settings-group-calendar">
        <AnkerView id="kalender-abo">
          <Card style={styles.list}>
            {/* Mein Kalender-Abo (#1788): der feste Weg zum persönlichen Link - wie im Web unter Konto & Sicherheit. */}
            <Row icon="calendar-outline" label="Mein Kalender-Abo" detail="Deine Termine automatisch im Handy-Kalender" onPress={() => navigation?.navigate("CalendarSubscription" as never)} testID="settings-calendar-subscription" />
          </Card>
        </AnkerView>
      </Group>

      <AboutGroup />

      <Group id="abmelden-gruppe" title="Abmelden" testID="settings-group-account">
        <AnkerView id="abmelden">
          <Card style={styles.list}>
            <Row icon="log-out-outline" label="Abmelden" detail="Dieses Gerät aus deinem Konto ausloggen." onPress={() => {
              // Ein wartender Schalter geht noch ins richtige Konto, danach wird abgemeldet (#1061).
              void (async () => {
                if (saver.pending) await saver.save();
                await logout();
              })();
            }} tone="danger" testID="settings-logout" />
          </Card>
        </AnkerView>
      </Group>
    </View>
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
            <Body>{session.device || (session.client === "mobile" ? "App" : "Browser")}{session.current ? " · dieses Gerät" : ""}</Body>
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

/** Über die App: Version, „Was ist neu“, FAQ, Datenschutz und Impressum - auch für Gäste. */
function AboutGroup() {
  const navigation = useContext(NavigationContext);
  const openWhatsNew = useOptionalAppUpdate()?.openWhatsNew;
  const version = Constants.expoConfig?.version ?? "?";
  const build = Constants.expoConfig?.android?.versionCode;
  return (
    <Group id="app-info" title="Über die App" testID="settings-group-about">
      <AnkerView id="app-info-liste">
        <Card style={styles.list}>
          <AnkerView id="version">
            <Row icon="information-circle-outline" label="Version" detail={`LionsAPP v${version}${build ? ` · Build ${build}` : ""}`} testID="settings-version" />
          </AnkerView>
          {openWhatsNew ? (
            <AnkerView id="was-ist-neu">
              <Row icon="sparkles-outline" label="Was ist neu" onPress={openWhatsNew} testID="more-whats-new" border />
            </AnkerView>
          ) : null}
          {/* FAQ (#2449): Fragen zu App und Website - wie /faq im Web, dazu der Bereich LionsAPP. */}
          <AnkerView id="faq">
            <Row icon="help-circle-outline" label="FAQ" detail="Häufige Fragen zu App und Website" onPress={() => navigation?.navigate("Faq" as never)} testID="settings-faq" border />
          </AnkerView>
          {/* Fehler melden (#2131 KO9): das Kontaktformular mit Thema, Bildschirm und Version - wie die Fehlerseite im Web. */}
          <AnkerView id="fehler-melden">
            <Row icon="bug-outline" label="Fehler melden" detail="Kontaktformular mit App-Version" onPress={() => openLink(bugReportUrl("einstellungen", Constants.expoConfig?.version))} testID="settings-report-bug" border external />
          </AnkerView>
          <AnkerView id="datenschutzerklaerung">
            <Row icon="shield-outline" label="Datenschutzerklärung" onPress={() => openLink(`${WEB_BASE_URL}/privacy`)} testID="settings-privacy-policy" border external />
          </AnkerView>
          <AnkerView id="impressum">
            <Row icon="document-text-outline" label="Impressum" onPress={() => openLink(`${WEB_BASE_URL}/imprint`)} testID="settings-imprint" border external />
          </AnkerView>
        </Card>
      </AnkerView>
    </Group>
  );
}

function Row({ icon, label, detail, onPress, tone, testID, border = false, external = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail?: string; onPress?: () => void; tone?: "danger"; testID?: string; border?: boolean; external?: boolean }) {
  const color = tone === "danger" ? colors.live : colors.cyan;
  const content = (
    <>
      <Ionicons name={icon} color={color} size={20} />
      <View style={styles.flex}>
        <Body style={[profileStyles.strong, tone === "danger" && styles.danger]}>{label}</Body>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
      {/* Was die Website öffnet, sagt das Zeichen schon vor dem Tipp. */}
      {onPress ? <Ionicons name={external ? "open-outline" : "chevron-forward"} color={colors.muted} size={16} /> : null}
    </>
  );
  if (!onPress) return <View style={[styles.row, border && styles.rowBorder]} testID={testID}>{content}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole={external ? "link" : "button"} style={({ pressed }) => [styles.row, border && styles.rowBorder, pressed && styles.pressed]} testID={testID}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groups: {
    gap: 20,
  },
  group: {
    gap: 8,
  },
  saveState: {
    gap: 4,
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
  cardText: {
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  list: {
    gap: 0,
    padding: 0,
  },
  small: {
    fontSize: 12,
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
  loadFailed: {
    borderColor: "rgba(255,159,10,0.45)",
    borderRadius: 2,
    borderWidth: 1,
    gap: 4,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  loadFailedText: {
    color: "#FF9F0A",
  },
  levelSkeleton: {
    flexDirection: "row",
    gap: 8,
  },
  levelSkeletonCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: colors.border,
    borderRadius: 2,
    borderWidth: 1,
    flex: 1,
    height: 88,
  },
  expand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 48,
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
