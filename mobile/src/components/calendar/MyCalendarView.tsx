import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../Button";
import { ListItemFadeIn, useListEntrance } from "../FadeIn";
import { EmptyState, SkeletonList } from "../ListState";
import { MonthCalendar } from "../MonthCalendar";
import { SegmentedTabs } from "../SegmentedTabs";
import { SignInRequired } from "../SignInRequired";
import { Body, Heading, Muted } from "../Text";
import { PersonalFeedCard } from "./PersonalFeedCard";
import { currentMonth, itemsByDay, parseDay, shiftMonth, type CalendarKind } from "../../lib/calendar";
import {
  MY_KIND_LABELS, agendaBuckets, filterKind, kindLabel, ownBadge, presentKinds, toCalendarItems, whenLabel,
  type BadgeTone, type MyCalendarItem,
} from "../../lib/myCalendar";
import { upperDe } from "../../lib/format";
import { openLink } from "../../lib/openLink";
import { useMyCalendar } from "../../lib/useMyCalendar";
import { dayNoon, viennaDate, viennaDay } from "../../lib/vienna";
import { colors, kindColors, radius, roles } from "../../theme";

// „Mein Kalender“ (#1788) im Events-Tab: nur die eigenen Termine, auch ohne Abo - als „Als Nächstes“ (Heute, Diese
// Woche, Später) oder als Monat, mit dem eigenen Stand als Plakette und einem Filter nach Art. Dieselbe Rechnung wie im
// Web (lib/myCalendar.ts). Ein Tipp öffnet den Termin in der App (oder auf der Website, wenn die App keinen Screen hat).
// Darunter der Kasten „Automatisch in deinen Kalender“. Die Zeilen blenden gestaffelt ein, mit „Bewegung reduzieren“ nicht.

type KindFilter = CalendarKind | "all";

const TONES: Record<BadgeTone, { color: string; backgroundColor: string }> = {
  mine: { color: roles.brand, backgroundColor: "rgba(41,182,232,0.12)" },
  wait: { color: roles.warn, backgroundColor: "rgba(255,159,67,0.14)" },
  done: { color: roles.ok, backgroundColor: "rgba(31,208,142,0.14)" },
  club: { color: roles.honor, backgroundColor: "rgba(255,215,0,0.12)" },
};

