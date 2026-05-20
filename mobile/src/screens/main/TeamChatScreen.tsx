import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChatThreadView } from "../../components/ChatThreadView";
import { Screen } from "../../components/Screen";
import { useAuth } from "../../auth/AuthContext";
import type { TeamStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<TeamStackParamList, "TeamChat">;

export function TeamChatScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  return (
    <Screen padded={false} bottomSafe>
      <ChatThreadView
        currentUserId={user?.id}
        emptyTitle="Noch keine Teamnachrichten"
        lockedDetail="Team-Chat ist nur für Teammitglieder sichtbar."
        listUrl={`/teams/${route.params.id}/chat`}
        mentionSearchUrl={`/teams/${route.params.id}/mention-candidates`}
        onOpenProfile={(username) => navigation.getParent()?.navigate("More", { screen: "PublicProfile", params: { username } })}
        postUrl={`/teams/${route.params.id}/chat`}
      />
    </Screen>
  );
}
