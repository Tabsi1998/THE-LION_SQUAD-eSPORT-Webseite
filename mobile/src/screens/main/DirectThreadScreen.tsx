import React, { useCallback } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChatThreadView } from "../../components/ChatThreadView";
import { Screen } from "../../components/Screen";
import { useAuth } from "../../auth/AuthContext";
import type { MoreStackParamList } from "../../navigation/types";
import type { ChatMessage, DirectThread } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "DirectThread">;

export function DirectThreadScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const extractMessages = useCallback((data: unknown): ChatMessage[] => {
    return Array.isArray((data as DirectThread)?.messages) ? (data as DirectThread).messages : [];
  }, []);
  const canSend = useCallback((data: unknown) => (data as DirectThread)?.can_send !== false, []);

  return (
    <Screen padded={false} bottomSafe>
      <ChatThreadView
        currentUserId={user?.id}
        emptyTitle="Noch keine Direktnachrichten"
        extractMessages={extractMessages}
        canSend={canSend}
        listUrl={`/messages/direct/${route.params.userId}`}
        onOpenProfile={(username) => navigation.navigate("PublicProfile", { username })}
        postUrl={`/messages/direct/${route.params.userId}`}
      />
    </Screen>
  );
}
