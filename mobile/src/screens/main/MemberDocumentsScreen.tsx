import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Heading, Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { categoryLabel, formatFileSize, openDocument, type MemberDocument, type OpenDocument } from "../../lib/memberDocuments";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Vereinsdokumente (#341): Liste vom Server (schon nach Rechten gefiltert), Öffnen lädt die
// Datei mit Anmeldung in den privaten Cache und übergibt sie an den PDF-Betrachter des Geräts.

type Props = NativeStackScreenProps<MoreStackParamList, "MemberDocuments"> & { opener?: OpenDocument };

export function MemberDocumentsScreen({ opener = openDocument }: Props) {
  const { accessToken } = useAuth();
  const [docs, setDocs] = useState<MemberDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<MemberDocument[]>("/documents");
      setDocs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, "Dokumente konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const keys = Array.from(new Set(docs.map((doc) => String(doc.category || "other"))));
    return [{ key: "all", label: "Alle" }, ...keys.map((key) => ({ key, label: categoryLabel(key) }))];
  }, [docs]);
  const visible = useMemo(() => (category === "all" ? docs : docs.filter((doc) => String(doc.category || "other") === category)), [category, docs]);

  const open = async (doc: MemberDocument) => {
    if (!accessToken || busyId) return;
    setBusyId(doc.id);
    setOpenErrors((current) => ({ ...current, [doc.id]: "" }));
    try {
      await opener(doc, accessToken);
    } catch (err) {
      setOpenErrors((current) => ({ ...current, [doc.id]: errorMessage(err, "Das Dokument konnte nicht geöffnet werden.") }));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} hasImage={false} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
      >
        <View style={styles.header}>
          <Heading>Vereinsdokumente</Heading>
          <Muted>{error || "Statuten, Protokolle, Formulare – nur für Mitglieder. Geöffnete Dateien bleiben nur in der App und werden beim Abmelden gelöscht."}</Muted>
        </View>

        {categories.length > 2 ? <SegmentedTabs items={categories} value={category} onChange={setCategory} /> : null}

        {visible.length ? (
          visible.map((doc) => {
            const busy = busyId === doc.id;
            const failure = openErrors[doc.id];
            return (
              <Pressable
                key={doc.id}
                onPress={() => open(doc)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`${doc.title || "Dokument"} öffnen`}
                testID={`document-${doc.id}`}
                style={({ pressed }) => [styles.doc, doc.pinned && styles.pinned, pressed && styles.pressed]}
              >
                <Ionicons name={busy ? "hourglass-outline" : "document-text-outline"} color={colors.gold} size={22} />
                <View style={styles.docText}>
                  <Body style={styles.docTitle}>{doc.title || doc.original_filename || "Dokument"}</Body>
                  <Muted>
                    {[categoryLabel(doc.category), doc.visibility === "internal" ? "Vorstand" : "", formatFileSize(doc.file_size), doc.updated_at || doc.created_at ? formatDate(doc.updated_at || doc.created_at) : ""].filter(Boolean).join(" · ")}
                  </Muted>
                  {doc.description ? <Muted numberOfLines={2}>{doc.description}</Muted> : null}
                  {failure ? <Muted style={styles.error} testID={`document-error-${doc.id}`}>{failure}</Muted> : null}
                </View>
                <Ionicons name="open-outline" color={colors.muted} size={16} />
              </Pressable>
            );
          })
        ) : (
          <EmptyState icon="folder-open-outline" tone="gold" title="Keine Dokumente" detail={error ? "Bitte später noch einmal versuchen." : "Sobald der Verein Dokumente freigibt, stehen sie hier."} />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    padding: 18,
    paddingBottom: 32,
  },
  header: {
    gap: 6,
  },
  doc: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  pinned: {
    borderColor: "rgba(255, 215, 0, 0.4)",
  },
  docText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  docTitle: {
    fontWeight: "900",
  },
  error: {
    color: colors.live,
  },
  pressed: {
    opacity: 0.72,
  },
});
