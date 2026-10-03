import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Card } from "../../components/Card";
import { announceLevelChanged } from "../../lib/achievements";
import { api, errorMessage } from "../../lib/api";
import { colors, radius } from "../../theme";
import { Badge } from "../Badge";
import { materialColor, materialName } from "../badgeArt";
import { type AchievementLevel, type CategoryRow, MATERIAL_OPTIONS, MAX_PINS, type NextUpItem, type PinnedAward, movePin, prestigeUndoUntil } from "./model";

// Die Bausteine des Erfolge-Reiters im App-Profil (E13, #623) - wie im Web (#619): Kopf mit Level, Titel, Sternen und
// XP-Leiste samt Prestige, Zahlen, „Als Nächstes“, Angeheftete, Vitrinen je Kategorie, Material-Filter und die
// „?“-Karte der geheimen Erfolge.

const PURPLE = "#A855F7";
const LIGHT_PURPLE = "#c084fc";

function Kicker({ children, color }: { children: React.ReactNode; color: string }) {
  return <Text style={[styles.kicker, { color }]}>{children}</Text>;
}

function Bar({ percent, color, height = 6 }: { percent: number; color: string; height?: number }) {
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <View style={{ width: `${value}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

function Ring({ percent, size = 56 }: { percent: number; size?: number }) {
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  const r = 16;
  const length = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${value} Prozent freigeschaltet`}>
      <Svg width={size} height={size} viewBox="0 0 36 36" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={18} cy={18} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
        <Circle cx={18} cy={18} r={r} fill="none" stroke={PURPLE} strokeWidth={3} strokeDasharray={`${(value / 100) * length} ${length}`} strokeLinecap="round" />
      </Svg>
      <View style={styles.ringLabel}>
        <Text style={styles.ringText}>{value}%</Text>
      </View>
    </View>
  );
}

/** Kopf: Level-Stand aus dem XP-System (#617) - Level 1–60, Titel, Sterne für Prestige, XP bis zum nächsten Level. */
export function LevelHeader({ level, earnedPercent, evaluating, onEvaluate, onLevelChange, guest = false }: {
  level?: AchievementLevel | null;
  earnedPercent: number;
  evaluating?: boolean;
  onEvaluate?: () => void;
  onLevelChange?: (level: AchievementLevel) => void;
  guest?: boolean;
}) {
  const lvl = level || {};
  const stars = Math.min(5, Number(lvl.prestige || 0));
  const xp = Number(lvl.xp ?? lvl.points ?? 0);
  const next = Number(lvl.next_level_xp ?? lvl.next_level_points ?? 0);
  const atMax = Number(lvl.level || 0) >= Number(lvl.max_level || 60);
  return (
    <Card style={styles.card} testID="achievement-level-header">
      <View style={styles.headRow}>
        <Ring percent={earnedPercent} />
        <View style={styles.flex}>
          <Kicker color={PURPLE}>Account-Level & Erfolge</Kicker>
          <Text style={styles.title}>Deine Erfolge</Text>
          {lvl.title ? (
            <View style={styles.levelRow}>
              <Text style={styles.levelTitle} testID="achievement-level-title">Level {lvl.level} · {lvl.title}</Text>
              {stars > 0 ? (
                <View style={styles.stars} testID="achievement-prestige" accessibilityLabel={`Prestige ${lvl.prestige}`}>
                  {Array.from({ length: stars }, (_, i) => <Ionicons key={i} name="star" size={11} color={colors.gold} />)}
                </View>
              ) : null}
            </View>
          ) : null}
          {lvl.next_title_at && Number(lvl.level || 0) < Number(lvl.next_title_at) ? (
            <Text style={styles.muted}>Nächster Titel ab Level {lvl.next_title_at}.</Text>
          ) : null}
        </View>
      </View>
      {lvl.level ? (
        <View style={styles.xpBlock} testID="achievement-level-xp">
          <View style={styles.xpLabels}>
            <Text style={[styles.xpTitle, { color: PURPLE }]} numberOfLines={1}>{atMax ? "Höchstes Level" : `Bis Level ${Number(lvl.level) + 1}`}</Text>
            <Text style={styles.xpCount}>
              {atMax ? `${xp.toLocaleString("de-DE")} XP` : `${xp.toLocaleString("de-DE")} / ${next.toLocaleString("de-DE")} XP`}
            </Text>
          </View>
          <Bar percent={Number(lvl.progress || 0)} color={PURPLE} height={8} />
        </View>
      ) : null}
      {onEvaluate && !guest ? (
        <Pressable onPress={onEvaluate} disabled={evaluating} style={[styles.outlineButton, evaluating && styles.dim]} accessibilityRole="button" testID="profile-achievements-evaluate">
          <Ionicons name="refresh" size={14} color={LIGHT_PURPLE} />
          <Text style={[styles.outlineButtonText, { color: LIGHT_PURPLE }]}>{evaluating ? "Rechnet …" : "Aktualisieren"}</Text>
        </Pressable>
      ) : null}
      {onLevelChange && !guest ? <PrestigePanel level={lvl} onLevelChange={onLevelChange} /> : null}
    </Card>
  );
}

