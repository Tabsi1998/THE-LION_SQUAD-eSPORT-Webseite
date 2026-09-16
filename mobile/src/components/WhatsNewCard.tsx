import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";
import { whatsNewTitle, type WhatsNew } from "../lib/whatsnew";
import { Body, Muted, Title } from "./Text";

// „Was ist neu“ (#249): eine Karte mit den Punkten der Version, einmal nach
// dem Update und jederzeit unter Mehr.
type Props = { entry: WhatsNew; visible: boolean; onClose: () => void };

export function WhatsNewCard({ entry, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { marginTop: insets.top + 24, marginBottom: insets.bottom + 24 }]} testID="whats-new-card">
          <View style={styles.header}>
            <Ionicons name="sparkles" size={22} color={colors.cyan} />
            <View style={styles.headerText}>
              <Title style={styles.title}>{whatsNewTitle(entry)}</Title>
              {entry.date ? <Muted>{entry.date.split("-").reverse().join(".")}</Muted> : null}
            </View>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {entry.items.map((item, index) => (
              <View key={`${index}-${item.slice(0, 16)}`} style={styles.item}>
                <Ionicons name="checkmark-circle" size={16} color={colors.cyan} style={styles.itemIcon} />
                <Body style={styles.itemText}>{item}</Body>
              </View>
            ))}
            {!entry.items.length ? <Muted>Keine Änderungen eingetragen.</Muted> : null}
          </ScrollView>
          <Pressable onPress={onClose} accessibilityRole="button" testID="whats-new-close" style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Body style={styles.buttonText}>Verstanden</Body>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.78)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: "rgba(41,182,232,0.45)",
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: "80%",
    padding: 18,
    width: "100%",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 20,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 10,
    paddingBottom: 4,
  },
  item: {
    flexDirection: "row",
    gap: 10,
  },
  itemIcon: {
    marginTop: 3,
  },
  itemText: {
    flex: 1,
    lineHeight: 21,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 8,
    marginTop: 16,
    paddingVertical: 12,
  },
  buttonText: {
    color: colors.black,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  pressed: {
    opacity: 0.85,
  },
});
