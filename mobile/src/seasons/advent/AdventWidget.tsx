import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useScreenFocused } from "../anchors";
import { seasonYear } from "../rng";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { adventSundays, candlesLit, daysToChristmas, todayIso } from "./calendar";
import { CALM_MS, LIGHTING_MS, dueIgnitions, markIgnited } from "./ignition";
import { WIND, Wreath } from "./WreathSvg";
import { adventLabel, daysLitFor, wreathLayout } from "./wreath";

// Der Adventkranz im Dashboard-Kopf (S6, #637; W1, #727; S11, #642): vier Kerzen, angezündet je Adventsonntag - der
// Server sagt, wie viele brennen. Jede Kerze ist anders, alles aus dem Jahres-Seed (C4), derselbe Kranz wie auf der
// Website. Am Sonntag, an dem eine Kerze dazukommt, brennt sie beim ersten Aufruf des Tages sichtbar an - mit einem
// leichten Tippen in der Hand. Antippen: „2. Advent – noch 13 Tage bis Weihnachten“ als Gruß-Karte. „Bewegung
// reduzieren“: Flammen stehen mit Schein, kein Wind; „dezent“: der Kranz ohne Wind. Wechselt man in einen anderen
// Tab, ruht die Bewegung - das Dashboard bleibt geladen, aber niemand sieht hin.

export type AdventInfo = { year: number; today: string; sundays: string[]; candles: number; daysToChristmas: number };

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Was der Kranz wissen muss - aus der Antwort des Servers, sonst aus der Uhr (Vorschau, alte Antwort). */
export function adventData(season: Pick<ActiveSeason, "data" | "starts_at"> | null | undefined, now: Date = new Date()): AdventInfo {
  const today = todayIso(now);
  const year = seasonYear({ key: "advent", starts_at: season?.starts_at || "" }, now);
  const data = (season?.data || {}) as Record<string, unknown>;
  const sundays = Array.isArray(data.sundays) && data.sundays.length === 4 ? data.sundays.map((sunday) => String(sunday).slice(0, 10)) : adventSundays(year);
  const fromServer = number(data.candles);
  const candles = fromServer === null ? candlesLit(today, sundays) : Math.max(0, Math.min(4, Math.round(fromServer)));
  const days = number(data.days_to_christmas);
  return { year, today, sundays, candles, daysToChristmas: days === null ? daysToChristmas(today, year) : Math.max(0, Math.round(days)) };
}

/** Läuft der Adventkalender (#641), sagt der Kranz auch, welches Türchen offen ist. */
export function wreathLabel(info: AdventInfo, calendar?: Record<string, unknown> | null): string {
  const door = calendar?.ready && !calendar.catch_up ? Math.round(Number(calendar.today_door) || 0) : 0;
  return door > 0 ? `${adventLabel(info)} · Türchen ${door} ist offen` : adventLabel(info);
}

export function AdventWidget({ season }: { season: ActiveSeason; screen?: string }) {
  const { showToast, reducedMotion, byKey } = useSeason();
  const focused = useScreenFocused();
  const info = useMemo(() => adventData(season), [season]);
  const layout = useMemo(() => wreathLayout(info.year), [info.year]);
  const sundaysKey = info.sundays.join(",");
  const daysLit = useMemo(() => daysLitFor(info.sundays, info.candles, info.today), [info.sundays, info.candles, info.today]);
  const [lighting, setLighting] = useState<number[]>([]);
  const [calm, setCalm] = useState<number[]>([]);

  // Anzünden am Sonntag der Kerze - einmal je Tag (Speicher); ohne Bewegung brennt sie einfach.
  useEffect(() => {
    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    (async () => {
      const due = await dueIgnitions({ year: info.year, sundays: info.sundays, candles: info.candles, today: info.today });
      if (cancelled || !due.length) return;
      await Promise.all(due.map((index) => markIgnited(info.year, index, info.today)));
      if (cancelled || reducedMotion) return;
      setLighting(due);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      timers.push(setTimeout(() => {
        if (cancelled) return;
        setLighting([]);
        setCalm(due);
      }, LIGHTING_MS));
      timers.push(setTimeout(() => {
        if (!cancelled) setCalm([]);
      }, LIGHTING_MS + CALM_MS));
    })();
    return () => {
      cancelled = true;
      timers.forEach((handle) => clearTimeout(handle));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.year, sundaysKey, info.candles, info.today, reducedMotion]);

  const label = wreathLabel(info, byKey?.advent_calendar?.data as Record<string, unknown> | undefined);
  const onPress = () => {
    showToast(label);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
  const wind = season.effective === "subtle" ? 0 : WIND;
  return (
    <View style={styles.widget} testID="advent-widget" accessibilityValue={{ text: String(info.candles) }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} testID="advent-wreath">
        <Wreath layout={layout} candles={info.candles} daysLit={daysLit} lighting={lighting} calm={calm} still={reducedMotion || !focused} wind={wind} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  widget: { alignItems: "center", justifyContent: "center", marginLeft: 4 },
});
