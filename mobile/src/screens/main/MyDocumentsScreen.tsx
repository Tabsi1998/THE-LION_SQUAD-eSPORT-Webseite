import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { categoryLabel, formatFileSize, openDocument, type OpenDocument, type OwnDocuments } from "../../lib/memberDocuments";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Deine Unterlagen (#1255): die eigenen Schreiben aus der Vereinsakte (Bestätigungen, Spendenbestätigung) - aus „Nur für
// dich“ im Profil. Öffnen wie bei den Vereinsdokumenten: mit Anmeldung in den privaten Cache, dann der PDF-Betrachter
// des Geräts. Ohne Bindung der Weg über den Einladungscode (als Satz - „Meine Mitgliedschaft“ hat ihren einen Ort im Tab
// „Verein“); antwortet die Akte nicht, steht das da.

type Props = NativeStackScreenProps<MoreStackParamList, "MyDocuments"> & { opener?: OpenDocument };

const FALLBACK: OwnDocuments = { available: false, reason: "error", text: "Deine Unterlagen konnten nicht geladen werden. Bitte später noch einmal versuchen.", documents: [] };

export function emptyTitle(state: OwnDocuments): string {
  if (state.available) return "Noch keine Unterlagen";
  return ["unreachable", "no_access", "error"].includes(String(state.reason || "")) ? "Gerade nicht abrufbar" : "Keine Unterlagen";
}

export function emptyDetail(state: OwnDocuments): string {
  if (state.reason === "not_bound") {
    return "Dein Konto ist noch nicht mit deinem Eintrag in der Vereinsakte verbunden. Das geht über die bestätigte E-Mail-Adresse, durch den Vorstand – oder mit einem Einladungscode unter Verein → Mitgliedschaft.";
  }
  return state.text || "Bestätigungen und Schreiben vom Verein erscheinen hier, sobald der Vorstand sie in der Vereinsakte für dich ablegt.";
}

export function MyDocumentsScreen({ opener = openDocument }: Props) {
  const { accessToken } = useAuth();
  const [state, setState] = useState<OwnDocuments | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<OwnDocuments>("/account/documents");
      setState(data && typeof data === "object" ? { ...data, documents: Array.isArray(data.documents) ? data.documents : [] } : FALLBACK);
    } catch {
      setState(FALLBACK);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (doc: OwnDocuments["documents"][number]) => {
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

  if (!state) {
    return (
      <Screen>
        <SkeletonList count={3} hasImage={false} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.gold} />}
      >
        <View style={styles.header}>
          <Heading>Deine Unterlagen</Heading>
          <Muted>Bestätigungen und Schreiben aus der Vereinsakte – nur für dich. Die Vereinsdokumente für alle stehen im Tab „Verein“.</Muted>
        </View>

        {state.documents.length ? (
          state.documents.map((doc) => {
            const busy = busyId === doc.id;
            const failure = openErrors[doc.id];
            return (
              <Pressable
                key={doc.id}
                onPress={() => { void open(doc); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`${doc.title || "Dokument"} öffnen`}
                testID={`my-document-${doc.id}`}
                style={({ pressed }) => [styles.doc, pressed && styles.pressed]}
              >
                <Ionicons name={busy ? "hourglass-outline" : "document-text-outline"} color={colors.gold} size={22} />
                <View style={styles.docText}>
                  <Body style={styles.docTitle}>{doc.title || doc.original_filename || "Dokument"}</Body>
                  <Muted>{[categoryLabel(doc.category), formatFileSize(doc.file_size), doc.created_at ? formatDate(doc.created_at) : ""].filter(Boolean).join(" · ")}</Muted>
                  {doc.description ? <Muted numberOfLines={2}>{doc.description}</Muted> : null}
                  {failure ? <Muted style={styles.error} testID={`my-document-error-${doc.id}`}>{failure}</Muted> : null}
                </View>
                <Ionicons name="open-outline" color={colors.muted} size={16} />
              </Pressable>
            );
          })
        ) : (
          <View testID="my-documents-empty">
            <EmptyState icon="folder-open-outline" tone="gold" title={emptyTitle(state)} detail={emptyDetail(state)} />
          </View>
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
