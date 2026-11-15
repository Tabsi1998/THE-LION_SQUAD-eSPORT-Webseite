import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { awardTone } from "../../lib/awards";
import { metalColor } from "../../lib/leagueRewards";
import { openLink } from "../../lib/openLink";
import {
  ALL, EMBLEM_LIMIT, NO_FILTER, activeFilters, competitionLine, filterTrophies, fitsEmblem, kindLabel, shownEmblems, sortTrophies, toggleEmblem,
  trophyCount, trophyDate, trophyFacets, trophyHref, trophyKind, trophyName, type TrophyAward, type TrophyFilters,
} from "../../lib/trophies";
import { colors, radius, roles, surfaces } from "../../theme";
import { MediaImage } from "../MediaImage";
import { Glow, Press, StaggerIn, staggerInDelay } from "../motion";
import { Body, Muted } from "../Text";
import { RewardArt } from "./RewardArt";

// Reiter „Trophäen“ (#2425, Nr. 59; App: #2173, Web: components/tls/rewards/TrophyCabinet.jsx) an Profil und Team: Turnier-Pokale und
// Liga-Belohnungen in einer Vitrine - Karten mit Bild, Art, Name, Wettbewerb, Platz, Datum und Weg zum Wettbewerb, darüber Filter nach
// Art, Spiel, Season bzw. Jahr und Platz (angeboten wird nur, was vorkommt). Wer die Vitrine besitzt (eigenes Profil, Teamleitung),
// wählt hier das Banner oben, den Titel und bis zu drei Embleme neben dem Namen (Nr. 34c); der vierte Emblem-Knopf ist gesperrt und
// sagt warum.
//
// Bewegung (Detail-Runde): Beim Öffnen steigen die Karten gestaffelt auf, Gold leuchtet danach einmal kurz nach - beim Filtern nicht mehr
// (das passiert oft). Eine neue Wahl (Banner, Titel, Emblem) leuchtet an ihrer Karte auf. Karten geben beim Antippen leicht nach. Nur
// Verschieben, Skalieren und Deckkraft; „Bewegung reduzieren“: alles steht.

export type TrophyOwner = {
  featuredId?: string | null;
  titleId?: string | null;
  emblemIds?: string[];
  onFeature?: ((id: string | null) => void) | null;
  onTitle?: ((id: string | null) => void) | null;
  onEmblems?: ((ids: string[]) => void) | null;
  /** Eine Wahl wird gerade gespeichert - bis dahin nimmt kein Knopf einen weiteren Tipp an (Doppeltipp-Schutz). */
  busy?: boolean;
  /** Der Satz über den Karten, etwa „… neben deinem Namen.“ */
  emblemHint?: string;
};

const METAL_BY_RANK: Record<number, string> = { 1: "gold", 2: "silver", 3: "bronze" };
// Wann das Gold nach dem Aufsteigen nachleuchtet: kurz nachdem die Karte steht.
const GLOW_AFTER_MS = 360;

function metalOf(award: TrophyAward): string {
  return award.reward?.art?.metal || METAL_BY_RANK[Number(award.rank)] || "lion";
}

