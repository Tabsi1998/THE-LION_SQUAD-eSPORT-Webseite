import React, { useState } from "react";
import { Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChatThreadView } from "../../components/ChatThreadView";
import { ErrorState } from "../../components/ListState";
import { ReportSheet, type ReportDraft } from "../../components/ReportSheet";
import { Screen } from "../../components/Screen";
import { useAuth } from "../../auth/AuthContext";
import { idSegment, isValidId } from "../../lib/apiIds";
import { senderOf } from "../../lib/moderation";
import type { TournamentStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentChat">;

export function TournamentChatScreen({ route }: Props) {
  const { user } = useAuth();
  // Lange auf eine Nachricht drücken meldet sie (#414); im Gruppenchat geht der Text mit, keine message_id.
  const [report, setReport] = useState<(Omit<ReportDraft, "category" | "details"> & { targetName?: string }) | null>(null);
  // Die Kennung kommt aus der Adresse (#1512): nur als ein geprüfter Pfadteil in die API, sonst „nicht gefunden“.
  const segment = isValidId(route.params.id) ? idSegment(route.params.id) : null;
  if (!segment) {
    return (
      <Screen>
        <ErrorState title="Turnier-Chat nicht gefunden" detail="Dieses Turnier gibt es nicht (mehr) oder es ist nicht sichtbar." problem={{ kind: "notFound", message: "" }} testID="chat-not-found" />
      </Screen>
    );
  }
  return (
    <Screen padded={false} bottomSafe>
      <ChatThreadView
        currentUserId={user?.id}
        emptyTitle="Noch keine Turniernachrichten"
        lockedDetail="Turnier-Chat ist nur sichtbar, wenn er freigeschaltet ist und du teilnehmen darfst."
        listUrl={`/tournaments/${segment}/chat`}
        onReportMessage={(message) => {
          const sender = senderOf(message);
          if (sender) setReport({ targetUserId: sender.id, targetName: sender.name, message });
        }}
        read={{ kind: "tournament", id: route.params.id }}
        postUrl={`/tournaments/${segment}/chat`}
      />
      <ReportSheet draft={report} onClose={() => setReport(null)} onSent={() => Alert.alert("Danke", "Die Moderation sieht sich das an.")} />
    </Screen>
  );
}