function confirm(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/**
 * Prestige (#617): ab Level 60 freiwillig - ein Stern, Level zurück auf 1, Erfolge und Punkte bleiben, jeder Stern
 * macht den Weg zu Level 60 ein Viertel länger. Nie ohne Bestätigung; 24 Stunden lang lässt es sich zurücknehmen
 * (XP aus dieser Zeit bleiben). Danach sieht die Level-Erkennung gleich nach - ein neuer Stern bekommt seine Zeremonie.
 */
export function PrestigePanel({ level, onLevelChange }: { level: AchievementLevel; onLevelChange: (level: AchievementLevel) => void }) {
  const [busy, setBusy] = useState(false);
  const stars = Number(level.prestige || 0);
  const undoUntil = prestigeUndoUntil(level);
  if (!level.prestige_available && !undoUntil) return null;

  const run = async (path: string, done: [string, string] | null) => {
    setBusy(true);
    try {
      const { data } = await api.post<AchievementLevel>(path);
      onLevelChange(data);
      announceLevelChanged();
      if (done) Alert.alert(done[0], done[1]);
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Bitte später noch einmal versuchen."));
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    const ok = await confirm(
      `${stars + 1}. Prestige-Stern?`,
      "Dein Level geht zurück auf 1, dafür bekommst du einen Stern (höchstens fünf). Alle Erfolge und Punkte bleiben. Jeder Stern macht den Weg zu Level 60 ein Viertel länger. 24 Stunden lang kannst du es zurücknehmen.",
      "Prestige starten",
    );
    if (ok) await run("/users/me/prestige", null);
  };
  const undo = async () => {
    const ok = await confirm("Prestige zurücknehmen?", "Der letzte Stern geht wieder weg, Level und XP kommen zurück – samt allem, was du seitdem gesammelt hast.", "Zurücknehmen");
    if (ok) await run("/users/me/prestige/undo", ["Prestige zurückgenommen", "Level und XP sind wieder da."]);
  };
  const untilText = undoUntil?.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <View style={styles.prestige} testID="achievement-prestige-panel">
      <Ionicons name="star" size={16} color={colors.gold} />
      <Text style={styles.prestigeText}>
        {undoUntil
          ? `${stars}. Prestige-Stern – bis ${untilText} Uhr kannst du ihn zurücknehmen.`
          : "Level 60 erreicht. Mit Prestige startest du bei Level 1 neu und bekommst einen Stern – alle Erfolge bleiben."}
      </Text>
      {undoUntil ? (
        <Pressable onPress={undo} disabled={busy} style={[styles.outlineButton, styles.prestigeButton, busy && styles.dim]} accessibilityRole="button" testID="achievement-prestige-undo">
          <Ionicons name="arrow-undo" size={14} color={colors.white} />
          <Text style={styles.outlineButtonText}>Zurücknehmen</Text>
        </Pressable>
      ) : (
        <Pressable onPress={start} disabled={busy} style={[styles.goldButton, busy && styles.dim]} accessibilityRole="button" testID="achievement-prestige-start">
          <Ionicons name="star" size={14} color={colors.black} />
          <Text style={styles.goldButtonText}>Prestige starten</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Öffentlich oder privat - mit dem Weg zum Schalter in den Einstellungen. */
export function VisibilityNote({ isPublic, onChange }: { isPublic: boolean; onChange?: () => void }) {
  return (
    <View style={[styles.note, !isPublic && styles.notePrivate]} testID="achievement-visibility-note">
      <Ionicons name={isPublic ? "eye-outline" : "eye-off-outline"} size={15} color={isPublic ? colors.muted : colors.gold} />
      <Text style={[styles.noteText, !isPublic && { color: colors.gold }]}>
        {isPublic
          ? "Deine Erfolge sind öffentlich: Angeheftete und erreichte Stufen stehen in deinem Profil, die Verein-Kategorie sehen nur Mitglieder."
          : "Deine Erfolge sind privat: andere sehen weder Angeheftete noch Stufen, und du stehst auf keiner Rangliste."}
      </Text>
      {onChange ? (
        <Pressable onPress={onChange} hitSlop={8} accessibilityRole="button" testID="achievement-visibility-change">
          <Text style={[styles.link, !isPublic && { color: colors.gold }]}>Ändern</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function StatTile({ icon, label, value, color, testID }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string; color: string; testID?: string }) {
  return (
    <View style={styles.statTile} testID={testID}>
      <View style={styles.statHead}>
        <Ionicons name={icon} size={12} color={color} />
        <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
    </View>
  );
}

export function StatsRow({ earned, total, points, hidden, profileScore }: { earned: number; total: number; points: number; hidden?: { total?: number; earned?: number } | null; profileScore: number }) {
  return (
    <View style={styles.statGrid} testID="achievement-stats-row">
      <StatTile icon="medal-outline" label="Freigeschaltet" value={`${earned}/${total}`} color={colors.gold} />
      <StatTile icon="sparkles-outline" label="Punkte" value={points.toLocaleString("de-DE")} color={PURPLE} />
      <StatTile icon="help-circle-outline" label="Geheim gefunden" value={hidden ? `${Number(hidden.earned || 0)}/${Number(hidden.total || 0)}` : "–"} color={LIGHT_PURPLE} testID="achievement-stat-hidden" />
      <StatTile icon="person-outline" label="Profilpflege" value={`${profileScore}%`} color={colors.cyan} />
    </View>
  );
}

function MaterialChip({ tier }: { tier: { material?: string | null; material_name?: string | null; level?: number | null; level_name?: string | null } }) {
  const color = materialColor(tier);
  return (
    <View style={[styles.chip, { borderColor: `${color}66`, backgroundColor: `${color}14` }]}>
      <Text style={[styles.chipText, { color }]}>{materialName(tier)}</Text>
    </View>
  );
}

/** „Als Nächstes“: die drei Stufen, die dem Ziel am nächsten sind - vom Backend nach Prozent sortiert. */
export function NextUpPanel({ items, canOpen, onOpen }: { items: NextUpItem[]; canOpen: (link: string) => boolean; onOpen: (link: string) => void }) {
  return (
    <Card style={styles.card} testID="achievement-next-up">
      <View style={styles.panelHead}>
        <View style={styles.flex}>
          <Kicker color={colors.success}>Als Nächstes</Kicker>
          <Text style={styles.panelTitle}>Was dem Ziel am nächsten ist</Text>
        </View>
        <Ionicons name="locate-outline" size={20} color={colors.success} />
      </View>
      {items.length ? (
        items.slice(0, 3).map((tier) => {
          const accent = tier.group_accent || colors.cyan;
          const percent = Math.max(0, Math.min(100, Number(tier.percent || 0)));
          const link = tier.link && canOpen(tier.link) ? tier.link : null;
          return (
            <View key={tier.code} style={styles.nextItem} testID={`next-achievement-${tier.code}`}>
              <View style={styles.headRow}>
                <Badge material={tier.material} level={tier.level} rank={tier.rank} art={tier.art} icon={tier.icon || tier.group_icon} earned={false} percent={percent} size={48} />
                <View style={styles.flex}>
                  <Text style={[styles.kicker, { color: accent }]} numberOfLines={1}>{tier.group_name}</Text>
                  <Text style={styles.name} numberOfLines={2}>{tier.name}</Text>
                  <View style={styles.chipRow}>
                    <MaterialChip tier={tier} />
                    <Text style={styles.points}>+{Number(tier.points || 0)}</Text>
                    {tier.member_only ? <Text style={[styles.points, { color: colors.gold }]}>Verein</Text> : null}
                  </View>
                </View>
              </View>
              <View style={styles.progressRow}>
                <View style={styles.flex}><Bar percent={percent} color={accent} /></View>
                <Text style={styles.count}>{Number(tier.current || 0).toLocaleString("de-DE")}/{Number(tier.target || 0).toLocaleString("de-DE")}</Text>
              </View>
              <Text style={styles.howToLabel}>So schaffst du es</Text>
              <Text style={styles.howTo}>
                {tier.how_to || tier.description}{tier.missing ? ` Noch ${Number(tier.missing).toLocaleString("de-DE")}.` : ""}
              </Text>
              {link ? (
                <Pressable onPress={() => onOpen(link)} hitSlop={8} style={styles.linkRow} accessibilityRole="link" testID={`next-achievement-link-${tier.code}`}>
                  <Text style={[styles.link, { color: accent }]}>Dorthin</Text>
                  <Ionicons name="arrow-forward" size={12} color={accent} />
                </Pressable>
              ) : null}
            </View>
          );
        })
      ) : (
        <Text style={styles.empty}>Keine messbaren offenen Ziele – alles erreicht oder nur noch von Hand vergeben.</Text>
      )}
    </Card>
  );
}

/**
 * Angeheftet: bis zu sechs eigene Vergaben. Im Web per Ziehen sortiert, hier mit Pfeilen (zuverlässig auch mit
 * TalkBack); Lösen sofort.
 */
export function PinnedPanel({ pinned, codes, busy, onChange }: { pinned: PinnedAward[]; codes: string[]; busy?: boolean; onChange: (codes: string[]) => void }) {
  const byCode = Object.fromEntries(pinned.map((award) => [award.code, award]));
  const items = codes.filter((code) => byCode[code]);
  const free = Math.max(MAX_PINS - items.length, 0);
  const move = (code: string, delta: -1 | 1) => {
    const next = movePin(items, code, delta);
    if (next !== items) onChange(next);
  };
  return (
    <Card style={styles.card} testID="achievement-pinned">
      <View style={styles.panelHead}>
        <View style={styles.flex}>
          <Kicker color={colors.gold}>Angeheftet</Kicker>
          <Text style={styles.panelTitle}>Was dein Profil zuerst zeigt</Text>
        </View>
        <Text style={styles.count} testID="achievement-pinned-count">{items.length} von {MAX_PINS}</Text>
      </View>
      {items.map((code, index) => {
        const award = byCode[code];
        const color = materialColor(award);
        return (
          <View key={code} style={[styles.pinnedRow, { borderColor: `${color}55` }]} testID={`pinned-award-${code}`}>
            <Badge material={award.material} level={award.level} rank={award.rank} art={award.art} icon={award.icon || award.group_icon} size={40} />
            <View style={styles.flex}>
              <Text style={[styles.kicker, { color }]} numberOfLines={1}>{materialName(award)}</Text>
              <Text style={styles.name} numberOfLines={1}>{award.name}</Text>
              {award.group_name ? <Text style={styles.muted} numberOfLines={1}>{award.group_name}</Text> : null}
            </View>
            <View style={styles.pinTools}>
              <Pressable onPress={() => move(code, -1)} disabled={busy || index === 0} hitSlop={6} style={[styles.iconButton, (busy || index === 0) && styles.dim]} accessibilityRole="button" accessibilityLabel={`${award.name} nach vorn`} testID={`pinned-up-${code}`}>
                <Ionicons name="chevron-up" size={16} color={colors.muted} />
              </Pressable>
              <Pressable onPress={() => move(code, 1)} disabled={busy || index === items.length - 1} hitSlop={6} style={[styles.iconButton, (busy || index === items.length - 1) && styles.dim]} accessibilityRole="button" accessibilityLabel={`${award.name} nach hinten`} testID={`pinned-down-${code}`}>
                <Ionicons name="chevron-down" size={16} color={colors.muted} />
              </Pressable>
              <Pressable onPress={() => onChange(items.filter((item) => item !== code))} disabled={busy} hitSlop={6} style={[styles.iconButton, busy && styles.dim]} accessibilityRole="button" accessibilityLabel={`${award.name} lösen`} testID={`pinned-remove-${code}`}>
                <Ionicons name="close" size={16} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        );
      })}
      {free > 0 ? (
        <View style={styles.hint} testID="achievement-pinned-hint">
          <Ionicons name="pin-outline" size={12} color={colors.muted} />
          <Text style={styles.hintText}>
            {items.length ? `Noch ${free} ${free === 1 ? "Platz" : "Plätze"} frei` : "Bis zu sechs Erfolge anheften"} – unten an jeder erreichten Stufe über „Anheften“. Die Reihenfolge hier ist die im öffentlichen Profil; die Pfeile sortieren.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** Kategorien als Vitrinen: „Spielen 41 von 104“ - Tippen filtert die Liste darunter. */
export function CategoryShowcase({ rows, active, onPick }: { rows: CategoryRow[]; active: string | null; onPick: (key: string | null) => void }) {
  if (!rows.length) return null;
  return (
    <Card style={styles.card} testID="achievement-showcase">
      <View style={styles.panelHead}>
        <View style={styles.flex}>
          <Kicker color={colors.cyan}>Vitrinen</Kicker>
          <Text style={styles.panelTitle}>Je Kategorie</Text>
        </View>
        {active ? (
          <Pressable onPress={() => onPick(null)} hitSlop={8} accessibilityRole="button" testID="achievement-showcase-clear">
            <Text style={styles.link}>Alle Kategorien</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.showcaseGrid}>
        {rows.map((row) => {
          const percent = row.total ? Math.round((row.earned / row.total) * 100) : 0;
          const selected = active === row.key;
          return (
            <Pressable
              key={row.key}
              onPress={() => onPick(selected ? null : row.key)}
              style={[styles.showcaseCell, selected && styles.showcaseCellOn]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${row.label}, ${row.earned} von ${row.total}`}
              testID={`achievement-showcase-${row.key}`}
            >
              <View style={styles.showcaseHead}>
                <Ionicons name={row.icon} size={13} color={row.accent} />
                <Text style={styles.showcaseLabel} numberOfLines={2}>{row.label}</Text>
              </View>
              <Text style={styles.count}>{row.earned} von {row.total}</Text>
              <Bar percent={percent} color={row.accent} height={4} />
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

/** Material-Filter als Leiste zum Wischen - „Jedes Material“ hebt ihn auf. */
export function MaterialFilter({ value, onChange }: { value: string; onChange: (material: string) => void }) {
  const options = [{ key: "", label: "Jedes Material" }, ...MATERIAL_OPTIONS];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.materialRow} testID="achievement-filter-material">
      {options.map((option) => {
        const active = value === option.key;
        const color = option.key ? materialColor({ material: option.key }) : colors.cyan;
        return (
          <Pressable
            key={option.key || "all"}
            onPress={() => onChange(option.key)}
            style={[styles.materialChip, active && { borderColor: color, backgroundColor: `${color}1f` }]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            testID={`achievement-filter-material-${option.key || "all"}`}
          >
            <Text style={[styles.materialText, active && { color }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Die „?“-Karte (#619): geheime Gruppen zeigen ihren Namen erst nach der Freischaltung - hier nur, wie viele. */
export function HiddenSummaryCard({ hidden }: { hidden: { total?: number; earned?: number } }) {
  const total = Number(hidden.total || 0);
  const earned = Number(hidden.earned || 0);
  const remaining = Math.max(total - earned, 0);
  return (
    <View style={styles.hiddenCard} testID="achievement-hidden-summary">
      <View style={styles.hiddenIcon}>
        <Ionicons name="help-circle-outline" size={24} color={LIGHT_PURPLE} />
      </View>
      <View style={styles.flex}>
        <View style={styles.chipRow}>
          <Text style={styles.name}>Geheim</Text>
          <View style={[styles.chip, { borderColor: `${PURPLE}80` }]}>
            <Text style={[styles.chipText, { color: LIGHT_PURPLE }]} testID="achievement-hidden-count">{earned} von {total} gefunden</Text>
          </View>
        </View>
        <Text style={styles.muted}>
          {remaining === 0
            ? "Alle gefunden. Du kennst jede Ecke dieser Seite."
            : `${remaining === total ? "Sie zeigen sich erst, wenn du sie gefunden hast" : `${remaining} warten noch`} – zu ungewöhnlichen Zeiten, an ungewöhnlichen Orten, mit ungewöhnlichen Zahlen.`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.6 },
  title: { color: colors.white, fontSize: 20, fontWeight: "900", textTransform: "uppercase", marginTop: 2 },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" },
  levelTitle: { color: colors.gold, fontSize: 13, fontWeight: "800", letterSpacing: 0.6 },
  stars: { flexDirection: "row", gap: 1 },
  muted: { color: colors.muted, fontSize: 12 },
  ringLabel: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  ringText: { color: colors.white, fontSize: 12, fontWeight: "900" },
  xpBlock: { gap: 6 },
  xpLabels: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  xpTitle: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2, flexShrink: 1 },
  xpCount: { color: colors.muted, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  track: { backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  outlineButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "flex-start", borderWidth: 1, borderColor: "rgba(168,85,247,0.5)", borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  outlineButtonText: { color: colors.white, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  dim: { opacity: 0.4 },
  prestige: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "rgba(255,215,0,0.3)", backgroundColor: "rgba(255,215,0,0.05)", borderRadius: radius.sm, padding: 12 },
  prestigeText: { color: "rgba(255,255,255,0.75)", fontSize: 12, flex: 1, minWidth: 180 },
  prestigeButton: { borderColor: "rgba(255,255,255,0.25)" },
  goldButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.gold, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  goldButtonText: { color: colors.black, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  note: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  notePrivate: { borderColor: "rgba(255,215,0,0.4)", backgroundColor: "rgba(255,215,0,0.05)" },
  noteText: { color: colors.muted, fontSize: 12, flex: 1 },
  link: { color: colors.cyan, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statTile: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.sm, padding: 12 },
  statHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  statLabel: { color: "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, flexShrink: 1 },
  statValue: { fontSize: 22, fontWeight: "900", marginTop: 6, fontVariant: ["tabular-nums"] },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  panelTitle: { color: colors.white, fontSize: 16, fontWeight: "900", textTransform: "uppercase", marginTop: 2 },
  nextItem: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.black, borderRadius: radius.sm, padding: 12, gap: 8 },
  name: { color: colors.white, fontSize: 15, fontWeight: "800" },
  chipRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 3 },
  chip: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  chipText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  points: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  count: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  howToLabel: { color: "rgba(255,255,255,0.4)", fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2 },
  howTo: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: -4 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  empty: { color: colors.muted, fontSize: 13, textAlign: "center", borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.sm, padding: 16 },
  pinnedRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius.sm, backgroundColor: colors.black, padding: 10 },
  pinTools: { flexDirection: "row", alignItems: "center", gap: 2 },
  iconButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  hint: { flexDirection: "row", gap: 6, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.sm, padding: 10 },
  hintText: { color: colors.muted, fontSize: 12, flex: 1 },
  showcaseGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  showcaseCell: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.black, borderRadius: radius.sm, padding: 10, gap: 5 },
  showcaseCellOn: { borderColor: "rgba(255,255,255,0.45)" },
  showcaseHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  showcaseLabel: { color: colors.white, fontSize: 13, fontWeight: "800", textTransform: "uppercase", flexShrink: 1 },
  materialRow: { gap: 8, paddingVertical: 2 },
  materialChip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7 },
  materialText: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  hiddenCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(168,85,247,0.45)", backgroundColor: "#0F0A16", borderRadius: radius.sm, padding: 14 },
  hiddenIcon: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(168,85,247,0.4)", backgroundColor: "rgba(168,85,247,0.1)", borderRadius: radius.sm },
});
