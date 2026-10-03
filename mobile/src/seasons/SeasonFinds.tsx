import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "../components/Card";
import { Muted } from "../components/Text";
import { api } from "../lib/api";
import { colors, radius } from "../theme";
import { FindFigure, usePoke } from "./findIcons";
import { useSeason } from "./SeasonProvider";
import { onSignal, viennaDay } from "./signals";

// Saison-Fundstücke im Profil der App (#678, Web #776): was du über die Jahreszeiten gesammelt hast - verscheuchte
// Fledermäuse, befreite Geister, die Katze, Türchen, Eier. Was gerade läuft, steht oben mit dem Stand von heute und
// dem Tagesdeckel; die anderen Jahreszeiten darunter mit ihrem nächsten Termin. Dieselbe Übersicht wie im Web
// (`GET /api/achievements/collectibles`, nur für die Person selbst). Zählt die App gerade etwas, lädt die Karte nach.

export const REFRESH_AFTER_SIGNAL_MS = 4000;

export type FindItem = { signal: string; label: string; icon: string; count: number; season_count: number; today: number; per_day: number };
export type FindSeason = { key: string; label: string; active: boolean; count: number; next_start: string | null; ends_at: string | null; items: FindItem[] };
export type Collectibles = { total: number; seasons: FindSeason[] };

/** Ein Tag als „TT.MM.“ nach der Uhr in Wien - wie im Web. */
export function dayText(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const [, month, day] = viennaDay(date).split("-");
  return `${day}.${month}.`;
}

/** Ein Satz zur Saison: läuft (bis wann), kommt (ab wann) - oder nichts, wenn es keinen Termin gibt. */
export function seasonHint(season: Pick<FindSeason, "active" | "ends_at" | "next_start">): string {
  if (season.active) return season.ends_at ? `läuft bis ${dayText(season.ends_at)}` : "läuft gerade";
  return season.next_start ? `ab ${dayText(season.next_start)}` : "";
}

/** Die laufenden Saisonen zuerst, dann die mit Fundstücken, dann der Rest - jeweils in der Reihenfolge des Jahres. */
export function orderSeasons(seasons: FindSeason[] = []): FindSeason[] {
  const rank = (season: FindSeason) => (season.active ? 0 : season.count > 0 ? 1 : 2);
  return seasons.map((season, index) => ({ season, index })).sort((a, b) => rank(a.season) - rank(b.season) || a.index - b.index).map((row) => row.season);
}

function number(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString("de-DE");
}