export function MyCalendarView({ view, signedIn, refreshKey, onBrowse }: {
  view: "list" | "calendar";
  signedIn: boolean;
  /** Ändert sich der Wert (Ziehen zum Aktualisieren, Live-Änderung), lädt die Ansicht neu. */
  refreshKey?: unknown;
  /** Leerer Zustand: zu den Turnieren oder Events im Tab. */
  onBrowse: (filter: "tournaments" | "events") => void;
}) {
  const { items, loading, failed, needsLogin, reload } = useMyCalendar(signedIn, refreshKey);
  const [kind, setKind] = useState<KindFilter>("all");
  const [month, setMonth] = useState(() => currentMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const entrance = useListEntrance();

  const kinds = useMemo(() => presentKinds(items), [items]);
  const activeKind: KindFilter = kind !== "all" && !kinds.includes(kind) ? "all" : kind;
  const shown = useMemo(() => filterKind(items, activeKind), [activeKind, items]);
  const buckets = useMemo(() => agendaBuckets(shown), [shown]);
  const monthItems = useMemo(() => toCalendarItems(shown), [shown]);
  const dayItems = useMemo(() => {
    if (!selectedDay) return [];
    const keys = new Set((itemsByDay(monthItems).get(selectedDay) || []).map((entry) => `${entry.kind}-${entry.id}`));
    return shown.filter((item) => keys.has(`${item.kind}-${item.marker === "event_day" && item.event_id ? item.event_id : item.id}`));
  }, [monthItems, selectedDay, shown]);
  const selectDay = useCallback((key: string) => {
    setSelectedDay((current) => (current === key ? null : key));
    const date = parseDay(key);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
  }, []);

  if (!signedIn || needsLogin) {
    return <SignInRequired text="Melde dich an, dann siehst du hier deine Termine – und kannst sie automatisch in deinen Kalender holen." testID="my-calendar-login" />;
  }
  if (loading) return <SkeletonList count={3} hasImage={false} />;

  const kindTabs: Array<{ key: KindFilter; label: string }> = [{ key: "all", label: "Alle" }, ...kinds.map((key) => ({ key, label: MY_KIND_LABELS[key] }))];
  let body: React.ReactNode;
  if (failed && !items.length) {
    body = (
      <View style={styles.section} testID="my-calendar-failed">
        <Muted style={styles.problem}>Die Termine konnten gerade nicht geladen werden.</Muted>
        <Button label="Erneut versuchen" variant="secondary" compact onPress={reload} testID="my-calendar-retry" />
      </View>
    );
  } else if (!items.length) {
    body = (
      <EmptyState
        title="Noch keine Termine"
        detail="Sobald du dich zu einem Turnier, Event oder einer Fast Lap anmeldest, steht der Termin hier – mit deinem Stand."
        action={{ label: "Turniere ansehen", onPress: () => onBrowse("tournaments"), testID: "my-calendar-browse-tournaments" }}
        secondaryAction={{ label: "Events ansehen", onPress: () => onBrowse("events"), testID: "my-calendar-browse-events" }}
        testID="my-calendar-empty"
      />
    );
  } else if (view === "calendar") {
    body = (
      <View style={styles.section}>
        <MonthCalendar
          year={month.year}
          month={month.month}
          items={monthItems}
          selected={selectedDay}
          onSelect={selectDay}
          onShift={(delta) => { setMonth(shiftMonth(month.year, month.month, delta)); setSelectedDay(null); }}
          onToday={() => { setMonth(currentMonth()); setSelectedDay(viennaDay(new Date())); }}
        />
        {selectedDay ? (
          dayItems.length ? (
            <View style={styles.section} testID="my-calendar-day">
              <Heading>{viennaDate(dayNoon(selectedDay), { weekday: "long", day: "numeric", month: "long" })}</Heading>
              {dayItems.map((item) => <MyCalendarRow key={`${item.kind}-${item.id}`} item={item} />)}
            </View>
          ) : (
            <Muted testID="my-calendar-day-empty">An diesem Tag hast du nichts vor.</Muted>
          )
        ) : (
          <Muted>Tag antippen, um deine Termine zu sehen.</Muted>
        )}
      </View>
    );
  } else {
    body = buckets.length ? (
      <View style={styles.section} testID="my-calendar-list">
        {buckets.map((bucket, bucketIndex) => (
          <View key={bucket.key} style={styles.bucket} testID={`my-calendar-bucket-${bucket.key}`}>
            <Heading accessibilityRole="header">{bucket.label}</Heading>
            {bucket.items.map((item, index) => (
              <ListItemFadeIn key={`${item.kind}-${item.id}`} entrance={entrance} id={`${item.kind}-${item.id}`} index={bucketIndex * 3 + index}>
                <MyCalendarRow item={item} />
              </ListItemFadeIn>
            ))}
          </View>
        ))}
      </View>
    ) : (
      <Muted testID="my-calendar-nothing">Gerade steht für dich nichts an. Was vorbei ist, findest du im Monat.</Muted>
    );
  }

  return (
    <View style={styles.wrap}>
      {kinds.length > 1 ? <SegmentedTabs items={kindTabs} value={activeKind} onChange={setKind} label="Art der Termine" /> : null}
      {body}
      <PersonalFeedCard />
    </View>
  );
}

/** Ein eigener Termin: Art, wann, wo, Titel und der eigene Stand - ein Tipp öffnet ihn. */
export function MyCalendarRow({ item }: { item: MyCalendarItem }) {
  const badge = ownBadge(item);
  const meta = [kindLabel(item), whenLabel(item), item.location].filter(Boolean).join(" · ");
  const phase = item.kind !== "club" ? item.phase?.label : null;
  return (
    <Pressable
      onPress={() => { openLink(item.path); }}
      disabled={!item.path}
      accessibilityRole="button"
      accessibilityLabel={[item.title, meta, badge?.label, phase].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.row, { borderLeftColor: kindColors[item.kind] }, pressed && styles.pressed]}
      testID={`my-calendar-item-${item.kind}-${item.id}`}
    >
      <Muted style={styles.meta}>{meta}</Muted>
      <Body style={styles.title}>{item.title}</Body>
      {badge || phase ? (
        <View style={styles.badges}>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: TONES[badge.tone].backgroundColor }]} testID={`my-calendar-badge-${item.kind}-${item.id}`}>
              <Muted style={[styles.badgeText, { color: TONES[badge.tone].color }]}>{upperDe(badge.label)}</Muted>
            </View>
          ) : null}
          {phase ? <Muted>{phase}</Muted> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
  },
  section: {
    gap: 10,
  },
  bucket: {
    gap: 8,
  },
  problem: {
    color: colors.live,
  },
  row: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 3,
    minHeight: 48,
    padding: 12,
  },
  meta: {
    fontSize: 12,
  },
  title: {
    fontWeight: "800",
  },
  badges: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 3,
  },
  badge: {
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  pressed: {
    opacity: 0.72,
  },
});
