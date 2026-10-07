import React from "react";
import { Pressable, StyleSheet, Switch, TextInput, View } from "react-native";
import { Card } from "../../../components/Card";
import { Body, Muted } from "../../../components/Text";
import { API_BASE_URL } from "../../../config";
import { formatDate, formatStatus } from "../../../lib/format";
import { prizeKindLabel, prizeKindMark, prizePlaceText, prizeSourceLabel, prizeTarget } from "../../../lib/prizes";
import { colors } from "../../../theme";
import type { PersonalReferenceItem, PrizePickup } from "../../../types";

// Bausteine des Profils (#1149, #1146): früher alle in ProfileScreen.tsx. Das eigene Profil, die Einstellungen, „Profil
// bearbeiten“ und „Meine Gewinne“ nutzen dieselben Zeilen, Schalter und Karten.

// Der eigene Stand bei der Moderation (#416): nur lesen; Einspruch und Verlauf liegen im Web.
export type ModerationStanding = {
  strike_count: number;
  strike_ttl_months: number;
  active: null | { action: string; label: string; reason?: string | null; chat_blocked_until?: string | null; open_until_decision?: boolean; created_at?: string };
};
export const WEB_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

export const notificationChannels: Array<{ key: string; label: string; detail: string }> = [
  { key: "email", label: "E-Mail", detail: "Nur wichtige optionale Hinweise per Mail." },
  { key: "push", label: "Push", detail: "System-Benachrichtigungen am Handy." },
  { key: "in_app", label: "In-App", detail: "Hinweise in App, Web und Notification-Center." },
  // Discord als Kanal (#567): Direktnachricht vom Vereins-Bot, nur mit verknüpftem Konto - Standard aus.
  { key: "discord", label: "Discord", detail: "Direktnachricht vom Vereins-Bot – nur mit verknüpftem Discord-Konto." },
];

export type DiscordDmState = { linked?: boolean; blocked_at?: string | null; hint?: string | null };

export const notificationLabels: Array<{ key: string; label: string; detail: string; channels?: string[] }> = [
  { key: "match_reminders", label: "Spiel-Erinnerungen", detail: "Startzeiten, Check-in und Match-Hub." },
  { key: "tournament_updates", label: "Turnier-Updates", detail: "Anmeldungen, Status und Ergebnisse." },
  { key: "prize_updates", label: "Gewinne", detail: "Gewinn bereit, Übergabe und Fristen." },
  // Erfolge (#568): In-App, Push und Discord - eine Mail dafür gibt es nicht.
  { key: "achievements", label: "Erfolge", detail: "Freigeschaltete Erfolge – als Gratulation.", channels: ["in_app", "push", "discord"] },
  // Wochenrückblick (#622): nur per E-Mail, montags, nur bei Aktivität.
  { key: "achievement_recap", label: "Wochenrückblick", detail: "Montags eine Mail mit XP, Level und neuen Erfolgen.", channels: ["email"] },
  // Rechnungen (#841): Postfach, Push und Mail - Beträge nie über Discord.
  { key: "billing_updates", label: "Rechnungen", detail: "Neue Rechnung mit Betrag, Zahlungsziel und Link zum PDF.", channels: ["in_app", "push", "email"] },
  { key: "membership_updates", label: "Mitgliedschaft", detail: "Bewerbung, Status und Vereinsvorteile." },
  { key: "birthday_greetings", label: "Geburtstag", detail: "Geburtstagsgruß vom Verein." },
  { key: "community_messages", label: "Community", detail: "Direktnachrichten und Erwähnungen." },
  { key: "news_events", label: "News & Events", detail: "Vereinsnews, Events und Ankündigungen." },
  { key: "club_internal", label: "Vereinsintern", detail: "Interne Events und News nur für Mitglieder." },
];
export const notificationPreferenceKey = (channel: string, topic: string) => `${channel}:${topic}`;

export const dmOptions = [
  ["everyone", "Alle"],
  ["friends", "Freunde"],
  ["team_members", "Team"],
  ["club_members", "Verein"],
  ["admins_only", "Admins"],
  ["none", "Niemand"],
];



export function setField(setForm: React.Dispatch<React.SetStateAction<Record<string, any>>>, key: string, value: any) {
  setForm((current) => ({ ...current, [key]: value }));
}

