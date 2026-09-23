import React, { useState } from "react";
import { Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChatThreadView } from "../../components/ChatThreadView";
import { ReportSheet, type ReportDraft } from "../../components/ReportSheet";
import { Screen } from "../../components/Screen";
import { useAuth } from "../../auth/AuthContext";
import { senderOf } from "../../lib/moderation";
import type { TournamentStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentChat">;

export function TournamentChatScreen({ route }: Props) {
  const { user } = useAuth();
  // Lange auf eine Nachricht drücken meldet sie (#414); im Gruppenchat geht der Text mit, keine message_id.
  const [report, setReport] = useState<(Omit<ReportDraft, "category" | "details"> & { targetName?: string }) | null>(null);
  return (
    <Screen padded={false} bottomSafe>
      <ChatThreadView
        currentUserId={user?.id}
        emptyTitle="Noch keine Turniernachrichten"
        lockedDetail="Turnier-Chat ist nur sichtbar, wenn er freigeschaltet ist und du teilnehmen darfst."
        listUrl={`/tournaments/${route.params.id}/chat`}
        onReportMessage={(message) => {
          const sender = senderOf(message);
          if (sender) setReport({ targetUserId: sender.id, targetName: sender.name, message });
        }}
        postUrl={`/tournaments/${route.params.id}/chat`}
      />
      <ReportSheet draft={report} onClose={() => setReport(null)} onSent={() => Alert.alert("Danke", "Die Moderation sieht sich das an.")} />
    </Screen>
  );
}
