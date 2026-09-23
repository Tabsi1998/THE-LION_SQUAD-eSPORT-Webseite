import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { errorMessage } from "../lib/api";
import { REPORT_CATEGORIES, detailsValid, sendReport, type ReportDraft } from "../lib/moderation";
import { colors } from "../theme";
import { Button } from "./Button";
import { Heading, Muted } from "./Text";

// Meldung an die Moderation (#414): Grund wählen, kurz beschreiben, senden. Wer gemeldet wurde,
// erfährt nichts davon; die Moderation sieht die Meldung unter Admin → Moderation.

export function ReportSheet({ draft, onClose, onSent }: {
  /** null = zu; sonst wer gemeldet wird und ggf. welche Nachricht. */
  draft: (Omit<ReportDraft, "category" | "details"> & { targetName?: string }) | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [category, setCategory] = useState("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = Boolean(draft);

  useEffect(() => {
    if (!visible) return;
    setCategory("harassment");
    setDetails("");
    setError("");
  }, [visible]);

  const submit = async () => {
    if (!draft || busy || !detailsValid(details)) return;
    setBusy(true);
    setError("");
    try {
      await sendReport({ ...draft, category, details });
      onSent?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Meldung konnte nicht gesendet werden."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="report-sheet">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Heading>{draft?.message ? "Nachricht melden" : "Benutzer melden"}</Heading>
            <Muted>
              {draft?.targetName ? `${draft.targetName} · ` : ""}Die Moderation prüft die Meldung. Die gemeldete Person erfährt nichts davon.
            </Muted>
            {draft?.message?.message ? <Muted style={styles.quote} numberOfLines={3}>„{draft.message.message}“</Muted> : null}
            <View style={styles.chips}>
              {REPORT_CATEGORIES.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => setCategory(item.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: category === item.key }}
                  style={[styles.chip, category === item.key && styles.chipActive]}
                  testID={`report-category-${item.key}`}
                >
                  <Muted style={[styles.chipText, category === item.key && styles.chipTextActive]}>{item.label}</Muted>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={details}
              onChangeText={setDetails}
              multiline
              numberOfLines={4}
              maxLength={2000}
              placeholder="Was ist passiert? Sachlich und kurz."
              placeholderTextColor={colors.muted}
              style={styles.input}
              testID="report-details"
            />
            {error ? <Muted style={styles.error}>{error}</Muted> : null}
            <View style={styles.actions}>
              <Button label="Abbrechen" variant="secondary" onPress={onClose} disabled={busy} />
              <Button label={busy ? "Sendet ..." : "Meldung senden"} onPress={() => { void submit(); }} disabled={busy || !detailsValid(details)} testID="report-submit" />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.62)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: 1,
    maxHeight: "88%",
  },
  content: {
    gap: 12,
    padding: 18,
    paddingBottom: 28,
  },
  quote: {
    borderLeftColor: colors.border,
    borderLeftWidth: 2,
    paddingLeft: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: "rgba(41, 182, 232, 0.16)",
    borderColor: colors.cyan,
  },
  chipText: {
    fontWeight: "800",
  },
  chipTextActive: {
    color: colors.cyan,
  },
  input: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.white,
    minHeight: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  actions: {
    gap: 8,
  },
  error: {
    color: colors.live,
  },
});

export type { ReportDraft };