export function labelFor(key: string) {
  return key
    .replace("_handle", "")
    .replace("_id", " ID")
    .replace("discord_name", "Discord")
    .replace("nintendo_fc", "Nintendo Friend Code")
    .replace("battlenet", "Battle.net")
    .replace("faceit", "FACEIT")
    .replace("startgg", "start.gg")
    .replace("osu", "osu!")
    .replace("github", "GitHub")
    .replace("linkedin", "LinkedIn")
    .replace("wargaming", "Wargaming.net")
    .replace("bungie", "Bungie.net")
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

export function Field({ label, value, onChangeText, multiline = false }: { label: string; value?: string; onChangeText: (value: string) => void; multiline?: boolean }) {
  return (
    <View style={profileStyles.field}>
      <Muted style={profileStyles.fieldLabel}>{label}</Muted>
      <TextInput
        value={value || ""}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholderTextColor={colors.muted}
        style={[profileStyles.input, multiline && profileStyles.inputMulti]}
        autoCapitalize="none"
      />
    </View>
  );
}

export function Toggle({ label, detail, value, onValueChange }: { label: string; detail: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={profileStyles.toggleRow}>
      <View style={profileStyles.toggleText}>
        <Body style={profileStyles.strong}>{label}</Body>
        <Muted>{detail}</Muted>
      </View>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} trackColor={{ false: "rgba(255,255,255,0.16)", true: "rgba(41,182,232,0.45)" }} thumbColor={value ? colors.cyan : colors.muted} />
    </View>
  );
}

export function MatrixToggle({ label, value, disabled, onValueChange }: { label: string; value: boolean; disabled?: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={[profileStyles.matrixToggle, value && profileStyles.matrixToggleActive, disabled && profileStyles.matrixToggleDisabled]}>
      <Muted style={[profileStyles.matrixLabel, value && profileStyles.matrixLabelActive]}>{label}</Muted>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: "rgba(255,255,255,0.16)", true: "rgba(41,182,232,0.45)" }}
        thumbColor={value ? colors.cyan : colors.muted}
      />
    </View>
  );
}

export function ReferenceCard({ item, onOpen }: { item: PersonalReferenceItem; onOpen?: (item: PersonalReferenceItem) => void }) {
  const isFastlap = item.kind === "fastlap";
  const isSeason = item.kind === "season";
  const content = (
    <Card style={profileStyles.referenceCard}>
      <View style={profileStyles.referenceTop}>
        <View style={[profileStyles.referenceIcon, isFastlap || isSeason ? profileStyles.referenceIconFastlap : profileStyles.referenceIconTournament]}>
          <Body style={profileStyles.referenceIconText}>{isFastlap ? "FL" : isSeason ? "JW" : "T"}</Body>
        </View>
        <View style={profileStyles.referenceText}>
          <Body style={profileStyles.strong}>{item.title}</Body>
          <Muted>{item.subtitle || (isFastlap ? "Fast Lap" : isSeason ? "Jahreswertung" : "Turnier")}</Muted>
          <Muted>{formatDate(item.date)} · {formatStatus(item.status)}</Muted>
        </View>
        <View style={profileStyles.referenceRank}>
          <Body style={[profileStyles.referenceRankText, Number(item.rank || 0) <= 3 && item.rank ? profileStyles.gold : null]}>
            {item.rank ? `#${item.rank}` : "-"}
          </Body>
          <Muted>{item.participant_count ? `von ${item.participant_count}` : "Rang"}</Muted>
        </View>
      </View>
      <View style={profileStyles.referenceMeta}>
        {item.time_str ? <Pill label={item.time_str} tone="cyan" /> : null}
        {isSeason && item.points != null ? <Pill label={`${item.points} Jahrespunkte`} tone="gold" /> : null}
        <Pill label={isFastlap ? "Fast Lap" : isSeason ? "Jahreswertung" : "Turnier"} />
      </View>
    </Card>
  );
  if (!item.target_id || !onOpen) return content;
  return (
    <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [pressed && profileStyles.pressed]}>
      {content}
    </Pressable>
  );
}

