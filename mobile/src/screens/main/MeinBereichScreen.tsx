import { Ionicons } from "@expo/vector-icons";
import { NavigationContext } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/Button";
import { MediaImage } from "../../components/MediaImage";
import { Glow, Press, StaggerIn, useReduceMotion } from "../../components/motion";
import { Screen } from "../../components/Screen";
import { TabHeader, useTabScrollToTop } from "../../components/TabHeader";
import { Body, Muted, Title } from "../../components/Text";
import { api } from "../../lib/api";
import {
  einstellungZiel, gruppe as gruppeMeta, gruppenFuer, offenJeGruppe, offenText, schnellwege, siehtVerein, sucheEinstellungen, suchWoerter,
  type Einstellung, type Gruppe,
} from "../../lib/meinBereich";
import { brauchtZweiFaktor, zuTun, type ZuTunItem } from "../../lib/meinBereichZuTun";
import { isGuestUser } from "../../live";
import { navigateToUrl, openSignIn } from "../../navigation/rootNavigation";
import type { LooseNavigation } from "../../navigation/types";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { colors, motion, radius } from "../../theme";
import { GuestSettings } from "./SettingsScreen";

// Mein Bereich (#2059, #1677): der Tab, früher „Profil“. Alles, was mich betrifft, an einem Ort - wie /mein-bereich im Web:
// oben wer ich bin (ein Tipp öffnet das eigene Profil), die Suche über jede Einstellung, „Zu tun“ (nur Pflichtiges, als
// große Knöpfe), „Häufig gebraucht“ (die fünf Wege der Abnahme, gestaffelt) und alle Gruppen. Jede Einstellung liegt
// höchstens zwei Tipps entfernt: Gruppe, dann die Stelle - oder ein Suchtreffer, der direkt dorthin springt.
// Bewegung: nur Verschieben und Deckkraft (Reanimated); mit „Bewegung reduzieren“ steht alles sofort da.

const EASE = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);
const SCHNELL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  nummer: "keypad-outline", anschrift: "location-outline", rechnungen: "receipt-outline", passwort: "key-outline", loeschung: "trash-outline",
};

export function MeinBereichScreen() {
  const { user } = useAuth();
  return !user || isGuestUser(user) ? <GuestBereich /> : <EigenerBereich />;
}

/** Gast zuerst (#918): der Weg zum Konto, darunter, was auch ohne Konto geht - Darstellung und „Über die App“. */
function GuestBereich() {
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);
  return (
    <Screen padded={false}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <TabHeader title="Mein Bereich" testID="mein-bereich-header" />
        <View style={styles.guestWrap} testID="profile-guest">
          <View style={styles.guestIcon}><Ionicons name="person-circle-outline" color={colors.cyan} size={56} /></View>
          <Title style={styles.guestTitle}>Dein Bereich</Title>
          <Body style={styles.guestText}>Mit einem Konto stehen hier dein Profil, deine Rechnungen und Gewinne, die Mitgliedschaft und alle Einstellungen – dasselbe Konto wie auf der Website.</Body>
          <Button label="Anmelden" onPress={() => openSignIn("Login")} testID="profile-guest-login" />
          <Button label="Konto erstellen" variant="secondary" onPress={() => openSignIn("Register")} testID="profile-guest-register" />
        </View>
        <GuestSettings />
      </ScrollView>
    </Screen>
  );
}

type ZuTunState = { loaded: boolean; items: ZuTunItem[] };
type Data<T> = { data: T };

/**
 * „Zu tun“ laden - dieselben Quellen wie im Web (MeinBereichLayout): Rechnungen und Gewinne für alle, Mitgliedschaft,
 * Einwilligungen, Wunschnummer und Vereins-Übersicht nur für Mitglieder. Nur der letzte Lauf zählt - nach einem
 * Kontowechsel kommt der vorige nicht mehr an.
 */