/** Das Bild der Karte: die Belohnung, sonst das hochgeladene Bild des Turniers, sonst ein Pokal (Platz 1–3) bzw. ein Banner. */
function TrophyArt({ award }: { award: TrophyAward }) {
  if (award.reward) return <RewardArt reward={award.reward} />;
  const tone = awardTone(award);
  const medal = METAL_BY_RANK[Number(award.rank)];
  return (
    <View style={[styles.art, { borderColor: tone.color }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`trophy-art-${award.id}`}>
      {award.image_url ? <MediaImage uri={award.image_url} style={StyleSheet.absoluteFill} fallback={null} /> : null}
      {award.image_url ? null : <Ionicons name={medal ? "trophy" : "flag"} size={24} color={tone.color} />}
    </View>
  );
}

function Choice({ label, pressed, disabled = false, busy = false, hint, onPress, accessibilityLabel, testID }: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const off = disabled || busy;
  return (
    <Press
      haptic
      disabled={off}
      onPress={onPress}
      style={[styles.choice, pressed && styles.choiceOn, off && styles.choiceOff]}
      accessibilityRole="button"
      accessibilityState={{ selected: pressed, disabled: off, busy }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={hint}
      testID={testID}
    >
      <Text style={[styles.choiceText, pressed && styles.choiceTextOn]}>{label}</Text>
    </Press>
  );
}

function TrophyCard({ award, index, play, owner }: { award: TrophyAward; index: number; play: boolean; owner: TrophyOwner | null }) {
  const href = trophyHref(award);
  const date = trophyDate(award);
  const kind = trophyKind(award);
  const name = trophyName(award);
  const color = metalColor(metalOf(award));
  const featured = owner?.featuredId === award.id;
  const titled = owner?.titleId === award.id;
  const emblems = owner?.emblemIds || [];
  const emblemAt = emblems.indexOf(award.id);
  const emblemFull = emblems.length >= EMBLEM_LIMIT;
  const chosen = featured || titled || emblemAt >= 0;
  const line = competitionLine(award);
  const delay = staggerInDelay(index);
  const body = (
    <>
      <TrophyArt award={award} />
      <View style={styles.text}>
        <Text style={[styles.kind, { color }]}>{kindLabel(award)}</Text>
        <Body style={styles.name} numberOfLines={2} testID={`trophy-name-${award.id}`}>{name}</Body>
        {line ? <Muted style={styles.meta} numberOfLines={2} testID={`trophy-competition-${award.id}`}>{line}</Muted> : null}
        <View style={styles.facts}>
          {award.rank_label ? <Text style={[styles.place, { color }]} testID={`trophy-place-${award.id}`}>{award.rank_label}</Text> : null}
          {award.team?.name ? <Muted style={styles.meta} numberOfLines={1}>{award.team.name}</Muted> : null}
          {date ? (
            <View style={styles.date}>
              <Ionicons name="calendar-outline" size={12} color={roles.quiet} />
              <Muted style={styles.meta}>{date}</Muted>
            </View>
          ) : null}
        </View>
      </View>
      {href ? <Ionicons name="chevron-forward" size={16} color={roles.quiet} /> : null}
    </>
  );
  return (
    <View style={[styles.card, chosen && styles.cardChosen]} testID={`trophy-card-${award.id}`}>
      {href ? (
        <Press onPress={() => { openLink(href); }} style={styles.cardLink} accessibilityRole="link" accessibilityLabel={`${name} – ${award.rank_label || kindLabel(award)} – zum Wettbewerb`}
          testID={`trophy-open-${award.id}`}>
          {body}
        </Press>
      ) : <View style={styles.cardLink} accessible accessibilityLabel={`${name} – ${award.rank_label || kindLabel(award)}`}>{body}</View>}
      {owner && (owner.onFeature || (owner.onTitle && kind === "title" && award.reward) || (owner.onEmblems && fitsEmblem(award))) ? (
        <View style={styles.actions}>
          {owner.onFeature ? (
            <Choice label={featured ? "Banner ✓" : "Als Banner"} pressed={featured} busy={owner.busy} testID={`trophy-banner-${award.id}`}
              accessibilityLabel={`${featured ? "Banner entfernen" : "Als Banner oben zeigen"}: ${name}`} onPress={() => owner.onFeature?.(featured ? null : award.id)} />
          ) : null}
          {owner.onTitle && kind === "title" && award.reward ? (
            <Choice label={titled ? "Titel ✓" : "Als Titel"} pressed={titled} busy={owner.busy} testID={`trophy-title-${award.id}`}
              accessibilityLabel={`${titled ? "Titel entfernen" : "Als Titel wählen"}: ${name}`} onPress={() => owner.onTitle?.(titled ? null : award.id)} />
          ) : null}
          {owner.onEmblems && fitsEmblem(award) ? (
            <Choice
              label={emblemAt >= 0 ? `Emblem ${emblemAt + 1} ✓` : "Neben den Namen"}
              pressed={emblemAt >= 0}
              disabled={emblemAt < 0 && emblemFull}
              busy={owner.busy}
              hint={emblemAt < 0 && emblemFull ? `Höchstens ${EMBLEM_LIMIT} Embleme – nimm zuerst eines weg.` : undefined}
              accessibilityLabel={`${emblemAt >= 0 ? "Emblem entfernen" : "Als Emblem neben den Namen"}: ${name}`}
              testID={`trophy-emblem-${award.id}`}
              onPress={() => {
                const next = toggleEmblem(emblems, award.id);
                if (next) owner.onEmblems?.(next);
              }}
            />
          ) : null}
          {owner.onEmblems && fitsEmblem(award) && emblemAt < 0 && emblemFull ? (
            <Muted style={styles.full} testID={`trophy-emblem-full-${award.id}`}>Höchstens {EMBLEM_LIMIT} Embleme – nimm zuerst eines weg.</Muted>
          ) : null}
        </View>
      ) : null}
      {/* Gold leuchtet nach dem Aufsteigen einmal nach - nur beim Öffnen; eine neue Wahl leuchtet an ihrer Karte. */}
      {play && delay !== null && metalOf(award) === "gold" ? <Glow active tone="honor" delay={delay + GLOW_AFTER_MS} radius={radius.lg} /> : null}
      {chosen ? <Glow trigger={`${owner?.featuredId}|${owner?.titleId}|${emblems.join(",")}`} tone="brand" radius={radius.lg} /> : null}
    </View>
  );
}

function FilterChips({ label, options, value, onChange, testID }: {
  label?: string;
  options: Array<[string, string]>;
  value: string;
  onChange: (value: string) => void;
  testID: string;
}) {
  return (
    <View style={styles.filter} testID={testID}>
      {label ? <Text style={styles.filterLabel}>{label}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={label ? `${label} filtern` : "Art filtern"}>
        {[[ALL, "Alle"] as [string, string], ...options].map(([key, text]) => {
          const active = value === key;
          return (
            <Press key={key || "all"} onPress={() => onChange(key)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button"
              accessibilityState={{ selected: active }} accessibilityLabel={label ? `${label}: ${text}` : text} testID={`${testID}-${key || "all"}`}>
              <Text style={[styles.chipText, active && styles.chipTextOn]} numberOfLines={1}>{text}</Text>
            </Press>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Die Vitrine. `awards`: alle Auszeichnungen (Turnier und Liga). `owner` (eigenes Profil, Teamleitung): Banner, Titel und Embleme wählen.
 * `empty`: der Satz ohne jede Trophäe.
 */
export function TrophyCabinet({ awards, owner = null, empty, testID = "trophy-cabinet" }: {
  awards?: TrophyAward[] | null;
  owner?: TrophyOwner | null;
  empty: string;
  testID?: string;
}) {
  const [filters, setFilters] = useState<TrophyFilters>(NO_FILTER);
  // Nur beim Öffnen leuchtet Gold nach - nach dem ersten Filtern nicht mehr.
  const [play, setPlay] = useState(true);
  const all = useMemo(() => sortTrophies(awards), [awards]);
  const facets = useMemo(() => trophyFacets(all), [all]);
  const shown = useMemo(() => filterTrophies(all, filters), [all, filters]);
  const set = (key: keyof TrophyFilters, value: string) => {
    setPlay(false);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const reset = () => {
    setPlay(false);
    setFilters(NO_FILTER);
  };
  if (!all.length) {
    return (
      <View style={styles.empty} testID={`${testID}-empty`}>
        <Ionicons name="trophy-outline" size={28} color={roles.quiet} />
        <Muted style={styles.emptyText}>{empty}</Muted>
      </View>
    );
  }
  const emblemCount = (owner?.emblemIds || []).length;
  const hasEmblems = all.some(fitsEmblem);
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.filters} accessibilityLabel="Trophäen filtern" testID={`${testID}-filters`}>
        {facets.kinds.length > 1 ? <FilterChips options={facets.kinds} value={filters.kind} onChange={(value) => set("kind", value)} testID={`${testID}-kind`} /> : null}
        {facets.games.length > 1 ? (
          <FilterChips label="Spiel" options={facets.games.map((game) => [game, game])} value={filters.game} onChange={(value) => set("game", value)} testID={`${testID}-game`} />
        ) : null}
        {facets.periods.length > 1 ? (
          <FilterChips label="Season / Jahr" options={facets.periods.map((period) => [period, period])} value={filters.period} onChange={(value) => set("period", value)}
            testID={`${testID}-period`} />
        ) : null}
        {facets.places.length > 1 ? <FilterChips label="Platz" options={facets.places} value={filters.place} onChange={(value) => set("place", value)} testID={`${testID}-place`} /> : null}
        <View style={styles.countRow}>
          <Text style={styles.count} accessibilityLiveRegion="polite" testID={`${testID}-count`}>{trophyCount(shown.length, all.length)}</Text>
          {activeFilters(filters) ? (
            <Press onPress={reset} style={styles.reset} accessibilityRole="button" accessibilityLabel="Filter zurücksetzen" testID={`${testID}-reset`}>
              <Ionicons name="refresh" size={14} color={roles.brand} />
              <Text style={styles.resetText}>Zurücksetzen</Text>
            </Press>
          ) : null}
        </View>
      </View>
      {owner?.onEmblems && hasEmblems ? (
        <Muted style={styles.hint} testID={`${testID}-emblem-hint`}>
          {owner.emblemHint || "Bis zu drei Embleme oder Medaillen stehen neben dem Namen."} {emblemCount} von {EMBLEM_LIMIT} gewählt.
        </Muted>
      ) : null}
      {shown.length ? (
        <StaggerIn style={styles.list}>
          {shown.map((award, index) => <TrophyCard key={award.id} award={award} index={index} play={play} owner={owner} />)}
        </StaggerIn>
      ) : (
        <View style={styles.empty} testID={`${testID}-no-match`}>
          <Ionicons name="funnel-outline" size={24} color={roles.quiet} />
          <Muted style={styles.emptyText}>Keine Trophäe passt zu diesem Filter.</Muted>
          <Press onPress={reset} style={styles.reset} accessibilityRole="button" accessibilityLabel="Filter zurücksetzen" testID={`${testID}-no-match-reset`}>
            <Ionicons name="refresh" size={14} color={roles.brand} />
            <Text style={styles.resetText}>Filter zurücksetzen</Text>
          </Press>
        </View>
      )}
    </View>
  );
}

/** Bis zu drei Embleme neben dem Namen (Nr. 34c) - klein, gestaffelt; ohne Wahl (oder bei alten Servern ohne das Feld) nichts. */
export function EmblemRow({ emblems, testID = "featured-emblems" }: { emblems?: Array<TrophyAward | null | undefined> | null; testID?: string }) {
  const list = shownEmblems(emblems);
  if (!list.length) return null;
  const names = list.map((award) => award.reward?.name).filter(Boolean).join(", ");
  return (
    <View style={styles.emblems} accessible accessibilityRole="image" accessibilityLabel={`Embleme: ${names}`} testID={testID}>
      <StaggerIn style={styles.emblemList}>
        {list.map((award) => (
          <View key={award.id} testID={`${testID}-${award.id}`}>
            <RewardArt reward={award.reward} size={24} />
          </View>
        ))}
      </StaggerIn>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  filters: { gap: 8 },
  filter: { gap: 4 },
  filterLabel: { color: roles.quiet, fontSize: 11, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  chips: { gap: 8, paddingRight: 18 },
  // Tippflächen mindestens 48 Punkte wie jeder Knopf der App (a11y/audit.ts).
  chip: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.05)", borderColor: colors.border, borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 48, minWidth: 48, paddingHorizontal: 14 },
  chipOn: { backgroundColor: "rgba(41,182,232,0.16)", borderColor: "rgba(41,182,232,0.55)" },
  chipText: { color: roles.muted, fontSize: 13, fontWeight: "800" },
  chipTextOn: { color: roles.brand },
  countRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" },
  count: { color: roles.muted, fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "800" },
  reset: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 48, minWidth: 48, paddingHorizontal: 10 },
  resetText: { color: roles.brand, fontSize: 13, fontWeight: "900" },
  hint: { fontSize: 12 },
  list: { gap: 10 },
  card: { backgroundColor: surfaces.s1, borderColor: "rgba(255,255,255,0.1)", borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  cardChosen: { borderColor: "rgba(41,182,232,0.7)" },
  cardLink: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 48, padding: 12 },
  art: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 999, borderWidth: 2, height: 52, justifyContent: "center", overflow: "hidden", width: 52 },
  text: { flex: 1, gap: 2, minWidth: 0 },
  kind: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  name: { fontWeight: "900" },
  meta: { fontSize: 12 },
  facts: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  place: { fontSize: 12, fontWeight: "900" },
  date: { alignItems: "center", flexDirection: "row", gap: 4 },
  actions: { borderTopColor: "rgba(255,255,255,0.06)", borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  choice: { alignItems: "center", borderColor: "rgba(255,255,255,0.2)", borderRadius: radius.sm, borderWidth: 1, justifyContent: "center", minHeight: 48, minWidth: 48, paddingHorizontal: 12 },
  choiceOn: { borderColor: "rgba(41,182,232,0.7)" },
  choiceOff: { opacity: 0.5 },
  choiceText: { color: roles.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  choiceTextOn: { color: roles.brand },
  full: { flexBasis: "100%", fontSize: 11 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyText: { textAlign: "center" },
  emblems: { alignSelf: "flex-start" },
  emblemList: { flexDirection: "row", gap: 4 },
});