export function PrizeCard({ item, onOpen }: { item: PrizePickup; onOpen?: (item: PrizePickup) => void }) {
  const target = prizeTarget(item);
  const isFastlap = target.kind === "fastlap";
  const status = String(item.status || "pending");
  const isReady = status === "ready";
  const sourceTitle = item.fastlap_challenge_title || item.tournament_title || "Gewinn";
  const prizeText = item.prize_value || item.prize_label || "Preis";
  const deadline = item.pickup_deadline ? formatDate(item.pickup_deadline) : "";
  const pickedUp = item.picked_up_at ? formatDate(item.picked_up_at) : "";
  const overdue = item.pickup_deadline ? Date.parse(item.pickup_deadline) < Date.now() && status !== "picked_up" : false;
  const content = (
    <Card style={[profileStyles.referenceCard, isReady && { borderColor: "rgba(240, 180, 41, 0.48)" }, overdue && { borderColor: "rgba(255, 65, 84, 0.56)" }]}>
      <View style={profileStyles.referenceTop}>
        <View style={[profileStyles.referenceIcon, isFastlap ? profileStyles.referenceIconFastlap : profileStyles.referenceIconTournament]}>
          <Body style={profileStyles.referenceIconText}>{prizeKindMark(target.kind)}</Body>
        </View>
        <View style={profileStyles.referenceText}>
          <Body style={profileStyles.strong}>{prizeText}</Body>
          <Muted>{sourceTitle}</Muted>
          <Muted>{prizeSourceLabel(item)} - {formatStatus(status)}</Muted>
        </View>
        <View style={profileStyles.referenceRank}>
          <Body style={[profileStyles.referenceRankText, profileStyles.gold]}>{prizePlaceText(item)}</Body>
          <Muted>{item.recipient_type === "team" ? item.recipient_label || "Team" : "Du"}</Muted>
        </View>
      </View>
      <View style={profileStyles.referenceMeta}>
        {isReady ? <Pill label="Bereit" tone="gold" /> : null}
        {deadline ? <Pill label={`Frist ${deadline}`} tone={overdue ? "gold" : "default"} /> : null}
        {pickedUp ? <Pill label={`Abgeholt ${pickedUp}`} tone="success" /> : null}
        {item.fastlap_track_name ? <Pill label={item.fastlap_track_name} tone="cyan" /> : null}
        <Pill label={prizeKindLabel(target.kind)} />
      </View>
    </Card>
  );
  if (!target.id || !onOpen) return content;
  return (
    <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [pressed && profileStyles.pressed]}>
      {content}
    </Pressable>
  );
}