function useZuTun(user: Record<string, unknown> | null, mitglied: boolean): ZuTunState & { reload: () => Promise<void> } {
  const [state, setState] = useState<ZuTunState>({ loaded: false, items: [] });
  const userId = user?.id ? String(user.id) : "";
  const secondFactor = brauchtZweiFaktor(user as never);
  const run = useRef(0);
  const reload = useCallback(async () => {
    if (!userId) return;
    const nr = ++run.current;
    const member = <T,>(path: string) => (mitglied ? api.get<T>(path) : Promise.resolve({ data: null } as Data<T | null>));
    const [invoices, prizes, membership, consents, jersey, area] = await Promise.allSettled([
      api.get<unknown>("/account/invoices"),
      api.get<{ count?: number }>("/prizes/me/open-count"),
      member<unknown>("/membership/me"),
      member<unknown>("/membership/me/consents"),
      member<unknown>("/membership/me/jersey-number"),
      member<unknown>("/membership/area-summary"),
    ]);
    if (nr !== run.current) return;
    const value = (result: PromiseSettledResult<Data<unknown> | Data<unknown | null>>) => (
      result.status === "fulfilled" && result.value?.data && typeof result.value.data === "object" ? result.value.data as never : null
    );
    const prizeData = value(prizes) as { count?: number } | null;
    setState({
      loaded: true,
      items: zuTun({
        invoices: value(invoices),
        prizes: Number(prizeData?.count) || 0,
        membership: value(membership),
        consents: value(consents),
        jersey: value(jersey),
        area: value(area),
        secondFactor,
      }),
    });
  }, [mitglied, secondFactor, userId]);
  useEffect(() => {
    setState({ loaded: false, items: [] });
    void reload();
  }, [reload]);
  // Ohne „prizes“: Fast Lap meldet sich über den Alias f1 -> prizes bei jeder Runde und ändert keine eigenen Gewinne
  // (Prüfung #2059 im Web, zuTunNachladen). Gewinne holt das Herunterziehen und jedes andere Nachladen mit.
  useLiveRefresh(reload, ["account/invoices", "membership", "documents"], { fallbackMs: 60000 });
  return { ...state, reload };
}

