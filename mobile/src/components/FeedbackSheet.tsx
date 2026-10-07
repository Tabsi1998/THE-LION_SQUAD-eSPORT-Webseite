import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import { feedbackTagPrompt, parseFeedbackTarget, STAR_LABELS, type FeedbackPrompt } from "../lib/feedback";
import { viennaDate } from "../lib/vienna";
import { useSeasonOverlay } from "../seasons/anchors";
import { colors } from "../theme";
import { Button } from "./Button";
import { Heading, Muted } from "./Text";

// Rückmeldung (#1196) in der App - wie im Web: „Wie war der FC 26 Cup?“, ein bis fünf Sterne, auf Wunsch Stichworte
// und ein Satz. Das sieht nur der Verein, ohne Namen. „Lieber nicht“ beendet die Frage für dieses Turnier bzw. Event.

export function FeedbackSheet({ target, onClose, onDone }: { target: string | null; onClose: () => void; onDone: (message: string) => void }) {
  const parsed = parseFeedbackTarget(target);
  const visible = Boolean(parsed);
  useSeasonOverlay("feedback-sheet", visible);
  const [prompt, setPrompt] = useState<FeedbackPrompt | null>(null);
  const [missing, setMissing] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [textMax, setTextMax] = useState(280);
  const [stars, setStars] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!parsed) return undefined;
    let alive = true;
    setPrompt(null);
    setMissing(false);
    setStars(0);
    setChosen([]);
    setText("");
    setError("");
    api.get<{ items?: FeedbackPrompt[]; tags?: string[]; text_max?: number }>("/feedback/open").then(({ data }) => {
      if (!alive) return;
      const item = (data?.items || []).find((row) => row.kind === parsed.kind && row.target_id === parsed.id) || null;
      setTags(Array.isArray(data?.tags) ? data.tags : []);
      setTextMax(Number(data?.text_max) || 280);
      setPrompt(item);
      setMissing(!item);
    }).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps -- parsed folgt aus target

  const send = async (decline: boolean) => {
    if (!parsed || busy) return;
    setBusy(true);
    setError("");
    try {
      if (decline) await api.post(`/feedback/${parsed.kind}/${parsed.id}/decline`);
      else await api.post(`/feedback/${parsed.kind}/${parsed.id}`, { stars, tags: chosen, text: text.trim() });
      onDone(decline ? "Alles klar – wir fragen nicht mehr." : "Danke! Das hilft beim nächsten Mal.");
    } catch (err) {
      setError(errorMessage(err, "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="feedback-sheet">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.top}>
              <View style={styles.flex}>
                {prompt ? <Muted>{viennaDate(prompt.day, { weekday: "short", day: "2-digit", month: "2-digit" })}</Muted> : null}
                <Heading style={styles.question}>{prompt?.question || (missing ? "Schon erledigt" : "Kurz bewerten")}</Heading>
                <Muted>Das sieht nur der Verein – ohne deinen Namen. Es hilft beim nächsten Mal.</Muted>
              </View>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            {missing ? (
              <Muted testID="feedback-missing">Dazu gibt es gerade nichts zu bewerten – entweder hast du schon geantwortet oder die Frage ist vorbei. Danke!</Muted>
            ) : (
              <>
                <View style={styles.stars} accessibilityRole="radiogroup">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setStars(n)}
                      accessibilityRole="radio"
                      accessibilityLabel={`${n} – ${STAR_LABELS[n]}`}
                      accessibilityState={{ selected: stars === n }}
                      hitSlop={6}
                      testID={`feedback-star-${n}`}
                    >
                      <Ionicons name={n <= stars ? "star" : "star-outline"} size={36} color={n <= stars ? colors.gold : "rgba(255,255,255,0.3)"} />
                    </Pressable>
                  ))}
                </View>
                <Muted style={styles.center}>{stars ? STAR_LABELS[stars] : "Tippe auf die Sterne"}</Muted>
                {tags.length ? (
                  <>
                    <Muted style={styles.label}>{feedbackTagPrompt(stars)}</Muted>
                    <View style={styles.chips}>
                      {tags.map((tag) => {
                        const on = chosen.includes(tag);
                        return (
                          <Pressable
                            key={tag}
                            onPress={() => setChosen((current) => (on ? current.filter((t) => t !== tag) : [...current, tag]))}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on }}
                            style={[styles.chip, on && styles.chipOn]}
                            testID={`feedback-tag-${tag}`}
                          >
                            <Muted style={[styles.chipText, on && styles.chipTextOn]}>{tag}</Muted>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                <TextInput
                  value={text}
                  onChangeText={(value) => setText(value.slice(0, textMax))}
                  multiline
                  maxLength={textMax}
                  placeholder="Ein Satz (freiwillig): was beibehalten, was besser machen?"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  testID="feedback-text"
                />
                <Muted style={styles.counter}>{text.length}/{textMax}</Muted>
                {error ? <Muted style={styles.error}>{error}</Muted> : null}
                <Button label={busy ? "Sende …" : "Abschicken"} onPress={() => send(false)} disabled={!stars || busy || !prompt} testID="feedback-submit" />
                <Pressable onPress={() => send(true)} disabled={busy || !prompt} accessibilityRole="button" style={styles.decline} testID="feedback-decline">
                  <Muted style={styles.declineText}>LIEBER NICHT</Muted>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.7)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, maxHeight: "92%" },
  content: { gap: 12, padding: 18, paddingBottom: 30 },
  top: { flexDirection: "row", gap: 12 },
  flex: { flex: 1, gap: 4 },
  question: { fontSize: 24 },
  stars: { flexDirection: "row", gap: 10, justifyContent: "center", marginTop: 6 },
  center: { textAlign: "center" },
  label: { color: colors.white, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: "rgba(255,255,255,0.15)", borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: "rgba(41,182,232,0.12)", borderColor: colors.cyan },
  chipText: { fontWeight: "800" },
  chipTextOn: { color: colors.cyan },
  input: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.white, minHeight: 72, padding: 10, textAlignVertical: "top" },
  counter: { fontSize: 11, textAlign: "right" },
  error: { color: colors.live, fontWeight: "800" },
  decline: { alignItems: "center", paddingVertical: 8 },
  declineText: { color: colors.cyan, fontWeight: "900", letterSpacing: 1 },
});