export function ProgressBar({ value, color }: { value: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <View style={profileStyles.progress}>
      <View style={[profileStyles.progressFill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Stat({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={profileStyles.stat}>
      {/* Ein Wert bleibt eine Zeile: "Superadmin" brach vorher als "Superad/min" (#247). */}
      <Body style={[profileStyles.statValue, tone === "gold" && profileStyles.gold]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Body>
      <Muted numberOfLines={1}>{label}</Muted>
    </View>
  );
}

export function Pill({ label, tone = "default" }: { label: string; tone?: "default" | "cyan" | "gold" | "success" }) {
  const toneStyle = tone === "cyan" ? profileStyles.pillCyan : tone === "gold" ? profileStyles.pillGold : tone === "success" ? profileStyles.pillSuccess : null;
  const textStyle = tone === "cyan" ? profileStyles.textCyan : tone === "gold" ? profileStyles.textGold : tone === "success" ? profileStyles.textSuccess : null;
  return (
    <View style={[profileStyles.pill, toneStyle]}>
      <Muted style={[profileStyles.pillText, textStyle]}>{label}</Muted>
    </View>
  );
}

export function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={profileStyles.info}>
      <Muted>{label}</Muted>
      <Body style={profileStyles.infoValue}>{value || "-"}</Body>
    </View>
  );
}

export const profileStyles = StyleSheet.create({
  guestWrap: {
    flex: 1,
    gap: 14,
    justifyContent: "center",
  },
  guestIcon: {
    alignItems: "center",
  },
  guestTitle: {
    textAlign: "center",
  },
  guestText: {
    marginBottom: 8,
    textAlign: "center",
  },
  awardList: {
    gap: 10,
  },
  awardAction: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  awardActionText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  content: {
    padding: 18,
    gap: 16,
    paddingBottom: 32,
  },
  profileHero: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 220,
    overflow: "hidden",
  },
  bannerImage: {
    height: 220,
    width: "100%",
  },
  bannerFallback: {
    backgroundColor: "#101113",
    height: 220,
  },
  heroOverlay: {
    backgroundColor: "rgba(0,0,0,0.42)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  identity: {
    bottom: 16,
    flexDirection: "row",
    gap: 14,
    left: 16,
    position: "absolute",
    right: 16,
  },
  avatarFrame: {
    alignItems: "center",
    backgroundColor: colors.black,
    borderColor: colors.cyan,
    borderRadius: 12,
    borderWidth: 2,
    height: 78,
    justifyContent: "center",
    overflow: "hidden",
    width: 78,
  },
  avatarImage: {
    height: "100%",
    width: "100%",
  },
  avatarInitial: {
    color: colors.cyan,
    fontSize: 30,
    fontWeight: "900",
  },
  identityText: {
    flex: 1,
    gap: 5,
    justifyContent: "flex-end",
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillCyan: {
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderColor: "rgba(41, 182, 232, 0.35)",
  },
  pillGold: {
    backgroundColor: "rgba(255, 215, 0, 0.12)",
    borderColor: "rgba(255, 215, 0, 0.32)",
  },
  pillSuccess: {
    backgroundColor: "rgba(0, 255, 136, 0.12)",
    borderColor: "rgba(0, 255, 136, 0.32)",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "900",
  },
  textCyan: { color: colors.cyan },
  textGold: { color: colors.gold },
  textSuccess: { color: colors.success },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tabs: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
  },
  backRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 38,
  },
  backText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  tab: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    // Vier gleich breite Reiter in einer Zeile; vorher rutschte "Erfolge"
    // allein in eine zweite Zeile (#247).
    flex: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(41, 182, 232, 0.16)",
    borderColor: "rgba(41, 182, 232, 0.42)",
  },
  tabText: {
    flexShrink: 1,
    fontWeight: "900",
    textAlign: "center",
  },
  tabTextActive: {
    color: colors.cyan,
  },
  card: {
    gap: 12,
  },
  cardTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statGrid: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
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
  strong: {
    fontWeight: "900",
  },
  sectionText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  warningText: {
    color: colors.gold,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    fontWeight: "800",
  },
  input: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    color: colors.white,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputMulti: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  toggleRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 14,
    paddingTop: 12,
  },
  toggleText: {
    flex: 1,
    gap: 3,
  },
  notificationTopic: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 12,
  },
  notificationMatrix: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  matrixToggle: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexBasis: "31%",
    flexDirection: "row",
    flexGrow: 1,
    justifyContent: "space-between",
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  matrixToggleActive: {
    backgroundColor: "rgba(41,182,232,0.12)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  matrixToggleDisabled: {
    opacity: 0.45,
  },
  matrixLabel: {
    fontSize: 12,
    fontWeight: "900",
  },
  matrixLabelActive: {
    color: colors.cyan,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  option: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  optionActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  optionText: {
    fontWeight: "900",
  },
  optionTextActive: {
    color: colors.cyan,
  },
  smallAction: {
    borderColor: "rgba(41,182,232,0.38)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  smallActionText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  tabContent: { gap: 16 },
  nextAchievement: { flexDirection: "row", alignItems: "center", gap: 8 },
  referenceCard: {
    gap: 10,
  },
  referenceTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  referenceIcon: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  referenceIconTournament: {
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderColor: "rgba(41, 182, 232, 0.38)",
  },
  referenceIconFastlap: {
    backgroundColor: "rgba(240, 180, 41, 0.14)",
    borderColor: "rgba(240, 180, 41, 0.38)",
  },
  referenceIconText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  referenceText: {
    flex: 1,
    gap: 2,
  },
  referenceRank: {
    alignItems: "flex-end",
    minWidth: 58,
  },
  referenceRankText: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  referenceMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pressed: {
    opacity: 0.72,
  },
  progress: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 3,
    height: 6,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
  },
  error: {
    color: colors.live,
    fontWeight: "800",
  },
  success: {
    color: colors.success,
    fontWeight: "800",
  },
});
