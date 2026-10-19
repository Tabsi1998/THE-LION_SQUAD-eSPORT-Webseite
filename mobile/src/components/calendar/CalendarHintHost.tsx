import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../Button";
import { FadeIn, useReduceMotion } from "../FadeIn";
import { Body, Muted } from "../Text";
import { markCalendarHintSeen, onCalendarHint } from "../../lib/calendarHint";
import { openDetail } from "../../navigation/rootNavigation";
import { colors, radius, roles } from "../../theme";

// Der Abo-Hinweis nach einer Anmeldung (#1788): ein ruhiger Kasten unten über der Tab-Leiste, der sich leicht anhebt -
// mit „Bewegung reduzieren“ ohne Bewegung (FadeIn). Kein Fenster, das den Screen sperrt: die Anmeldung und ein
// möglicher Freunde-Hinweis bleiben bedienbar. Er bleibt, bis man ihn schließt oder dem Weg zum Abo folgt; beim
// Erscheinen merkt ihn der Server, damit er nur einmal kommt.

const TAB_BAR = 62;

export function CalendarHintHost() {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  // Hier gefragt, nicht erst im Kasten: der Host steht schon, wenn der Hinweis kommt - so steht die Antwort fest und
  // mit „Bewegung reduzieren“ bewegt sich auch kein erstes Bild.
  const reduce = useReduceMotion();

  useEffect(() => onCalendarHint(() => {
    setOpen(true);
    void markCalendarHintSeen();
  }), []);

  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <View pointerEvents="box-none" style={[styles.layer, { bottom: TAB_BAR + insets.bottom + 12 }]}>
      <Rise still={reduce}>
        <View style={styles.box} accessibilityRole="summary" accessibilityLabel="Hinweis: Deine Termine automatisch im Kalender?" testID="calendar-hint">
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Hinweis schließen" hitSlop={8} style={styles.close} testID="calendar-hint-close">
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
          <View style={styles.row}>
            <Ionicons name="calendar-outline" size={20} color={roles.honor} />
            <View style={styles.text}>
              <Body style={styles.title}>Deine Termine automatisch im Kalender?</Body>
              <Muted>Einmal abonnieren – danach erscheint jede Anmeldung von selbst in Google, Apple oder Outlook.</Muted>
            </View>
          </View>
          <View style={styles.buttons}>
            <Button label="Einmal abonnieren" compact onPress={() => { close(); openDetail("CalendarSubscription"); }} testID="calendar-hint-go" />
            <Button label="Nicht jetzt" variant="quiet" compact onPress={close} testID="calendar-hint-later" />
          </View>
        </View>
      </Rise>
    </View>
  );
}

function Rise({ still, children }: { still: boolean; children: React.ReactNode }) {
  return still ? <View>{children}</View> : <FadeIn>{children}</FadeIn>;
}

const styles = StyleSheet.create({
  layer: {
    left: 16,
    position: "absolute",
    right: 16,
  },
  box: {
    backgroundColor: "rgba(18,18,18,0.97)",
    borderColor: "rgba(255,215,0,0.4)",
    borderRadius: radius.lg,
    borderWidth: 1,
    elevation: 8,
    gap: 12,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
  },
  close: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 2,
    top: 2,
    width: 44,
    zIndex: 1,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    paddingRight: 32,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontWeight: "900",
  },
  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
