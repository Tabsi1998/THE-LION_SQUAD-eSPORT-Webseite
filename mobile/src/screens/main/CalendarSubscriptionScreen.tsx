import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../../components/Button";
import { PersonalFeedCard } from "../../components/calendar/PersonalFeedCard";
import { Screen } from "../../components/Screen";
import { SignInRequired } from "../../components/SignInRequired";
import { Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { isGuestUser } from "../../live";
import { openTab } from "../../navigation/rootNavigation";
import type { AppStackParamList } from "../../navigation/types";

// „Mein Kalender-Abo“ (#1788): der feste Eintrag in den Einstellungen und das Ziel des Hinweises nach einer Anmeldung.
// Derselbe Kasten wie unter „Mein Kalender“ im Events-Tab - dazu der Weg zu den eigenen Terminen.

type Props = NativeStackScreenProps<AppStackParamList, "CalendarSubscription">;

export function CalendarSubscriptionScreen(_props: Props) {
  const { user } = useAuth();
  if (!user || isGuestUser(user)) {
    return (
      <Screen>
        <SignInRequired text="Melde dich an, dann holst du deine Termine automatisch in deinen Kalender." testID="calendar-subscription-login" />
      </Screen>
    );
  }
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Muted>Deine Anmeldungen, Turniere mit deinem Team, Fast Laps, Versammlungen und Schichten – automatisch in deinem Kalender.</Muted>
        <PersonalFeedCard testID="calendar-subscription" />
        <Button label="Mein Kalender ansehen" variant="secondary" onPress={() => { openTab("TournamentList", { scope: "mine" }); }} testID="calendar-subscription-mine" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 28,
  },
});
