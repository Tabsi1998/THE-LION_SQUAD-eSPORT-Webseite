import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { LINKABLE_PLATFORMS, PlatformLinkRows, type LinkedAccount } from "../../components/LinkedAccounts";
import { Screen } from "../../components/Screen";
import { Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { Field, labelFor, profileStyles, setField, Toggle, WEB_BASE_URL } from "./profile/parts";

// Profil bearbeiten (#1146): früher ein Reiter im Profil, jetzt eine eigene Seite - erreichbar über Einstellungen → Konto
// und über „Nur für dich“ im Profil, wenn noch etwas fehlt. Gespeichert wird nur, was hier steht.

const PROFILE_FIELDS = [
  "display_name", "first_name", "last_name", "bio", "country", "city", "avatar_url", "banner_url", "main_platform", "preferred_role", "input_device",
  "discord_name", "twitch_handle", "youtube_handle", "tiktok_handle", "instagram_handle", "x_handle", "steam_id", "epic_id", "psn_id", "xbox_id",
  "nintendo_fc", "ea_id", "riot_id", "battlenet_id", "faceit_handle", "startgg_handle", "roblox_handle", "osu_handle", "lichess_handle",
  "github_handle", "kick_handle", "reddit_handle", "spotify_handle", "threads_handle", "facebook_handle", "linkedin_handle", "snapchat_handle",
  "pinterest_handle", "telegram_handle", "wargaming_handle", "bungie_handle", "mastodon_handle", "bluesky_handle", "website",
] as const;

export function profileEditForm(user: Record<string, any> | null | undefined): Record<string, any> {
  const u = user || {};
  const form: Record<string, any> = {};
  PROFILE_FIELDS.forEach((key) => { form[key] = u[key] || ""; });
  form.nintendo_fc = u.nintendo_fc || u.switch_code || "";
  form.favorite_games = Array.isArray(u.favorite_games) ? u.favorite_games.join(", ") : "";
  // Spiel-Rollen im Discord (#629): Vorgabe an - wie im Web.
  form.discord_game_roles = u.discord_game_roles !== false;
  return form;
}

export function ProfileEditScreen() {
  const { user, refreshMe } = useAuth();
  const [form, setForm] = useState<Record<string, any>>(() => profileEditForm(user as Record<string, any>));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  // Verknüpfte Konten (#459): nur lesen; verknüpfen läuft im Web (Rückruf der Plattform im Browser).
  const [links, setLinks] = useState<LinkedAccount[]>([]);
  // Welche Plattformen die Website eingerichtet hat (#521): nur dort gibt es den Knopf.
  const [linkAvailable, setLinkAvailable] = useState<Record<string, boolean>>({});
  // Abgehakt vom Verein (#558): weder Zeile noch Textfeld.
  const [linkDisabled, setLinkDisabled] = useState<string[]>([]);

  useEffect(() => {
    api.get<{ links?: LinkedAccount[]; available?: Record<string, boolean>; disabled?: string[] }>("/me/platform-links")
      .then(({ data }) => {
        setLinks(Array.isArray(data?.links) ? data.links : []);
        setLinkAvailable(data?.available || {});
        setLinkDisabled(Array.isArray(data?.disabled) ? data.disabled : []);
      })
      .catch(() => {});
  }, []);

  const linkedPlatforms = useMemo(() => new Set(links.map((row) => String(row.platform || "").toLowerCase())), [links]);
  // Getippt wird nur, was keine Anmeldung bietet oder was die Website nicht eingerichtet hat (#521).
  const manualSocialKeys = useMemo(() => {
    const fieldOf: Record<string, string> = { discord: "discord_name", twitch: "twitch_handle", youtube: "youtube_handle", tiktok: "tiktok_handle", x: "x_handle", steam: "steam_id", epic: "epic_id", xbox: "xbox_id", riot: "riot_id", battlenet: "battlenet_id", faceit: "faceit_handle", startgg: "startgg_handle", roblox: "roblox_handle", osu: "osu_handle", lichess: "lichess_handle", github: "github_handle", kick: "kick_handle", reddit: "reddit_handle", spotify: "spotify_handle", threads: "threads_handle", facebook: "facebook_handle", linkedin: "linkedin_handle", snapchat: "snapchat_handle", pinterest: "pinterest_handle", telegram: "telegram_handle", wargaming: "wargaming_handle", bungie: "bungie_handle", mastodon: "mastodon_handle", bluesky: "bluesky_handle" };
    const off = new Set(linkDisabled);
    const manualOf: Record<string, string> = { instagram_handle: "instagram", psn_id: "psn", nintendo_fc: "nintendo", ea_id: "ea" };
    const notReady = LINKABLE_PLATFORMS.filter((platform) => !off.has(platform) && !linkedPlatforms.has(platform) && !linkAvailable[platform]).map((platform) => fieldOf[platform]);
    const manual = ["instagram_handle", "psn_id", "nintendo_fc", "ea_id"].filter((key) => !off.has(manualOf[key]));
    return [...notReady, ...manual, "website"];
  }, [linkAvailable, linkDisabled, linkedPlatforms]);

  const startPlatformLink = useCallback((platform: string) => {
    Linking.openURL(`${WEB_BASE_URL}/profile?tab=socials&link=${encodeURIComponent(platform)}`).catch(() => {});
  }, []);
  const unlinkPlatform = useCallback((platform: string) => {
    Alert.alert("Verknüpfung lösen?", "Der Name bleibt im Profil, das Häkchen „verifiziert“ ist weg.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Lösen", style: "destructive", onPress: () => {
        api.delete(`/me/platform-links/${platform}`)
          .then(() => setLinks((rows) => rows.filter((row) => String(row.platform || "").toLowerCase() !== platform)))
          .catch((err) => Alert.alert("Das hat nicht geklappt", errorMessage(err)));
      } },
    ]);
  }, []);

  const send = useCallback(async (payload: Record<string, unknown>, done: string) => {
    setSaving(true);
    setMessage("");
    try {
      await api.patch("/users/me", payload);
      await refreshMe().catch(() => {});
      setMessage(done);
    } catch (err) {
      setMessage(errorMessage(err, "Profil konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }, [refreshMe]);
  const save = useCallback(() => send({
    ...Object.fromEntries(PROFILE_FIELDS.map((key) => [key, form[key]])),
    discord_game_roles: form.discord_game_roles,
    favorite_games: String(form.favorite_games || "").split(",").map((value) => value.trim()).filter(Boolean),
  }, "Profil gespeichert."), [form, send]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="profile-edit-screen">
        <Card style={profileStyles.card}>
          <Field label="Anzeigename" value={form.display_name} onChangeText={(v) => setField(setForm, "display_name", v)} />
          <Muted>So heißt du überall: im Profil, in Teams, Turnieren und Ranglisten.</Muted>
          <Field label="Vorname" value={form.first_name} onChangeText={(v) => setField(setForm, "first_name", v)} />
          <Field label="Nachname" value={form.last_name} onChangeText={(v) => setField(setForm, "last_name", v)} />
          <Field label="Bio" value={form.bio} multiline onChangeText={(v) => setField(setForm, "bio", v)} />
          <Field label="Land" value={form.country} onChangeText={(v) => setField(setForm, "country", v)} />
          <Field label="Stadt" value={form.city} onChangeText={(v) => setField(setForm, "city", v)} />
          <Field label="Avatar URL" value={form.avatar_url} onChangeText={(v) => setField(setForm, "avatar_url", v)} />
          <Field label="Banner URL" value={form.banner_url} onChangeText={(v) => setField(setForm, "banner_url", v)} />
          <Field label="Lieblingsspiele, getrennt mit Komma" value={form.favorite_games} onChangeText={(v) => setField(setForm, "favorite_games", v)} />
          <Field label="Hauptplattform" value={form.main_platform} onChangeText={(v) => setField(setForm, "main_platform", v)} />
          <Field label="Bevorzugte Rolle" value={form.preferred_role} onChangeText={(v) => setField(setForm, "preferred_role", v)} />
          <Field label="Eingabegerät" value={form.input_device} onChangeText={(v) => setField(setForm, "input_device", v)} />
        </Card>
        <Card style={profileStyles.card}>
          <Heading>Konten</Heading>
          <Muted>Verknüpfen läuft im Browser: die Plattform bestätigt dein Konto, der Name kommt von dort. Wer welches Konto sieht, regelst du in den Einstellungen unter Privatsphäre.</Muted>
          <PlatformLinkRows links={links} available={linkAvailable} disabled={linkDisabled} onLink={startPlatformLink} onUnlink={unlinkPlatform} />
          {/* Spiel-Rollen im Discord (#629): wie im Web nur mit verknüpftem Discord; der Schalter speichert sofort. */}
          {linkedPlatforms.has("discord") ? (
            <Toggle
              label="Spiel-Rollen im Discord"
              detail="Mit Spielprofil (Spieler-ID) oder Team-Kader gibt dir der Bot die passende Rolle, etwa „CoD-Spieler“ – auf dem Server des Spiels und am Hauptserver. Aus: keine Spiel-Rollen; Vereinsrollen wie „Mitglied“ bleiben."
              value={form.discord_game_roles !== false}
              onValueChange={(v) => { setField(setForm, "discord_game_roles", v); void send({ discord_game_roles: v }, "Gespeichert."); }}
            />
          ) : null}
          <Muted>Von Hand – diese Plattformen bieten keine Anmeldung:</Muted>
          {manualSocialKeys.map((key) => (
            <Field key={key} label={labelFor(key)} value={form[key]} onChangeText={(v) => setField(setForm, key, v)} />
          ))}
        </Card>
        {message ? <Muted style={message.includes("konnte") ? profileStyles.error : profileStyles.success} testID="profile-edit-message">{message}</Muted> : null}
        <Button label={saving ? "Speichert ..." : "Profil speichern"} onPress={() => { void save(); }} disabled={saving} testID="profile-edit-save" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 18,
    paddingBottom: 36,
  },
});