function EigenerBereich() {
  const { user, refreshMe } = useAuth();
  const navigation = useContext(NavigationContext) as unknown as LooseNavigation | undefined;
  const mitglied = siehtVerein(user);
  const gruppen = useMemo(() => gruppenFuer({ mitglied }).filter((item) => item.key !== "start"), [mitglied]);
  const todo = useZuTun(user as Record<string, unknown> | null, mitglied);
  const offen = useMemo(() => offenJeGruppe(todo.items), [todo.items]);
  const [suche, setSuche] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const sucht = suchWoerter(suche).length > 0;
  const treffer = useMemo(() => (sucht ? sucheEinstellungen(suche, { mitglied }) : []), [mitglied, suche, sucht]);

  const open = (to: string) => { navigateToUrl(to); };
  const openGruppe = (key: Gruppe["key"]) => navigation?.navigate("MeinBereichGruppe", { gruppe: key });
  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([refreshMe(), todo.reload()]);
    setRefreshing(false);
  };

  return (
    <Screen padded={false}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.cyan} />}
        testID="mein-bereich"
      >
        <TabHeader title="Mein Bereich" testID="mein-bereich-header" />
        <Identitaet user={user} onPress={() => navigation?.navigate("OwnProfile")} />

        <Suchfeld value={suche} onChange={setSuche} />

        {sucht ? (
          <Treffer key="treffer" items={treffer} anfrage={suche} onOpen={(item) => open(einstellungZiel(item))} />
        ) : (
          <View style={styles.sections} testID="mein-bereich-start">
            <View style={styles.section} testID="mein-bereich-todo">
              <Muted style={styles.sectionTitle} accessibilityRole="header">Zu tun</Muted>
              {!todo.loaded ? (
                <View style={styles.todoSkeleton} accessibilityLabel="Zu tun wird geladen" testID="mein-bereich-todo-loading" />
              ) : todo.items.length ? (
                <StaggerIn style={styles.todoList}>
                  {todo.items.map((item) => <ZuTunKnopf key={item.key} item={item} onPress={() => open(item.to)} />)}
                </StaggerIn>
              ) : (
                <View style={styles.todoEmpty} testID="mein-bereich-todo-empty">
                  <Ionicons name="checkmark-circle" color={colors.success} size={18} />
                  <Body style={styles.flex}>Alles erledigt – gerade ist nichts offen.</Body>
                </View>
              )}
            </View>

            <View style={styles.section} testID="mein-bereich-schnell">
              <Muted style={styles.sectionTitle} accessibilityRole="header">Häufig gebraucht</Muted>
              <StaggerIn style={styles.tiles} itemStyle={wide ? styles.tileItemWide : styles.tileItem}>
                {schnellwege({ mitglied }).map((item) => (
                  <Press key={item.key} onPress={() => open(item.to)} accessibilityRole="button" style={styles.tile} testID={`mein-bereich-schnell-${item.key}`}>
                    <Ionicons name={SCHNELL_ICONS[item.key] || "ellipse-outline"} color={item.key === "loeschung" ? colors.muted : colors.cyan} size={22} />
                    <Body style={styles.tileLabel} numberOfLines={2}>{item.label}</Body>
                  </Press>
                ))}
              </StaggerIn>
            </View>

            <View style={styles.section}>
              <Muted style={styles.sectionTitle} accessibilityRole="header">Alle Bereiche</Muted>
              <StaggerIn style={styles.groupList} itemStyle={wide ? styles.groupItemWide : styles.groupItem} testID="mein-bereich-liste">
                {gruppen.map((item) => (
                  <GruppenZeile key={item.key} item={item} count={offen[item.key] || 0} onPress={() => openGruppe(item.key)} />
                ))}
              </StaggerIn>
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Wer ich bin (wie die Identität im Web): Bild, Name, @Name, Mitglied - ein Tipp öffnet das eigene Profil. */
function Identitaet({ user, onPress }: { user: Record<string, any> | null; onPress: () => void }) {
  const name = String(user?.display_name || user?.username || "");
  const initials = (name || "TL").slice(0, 2).toUpperCase();
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}, dein Profil ansehen`} accessibilityHint="Öffnet dein Profil, wie andere es sehen" style={styles.identity} testID="mein-bereich-identity">
      <MediaImage uri={user?.avatar_url || undefined} style={styles.avatar} fallback={<Body style={styles.initials}>{initials}</Body>} />
      <View style={styles.flex}>
        <Body style={styles.name} numberOfLines={2} testID="mein-bereich-name">{name}</Body>
        <View style={styles.identityMeta}>
          {user?.username ? <Muted style={styles.shrink}>@{user.username}</Muted> : null}
          {user?.is_club_member ? (
            <View style={styles.memberBadge} testID="mein-bereich-member">
              <Ionicons name="ribbon-outline" color={colors.gold} size={12} />
              <Muted style={styles.memberText}>Mitglied</Muted>
            </View>
          ) : null}
        </View>
      </View>
      <Muted style={styles.identityLink}>Profil</Muted>
      <Ionicons name="chevron-forward" color={colors.muted} size={16} />
    </Press>
  );
}

function Suchfeld({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const input = useRef<TextInput>(null);
  return (
    <View style={styles.search}>
      <Ionicons name="search" color={colors.muted} size={18} />
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChange}
        placeholder="Einstellung suchen"
        placeholderTextColor={colors.muted}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        accessibilityLabel="Einstellung suchen"
        style={styles.searchInput}
        testID="mein-bereich-suche"
      />
      {value ? (
        <Pressable onPress={() => { onChange(""); input.current?.focus(); }} accessibilityRole="button" accessibilityLabel="Suche leeren" hitSlop={10} style={styles.searchClear} testID="mein-bereich-suche-leeren">
          <Ionicons name="close-circle" color={colors.muted} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Die Treffer der Suche: dieselbe Reihenfolge wie die Gruppen, beim Weitertippen wird die Liste nur kürzer. Ein Treffer,
 * der bleibt, bleibt stehen (eigener Schlüssel); ein neuer blendet sanft ein (Deckkraft, 4 Punkte) - nichts springt.
 */
function Treffer({ items, anfrage, onOpen }: { items: Einstellung[]; anfrage: string; onOpen: (item: Einstellung) => void }) {
  if (!items.length) {
    return (
      <Erscheinen style={styles.noHits} testID="mein-bereich-suche-leer">
        <Ionicons name="search-outline" color={colors.muted} size={22} />
        <Body style={styles.noHitsTitle}>Nichts gefunden zu „{anfrage.trim()}“</Body>
        <Muted style={styles.noHitsText}>Versuch ein anderes Wort – etwa Passwort, Ruhezeit oder Rechnung.</Muted>
      </Erscheinen>
    );
  }
  return (
    <View style={styles.hits} testID="mein-bereich-treffer">
      <Muted style={styles.sectionTitle} accessibilityLiveRegion="polite" testID="mein-bereich-treffer-zahl">{items.length === 1 ? "1 Treffer" : `${items.length} Treffer`}</Muted>
      <View style={styles.hitList}>
        {items.map((item, index) => (
          <Erscheinen key={`${item.gruppe}:${item.ziel}`} delay={Math.min(index, 6) * 25}>
            <Press onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={`${item.label}, ${gruppeMeta(item.gruppe)?.label || ""}`} style={[styles.hit, index > 0 && styles.hitBorder]} testID={`mein-bereich-treffer-${item.gruppe}-${item.ziel}`}>
              <Ionicons name={gruppeMeta(item.gruppe)?.icon || "ellipse-outline"} color={colors.cyan} size={18} />
              <View style={styles.flex}>
                <Body style={styles.strong} numberOfLines={2}>{item.label}</Body>
                <Muted numberOfLines={2}>{gruppeMeta(item.gruppe)?.label}{item.detail ? ` · ${item.detail}` : ""}</Muted>
              </View>
              <Ionicons name="chevron-forward" color={colors.muted} size={16} />
            </Press>
          </Erscheinen>
        ))}
      </View>
    </View>
  );
}

/** Blendet beim ersten Zeichnen ein und rückt 4 Punkte nach oben - danach steht es still. Ohne Bewegung: sofort da. */
function Erscheinen({ children, delay = 0, style, testID }: { children: React.ReactNode; delay?: number; style?: object; testID?: string }) {
  const reduce = useReduceMotion();
  const [start] = useState(() => (reduce ? 1 : 0));
  const shown = useSharedValue(start);
  useEffect(() => {
    if (start === 1) return;
    shown.set(withDelay(delay, withTiming(1, { duration: motion.mid, easing: EASE })));
    // Nur beim ersten Zeichnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const animated = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: (1 - shown.get()) * 4 }] }));
  return <Animated.View style={[style, animated]} testID={testID}>{children}</Animated.View>;
}

function ZuTunKnopf({ item, onPress }: { item: ZuTunItem; onPress: () => void }) {
  const warn = item.tone === "warn";
  return (
    <Press onPress={onPress} accessibilityRole="button" style={[styles.todo, warn && styles.todoWarn]} testID={`mein-bereich-todo-${item.key}`}>
      {/* Wie im Web: was drängt (überfällig, Beitrag, Zwei-Faktor), leuchtet beim Öffnen einmal golden auf. */}
      {warn ? <Glow active tone="honor" radius={radius.lg} /> : null}
      <View style={styles.flex}>
        <Body style={[styles.todoTitle, warn && styles.todoTitleWarn]}>{item.label}</Body>
        {item.detail ? <Muted>{item.detail}</Muted> : null}
      </View>
      <Ionicons name="arrow-forward" color={warn ? colors.gold : colors.cyan} size={18} />
    </Press>
  );
}

function GruppenZeile({ item, count, onPress }: { item: Gruppe; count: number; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count ? `${item.label}, ${offenText(count)}` : item.label}
      style={styles.groupRow}
      testID={`mein-bereich-liste-${item.key}`}
    >
      <View style={styles.groupIcon}><Ionicons name={item.icon} color={colors.cyan} size={18} /></View>
      <View style={styles.flex}>
        <Body style={styles.strong}>{item.label}</Body>
        <Muted numberOfLines={2}>{item.text}</Muted>
      </View>
      {count ? <View style={styles.count}><Body style={styles.countText}>{offenText(count)}</Body></View> : null}
      <Ionicons name="chevron-forward" color={colors.muted} size={16} />
    </Press>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 36,
  },
  flex: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  shrink: {
    flexShrink: 1,
  },
  strong: {
    fontWeight: "800",
  },
  guestWrap: {
    alignItems: "stretch",
    gap: 12,
  },
  guestIcon: {
    alignItems: "center",
  },
  guestTitle: {
    textAlign: "center",
  },
  guestText: {
    textAlign: "center",
  },
  identity: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    overflow: "hidden",
    width: 48,
  },
  initials: {
    color: colors.cyan,
    fontWeight: "900",
  },
  name: {
    fontSize: 17,
    fontWeight: "900",
  },
  identityMeta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  memberBadge: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  memberText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
  },
  identityLink: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  search: {
    alignItems: "center",
    backgroundColor: "#050505",
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingLeft: 12,
  },
  searchInput: {
    color: colors.white,
    flex: 1,
    fontSize: 16,
    minHeight: 46,
    paddingVertical: 10,
  },
  searchClear: {
    alignItems: "center",
    height: 46,
    justifyContent: "center",
    width: 44,
  },
  sections: {
    gap: 24,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  todoSkeleton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 64,
  },
  todoList: {
    gap: 10,
  },
  todo: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(41,182,232,0.35)",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  todoWarn: {
    borderColor: "rgba(255,215,0,0.45)",
  },
  todoTitle: {
    fontSize: 16,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  todoTitleWarn: {
    color: colors.gold,
  },
  todoEmpty: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tileItem: {
    flexBasis: "30%",
    flexGrow: 1,
    minWidth: 96,
  },
  tileItemWide: {
    flexBasis: "18%",
    flexGrow: 1,
    minWidth: 120,
  },
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 8,
    justifyContent: "space-between",
    minHeight: 88,
    padding: 12,
  },
  tileLabel: {
    fontSize: 13,
    fontWeight: "900",
  },
  groupList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  groupItem: {
    width: "100%",
  },
  groupItemWide: {
    flexBasis: "48%",
    flexGrow: 1,
  },
  groupRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: "100%",
  },
  groupIcon: {
    alignItems: "center",
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  count: {
    backgroundColor: colors.gold,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    color: colors.black,
    fontSize: 11,
    fontWeight: "900",
  },
  hits: {
    gap: 10,
  },
  hitList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  hit: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  hitBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  noHits: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 24,
  },
  noHitsTitle: {
    fontWeight: "900",
    textAlign: "center",
  },
  noHitsText: {
    textAlign: "center",
  },
});
