import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { DISPUTE_REASONS, type DisputeReason } from "../../lib/disputeReasons";
import { formatDateTime } from "../../lib/format";
import { colors } from "../../theme";
import { Button } from "../Button";
import { Muted } from "../Text";
import { ProofPhotoPicker, type ProofPhoto } from "./ProofPhotoPicker";

// „Problem melden“ (#1158) wie auf der Website: Grund antippen, kurz beschreiben, auf Wunsch ein Foto (Kamera oder
// Galerie). Die Turnierleitung bekommt es sofort und entscheidet; die Gegenseite erfährt nur, dass geprüft wird.

export type ProblemPayload = { reason: string; category: DisputeReason; photo_id: string | null };

export function ProblemReportCard({ matchId, until, busy = false, initialCategory, onSubmit }: {
  matchId: string;
  until?: string | null;
  busy?: boolean;
  initialCategory?: DisputeReason | null;
  onSubmit: (payload: ProblemPayload) => Promise<boolean>;
}) {
  const [category, setCategory] = useState<DisputeReason | "">(initialCategory || "");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<ProofPhoto>(null);
  const [error, setError] = useState("");

  useEffect(() => { if (initialCategory) setCategory(initialCategory); }, [initialCategory]);

  const submit = async () => {
    if (!category) return setError("Bitte antippen, was nicht stimmt.");
    if (!text.trim()) return setError("Bitte kurz beschreiben, was nicht stimmt.");
    if (photo?.status === "uploading") return setError("Das Foto wird noch hochgeladen – einen Moment.");
    setError("");
    const done = await onSubmit({ reason: text.trim(), category, photo_id: photo?.status === "ready" && photo.id ? photo.id : null });
    if (done) {
      setText("");
      setPhoto(null);
      setCategory("");
    }
    return undefined;
  };

  return (
    <View style={styles.stack} testID="match-dispute">
      <Muted style={styles.title}>Problem melden</Muted>
      <Muted>Was stimmt nicht?</Muted>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {DISPUTE_REASONS.map(([key, label]) => (
          <Pressable key={key} accessibilityRole="radio" accessibilityState={{ selected: category === key }} onPress={() => setCategory(key)} style={[styles.chip, category === key && styles.chipOn]} testID={`match-dispute-reason-${key}`}>
            <Muted style={[styles.chipText, category === key && styles.chipTextOn]}>{label}</Muted>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={text}
        onChangeText={(value) => setText(value.slice(0, 1000))}
        multiline
        placeholder="Kurz beschreiben, z. B. „Es stand 2:1 für mich, nicht 1:2.“"
        placeholderTextColor={colors.muted}
        style={styles.input}
        accessibilityLabel="Was stimmt nicht?"
        testID="match-dispute-input"
      />
      <ProofPhotoPicker matchId={matchId} value={photo} onChange={setPhoto} testID="dispute-photo" />
      <Muted testID="match-dispute-hint">
        Die Turnierleitung bekommt sofort Bescheid, prüft und entscheidet.{until ? ` Möglich bis ${formatDateTime(until)}.` : ""}
      </Muted>
      {error ? <Muted style={styles.error} testID="match-dispute-error">{error}</Muted> : null}
      <Button label="An die Turnierleitung schicken" variant="danger" onPress={() => { void submit(); }} disabled={busy} testID="match-dispute-submit" />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderColor: "rgba(255,255,255,0.15)", borderRadius: 16, borderWidth: 1, justifyContent: "center", minHeight: 38, paddingHorizontal: 12 },
  chipOn: { backgroundColor: "rgba(41,182,232,0.16)", borderColor: colors.cyan },
  chipText: { fontWeight: "900" },
  chipTextOn: { color: colors.cyan },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  error: { color: colors.live, fontWeight: "800" },
  input: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.white, minHeight: 80, padding: 10, textAlignVertical: "top" },
  stack: { gap: 10 },
  title: { color: colors.live, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
});