function Find({ item, active, reduced }: { item: FindItem; active: boolean; reduced: boolean }) {
  const empty = !item.count;
  const capped = active && item.per_day > 1;
  const percent = capped ? Math.max(0, Math.min(100, (item.today / item.per_day) * 100)) : 0;
  const full = capped && item.today >= item.per_day;
  const [poke, start] = usePoke(reduced || empty);
  const lastSeason = !capped && item.season_count > 0 && item.season_count !== item.count;
  return (
    <Pressable
      onPress={start}
      disabled={empty}
      style={styles.find}
      accessibilityRole={empty ? undefined : "button"}
      accessibilityLabel={`${item.label}: ${number(item.count)}${capped ? `, heute ${number(item.today)} von ${number(item.per_day)}` : ""}`}
      testID={`season-find-${item.signal}`}
    >
      <FindFigure icon={item.icon} empty={empty} poke={poke} />
      <Text style={[styles.count, empty && styles.countEmpty]}>{number(item.count)}</Text>
      <View style={styles.findText}>
        <Text style={styles.label}>{item.label}</Text>
        {capped ? (
          <View style={styles.todayRow}>
            <View style={styles.track}>
              <View style={[styles.fill, full && styles.fillFull, { width: `${percent}%` }]} testID={`season-find-${item.signal}-bar`} />
            </View>
            <Text style={styles.today} testID={`season-find-${item.signal}-today`}>heute {number(item.today)} von {number(item.per_day)}</Text>
          </View>
        ) : lastSeason ? (
          <Text style={styles.today}>zuletzt {number(item.season_count)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Season({ season, reduced }: { season: FindSeason; reduced: boolean }) {
  const hint = seasonHint(season);
  return (
    <View style={[styles.season, season.active && styles.seasonActive]} testID={`season-finds-${season.key}`} accessibilityLabel={season.label}>
      <View style={styles.seasonHead}>
        <View style={styles.seasonName}>
          <Text style={styles.seasonLabel}>{season.label}</Text>
          {season.active ? <Text style={styles.running}>läuft</Text> : null}
        </View>
        {hint ? <Text style={styles.hint} testID={`season-finds-${season.key}-hint`}>{hint}</Text> : null}
      </View>
      {season.items.map((item) => <Find key={item.signal} item={item} active={season.active} reduced={reduced} />)}
    </View>
  );
}

export function SeasonFindsCard() {
  const { reducedMotion } = useSeason();
  const [data, setData] = useState<Collectibles | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get<Collectibles>("/achievements/collectibles");
      setData(result && Array.isArray(result.seasons) ? result : { total: 0, seasons: [] });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    // Zählt die App gerade ein Fundstück, meldet sie es nach etwa 1,5 s - danach lädt die Karte nach.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = onSignal(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, REFRESH_AFTER_SIGNAL_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [load]);

  if (!data) {
    return failed ? (
      <Card style={styles.card} testID="season-finds-error">
        <Muted>Die Saison-Fundstücke konnten gerade nicht geladen werden.</Muted>
      </Card>
    ) : null;
  }
  const seasons = orderSeasons(data.seasons);
  return (
    <Card style={styles.card} testID="season-finds">
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.eyebrow}>Saison-Fundstücke</Text>
          <Text style={styles.title}>Was du über das Jahr gesammelt hast</Text>
        </View>
        <View style={styles.total}>
          <Text style={styles.totalNumber} testID="season-finds-total">{number(data.total)}</Text>
          <View style={styles.totalLabel}>
            <Ionicons name="sparkles-outline" size={11} color={colors.muted} />
            <Text style={styles.small}>insgesamt</Text>
          </View>
        </View>
      </View>
      {data.total === 0 ? (
        <Muted style={styles.empty} testID="season-finds-empty">
          Noch nichts gesammelt. In jeder Jahreszeit versteckt sich etwas zum Antippen – Fledermäuse, Geister und die Katze zu Halloween, Türchen im Advent. Was du in der App oder auf der Website findest, zählt hier und für deine Erfolge.
        </Muted>
      ) : null}
      <View style={styles.seasons}>
        {seasons.map((season) => <Season key={season.key} season={season} reduced={reducedMotion} />)}
      </View>
      <Text style={styles.footnote}>Nur du siehst diese Karte. Je Tag zählt eine Höchstzahl – was darüber hinausgeht, ist Spaß an der Freude.</Text>
    </Card>
  );
}

export type PublicFinds = { hidden: boolean; public?: boolean; total: number; seasons: Array<{ key: string; label: string; count: number; items: Array<{ signal: string; label: string; icon: string; count: number }> }> };

/**
 * Saison-Fundstücke auf einem fremden Profil (#678, wie `PublicSeasonFinds.jsx` im Web): nur wenn die Person ihren
 * Schalter „Saison-Fundstücke öffentlich“ gesetzt hat (Vorgabe aus) - und dann nur Summen, nie „heute“ oder ein Datum.
 * Auf dem eigenen Profil mit dem Hinweis, ob andere sie sehen.
 */
export function PublicSeasonFindsCard({ userId, own = false }: { userId: string; own?: boolean }) {
  const [data, setData] = useState<PublicFinds | null>(null);
  useEffect(() => {
    let alive = true;
    if (!userId) return undefined;
    api.get<PublicFinds>(`/achievements/collectibles/user/${userId}`)
      .then(({ data: result }) => {
        if (alive) setData(result || null);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
  }, [userId]);
  if (!data || data.hidden || !data.total) return null;
  return (
    <Card style={styles.card} testID="public-season-finds">
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.eyebrow}>Saison-Fundstücke</Text>
          <Text style={styles.title}>Über das Jahr gesammelt</Text>
        </View>
        <View style={styles.total}>
          <Text style={styles.totalNumber} testID="public-season-finds-total">{number(data.total)}</Text>
          <View style={styles.totalLabel}>
            <Ionicons name="sparkles-outline" size={11} color={colors.muted} />
            <Text style={styles.small}>insgesamt</Text>
          </View>
        </View>
      </View>
      <View style={styles.seasons}>
        {data.seasons.map((season) => (
          <View key={season.key} style={styles.season} testID={`public-season-finds-${season.key}`}>
            <View style={styles.seasonHead}>
              <Text style={styles.seasonLabel}>{season.label}</Text>
            </View>
            {season.items.map((item) => (
              <View key={item.signal} style={styles.find} testID={`public-season-find-${item.signal}`}>
                <FindFigure icon={item.icon} />
                <Text style={styles.count}>{number(item.count)}</Text>
                <View style={styles.findText}>
                  <Text style={styles.label}>{item.label}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
      {own ? <Text style={styles.footnote} testID="public-season-finds-note">{data.public ? "Andere sehen hier nur die Summen." : "Nur du siehst diese Karte – unter Profil → Privatsphäre kannst du sie zeigen."}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  headText: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: "800", letterSpacing: 3, textTransform: "uppercase" },
  title: { color: colors.white, fontSize: 17, fontWeight: "900", textTransform: "uppercase", marginTop: 4 },
  total: { alignItems: "flex-end" },
  totalNumber: { color: colors.white, fontSize: 24, fontWeight: "900", fontVariant: ["tabular-nums"] },
  totalLabel: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  small: { color: colors.muted, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" },
  empty: { fontSize: 13 },
  seasons: { gap: 10 },
  season: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.black, borderRadius: radius.sm, paddingVertical: 6 },
  seasonActive: { borderColor: "rgba(41,182,232,0.35)" },
  seasonHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 6, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 2 },
  seasonName: { flexDirection: "row", alignItems: "center", gap: 8 },
  seasonLabel: { color: colors.white, fontSize: 13, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  running: { color: colors.success, backgroundColor: "rgba(0,255,136,0.15)", fontSize: 9, fontWeight: "800", letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, overflow: "hidden", textTransform: "uppercase" },
  hint: { color: "rgba(255,255,255,0.45)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" },
  find: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 4 },
  count: { color: colors.white, fontSize: 20, fontWeight: "900", minWidth: 34, textAlign: "right", fontVariant: ["tabular-nums"] },
  countEmpty: { color: "rgba(255,255,255,0.3)" },
  findText: { flex: 1, minWidth: 0 },
  label: { color: "rgba(255,255,255,0.8)", fontSize: 13, lineHeight: 18 },
  todayRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2, backgroundColor: "rgba(41,182,232,0.85)" },
  fillFull: { backgroundColor: "rgba(0,255,136,0.85)" },
  today: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontVariant: ["tabular-nums"] },
  footnote: { color: "rgba(255,255,255,0.35)", fontSize: 11 },
});
