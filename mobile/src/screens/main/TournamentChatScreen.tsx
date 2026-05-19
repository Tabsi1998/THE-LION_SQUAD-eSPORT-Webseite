import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChatThreadView } from "../../components/ChatThreadView";
import { Screen } from "../../components/Screen";
import { useAuth } from "../../auth/AuthContext";
import type { TournamentStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentChat">;

export function TournamentChatScreen({ route }: Props) {
  const { user } = useAuth();
  return (
    <Screen padded={false} bottomSafe>
      <ChatThreadView
        currentUserId={user?.id}
        emptyTitle="Noch keine Turniernachrichten"
        lockedDetail="Turnier-Chat ist nur sichtbar, wenn er freigeschaltet ist und du teilnehmen darfst."
        listUrl={`/tournaments/${route.params.id}/chat`}
        postUrl={`/tournaments/${route.params.id}/chat`}
      />
    </Screen>
  );
}
