import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet } from "react-native";
import { ChatThreadView } from "../../components/ChatThreadView";
import { ReportSheet, type ReportDraft } from "../../components/ReportSheet";
import { Screen } from "../../components/Screen";
import { useAuth } from "../../auth/AuthContext";
import { errorMessage } from "../../lib/api";
import { blockUser, unblockUser } from "../../lib/moderation";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ChatMessage, DirectThread } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "DirectThread">;
type ThreadPayload = DirectThread & { blocked_by_me?: boolean };

// Direktnachricht: oben rechts das Menü mit „Melden“ und „Blockieren“ (#414) - dieselben
// Aufrufe wie auf der Website. Lange auf eine Nachricht drücken meldet genau diese.

export function DirectThreadScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const otherId = route.params.userId;
  const [otherName, setOtherName] = useState(route.params.title || "");
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [report, setReport] = useState<(Omit<ReportDraft, "category" | "details"> & { targetName?: string }) | null>(null);

  const extractMessages = useCallback((data: unknown): ChatMessage[] => {
    return Array.isArray((data as DirectThread)?.messages) ? (data as DirectThread).messages : [];
  }, []);
  const canSend = useCallback((data: unknown) => (data as DirectThread)?.can_send !== false, []);
  const onData = useCallback((data: unknown) => {
    const payload = data as ThreadPayload;
    setBlockedByMe(Boolean(payload?.blocked_by_me));
    const name = payload?.user?.display_name || payload?.user?.username;
    if (name) setOtherName(name);
  }, []);

  const toggleBlock = useCallback(() => {
    const run = async () => {
      try {
        if (blockedByMe) await unblockUser(otherId);
        else await blockUser(otherId);
        setBlockedByMe(!blockedByMe);
        setRefreshToken((value) => value + 1);
      } catch (err) {
        Alert.alert("Das hat nicht geklappt", errorMessage(err, "Blockierung konnte nicht geändert werden."));
      }
    };
    if (blockedByMe) {
      void run();
      return;
    }
    Alert.alert("Benutzer blockieren?", "Direktnachrichten und Freundschaftsanfragen werden in beide Richtungen unterbunden. Du kannst das unter Profil → Privatsphäre wieder aufheben.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Blockieren", style: "destructive", onPress: () => { void run(); } },
    ]);
  }, [blockedByMe, otherId]);

  const openMenu = useCallback(() => {
    Alert.alert(otherName || "Gespräch", undefined, [
      { text: "Benutzer melden", onPress: () => setReport({ targetUserId: otherId, targetName: otherName, direct: true }) },
      { text: blockedByMe ? "Blockierung aufheben" : "Blockieren", style: blockedByMe ? "default" : "destructive", onPress: toggleBlock },
      { text: "Abbrechen", style: "cancel" },
    ]);
  }, [blockedByMe, otherId, otherName, toggleBlock]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={openMenu} accessibilityRole="button" accessibilityLabel="Melden oder blockieren" hitSlop={10} style={styles.menuButton} testID="direct-thread-menu">
          <Ionicons name="ellipsis-vertical" color={colors.cyan} size={20} />
        </Pressable>
      ),
    });
  }, [navigation, openMenu]);

  return (
    <Screen padded={false} bottomSafe>
      <ChatThreadView
        currentUserId={user?.id}
        emptyTitle="Noch keine Direktnachrichten"
        extractMessages={extractMessages}
        canSend={canSend}
        listUrl={`/messages/direct/${otherId}`}
        onOpenProfile={(username) => navigation.navigate("PublicProfile", { username })}
        onReportMessage={(message) => setReport({ targetUserId: otherId, targetName: otherName, direct: true, message })}
        onData={onData}
        refreshToken={refreshToken}
        postUrl={`/messages/direct/${otherId}`}
      />
      <ReportSheet draft={report} onClose={() => setReport(null)} onSent={() => Alert.alert("Danke", "Die Moderation sieht sich das an.")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    padding: 4,
  },
});
