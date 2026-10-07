import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { forgetSearch, loadRecentSearches, MIN_SEARCH_LENGTH, rememberSearch, clearRecentSearches } from "../../lib/recentSearches";
import { openTarget, targetFromUrl } from "../../navigation/rootNavigation";
import type { AppStackParamList, LooseNavigation } from "../../navigation/types";
import { colors } from "../../theme";

// Die Lupe (#1145): dieselbe Suche wie auf der Website (`/api/search`, gleiche Anfrage, gleiche Rechte - Gäste finden
// Öffentliches, Mitglieder zusätzlich Internes). Ab dem zweiten Buchstaben, Treffer nach Art gruppiert; ein Treffer
// öffnet im aktuellen Tab (#1144). Die letzten fünf Suchen merkt sich das Gerät, Abmelden löscht sie.

type Props = NativeStackScreenProps<AppStackParamList, "Search">;

export type SearchItem = { kind: string; title: string; url: string; subtitle?: string; date?: string; image?: string };

const KIND_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  tournament: { label: "Turniere", icon: "trophy-outline" },
  event: { label: "Events", icon: "calendar-outline" },
  news: { label: "News", icon: "newspaper-outline" },
  player: { label: "Spieler", icon: "person-outline" },
  team: { label: "Teams", icon: "people-outline" },
};

/** Treffer nach Art, in der Reihenfolge, in der der Server sie schickt - wie auf der Website. */
export function groupSearchItems(items: SearchItem[]): Array<[string, SearchItem[]]> {
  const map = new Map<string, SearchItem[]>();
  items.forEach((item) => {
    const key = item.kind || "other";
    map.set(key, [...(map.get(key) || []), item]);
  });
  return [...map.entries()];
}

export function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<TextInput>(null);
  const trimmed = query.trim();

  useEffect(() => {
    let cancelled = false;
    loadRecentSearches().then((entries) => {
      if (!cancelled) setRecent(entries);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      setItems([]);
      setLoading(false);
      setError("");
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<{ items?: SearchItem[] }>("/search", { params: { q: trimmed, limit: 5 } });
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setError("");
      } catch {
        if (cancelled) return;
        setItems([]);
        setError("Suche ist gerade nicht erreichbar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  const grouped = useMemo(() => groupSearchItems(items), [items]);

  const open = useCallback((item: SearchItem) => {
    void rememberSearch(trimmed).then(setRecent);
    const target = targetFromUrl(item.url);
    if (!target) return;
    if (target.kind === "detail") (navigation as unknown as LooseNavigation).navigate(target.screen, target.params);
    else openTarget(target);
  }, [navigation, trimmed]);

  const remove = useCallback((entry: string) => {
    void forgetSearch(entry).then(setRecent);
  }, []);

  return (
    <Screen padded={false}>
      <View style={styles.bar}>
        <View style={styles.inputWrap}>
          <Ionicons name="search-outline" color={colors.cyan} size={18} />
          <TextInput
            ref={inputRef}
            autoFocus
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => { if (trimmed.length >= MIN_SEARCH_LENGTH) void rememberSearch(trimmed).then(setRecent); }}
            placeholder="Turniere, Events, News, Spieler, Teams"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Suchbegriff"
            testID="search-input"
          />
          {query ? (
            <Pressable onPress={() => { setQuery(""); inputRef.current?.focus(); }} accessibilityRole="button" accessibilityLabel="Eingabe löschen" hitSlop={8}>
              <Ionicons name="close-circle" color={colors.muted} size={18} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" hitSlop={8} testID="search-cancel">
          <Body style={styles.cancel}>Abbrechen</Body>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {trimmed.length < MIN_SEARCH_LENGTH ? (
          <View style={styles.section} testID="search-recent">
            {recent.length ? (
              <>
                <View style={styles.sectionHead}>
                  <Muted style={styles.kind}>Letzte Suchen</Muted>
                  <Pressable onPress={() => { void clearRecentSearches().then(() => setRecent([])); }} accessibilityRole="button" hitSlop={8} testID="search-recent-clear">
                    <Muted style={styles.clear}>Alle löschen</Muted>
                  </Pressable>
                </View>
                {recent.map((entry) => (
                  <View key={entry} style={styles.recentRow}>
                    <Pressable onPress={() => setQuery(entry)} accessibilityRole="button" style={({ pressed }) => [styles.recentMain, pressed && styles.pressed]} testID={`search-recent-${entry}`}>
                      <Ionicons name="time-outline" color={colors.muted} size={16} />
                      <Body style={styles.recentText} numberOfLines={1}>{entry}</Body>
                    </Pressable>
                    <Pressable onPress={() => remove(entry)} accessibilityRole="button" accessibilityLabel={`„${entry}“ aus den letzten Suchen löschen`} hitSlop={8} testID={`search-recent-remove-${entry}`}>
                      <Ionicons name="close" color={colors.muted} size={16} />
                    </Pressable>
                  </View>
                ))}
              </>
            ) : (
              <Muted testID="search-hint">Ab zwei Buchstaben suchst du in Turnieren, Events, News, Spielern und Teams.</Muted>
            )}
          </View>
        ) : loading && !items.length ? (
          <Muted style={styles.state} testID="search-loading">Suche läuft …</Muted>
        ) : error ? (
          <Muted style={[styles.state, styles.error]} testID="search-error">{error}</Muted>
        ) : grouped.length ? (
          grouped.map(([kind, rows]) => (
            <View key={kind} style={styles.section} testID={`search-group-${kind}`}>
              <Muted style={styles.kind}>{KIND_META[kind]?.label || "Treffer"}</Muted>
              {rows.map((item) => (
                <Pressable key={`${item.kind}:${item.url}`} onPress={() => open(item)} accessibilityRole="button" style={({ pressed }) => [styles.result, pressed && styles.pressed]} testID={`search-result-${item.url}`}>
                  <View style={styles.resultIcon}>
                    {item.image ? (
                      <MediaImage uri={item.image} style={styles.resultImage} fallback={<Ionicons name={KIND_META[item.kind]?.icon || "search-outline"} color={colors.cyan} size={18} />} />
                    ) : (
                      <Ionicons name={KIND_META[item.kind]?.icon || "search-outline"} color={colors.cyan} size={18} />
                    )}
                  </View>
                  <View style={styles.resultText}>
                    <Highlighted text={item.title} query={trimmed} />
                    {item.subtitle || item.date ? <Muted numberOfLines={1}>{[item.subtitle, item.date ? formatDate(item.date) : ""].filter(Boolean).join(" · ")}</Muted> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ))
        ) : (
          <Muted style={styles.state} testID="search-empty">Keine Treffer gefunden.</Muted>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Der Titel, das Gesuchte darin hervorgehoben. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || index < 0) return <Body style={styles.resultTitle} numberOfLines={1}>{text}</Body>;
  return (
    <Body style={styles.resultTitle} numberOfLines={1}>
      {text.slice(0, index)}
      <Body style={[styles.resultTitle, styles.match]}>{text.slice(index, index + query.length)}</Body>
      {text.slice(index + query.length)}
    </Body>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  inputWrap: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(41,182,232,0.45)",
    borderRadius: 22,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  input: {
    color: colors.white,
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
  },
  cancel: {
    color: colors.cyan,
    fontWeight: "700",
  },
  content: {
    gap: 18,
    paddingBottom: 32,
    paddingHorizontal: 18,
  },
  section: {
    gap: 6,
  },
  sectionHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  kind: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  clear: {
    color: colors.cyan,
    fontWeight: "700",
  },
  recentRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
  },
  recentMain: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
  },
  recentText: {
    flex: 1,
  },
  result: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
  },
  resultIcon: {
    alignItems: "center",
    backgroundColor: "rgba(41,182,232,0.1)",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    overflow: "hidden",
    width: 38,
  },
  resultImage: {
    height: 38,
    width: 38,
  },
  resultText: {
    flex: 1,
    gap: 2,
  },
  resultTitle: {
    fontWeight: "800",
  },
  match: {
    color: colors.cyan,
  },
  state: {
    paddingVertical: 24,
    textAlign: "center",
  },
  error: {
    color: colors.live,
  },
  pressed: {
    opacity: 0.72,
  },
});
