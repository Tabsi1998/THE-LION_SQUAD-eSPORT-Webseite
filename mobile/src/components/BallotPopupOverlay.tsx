import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Body, Heading, Muted } from "./Text";
import { useAuth } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { useLiveRefresh } from "../realtime/LiveChangesProvider";
import { colors, radius } from "../theme";

// Abstimmung live (#844) in der App - wie im Web: Öffnet die Versammlungsleitung in Dolibarr eine Abstimmung, erscheint
// sie über jedem Screen für Mitglieder mit offenem Stimmrecht. Antwort wählen, „Stimme abgeben“, fertig. „Später“ macht
// daraus ein Band unten, bis abgestimmt ist oder die Abstimmung schließt. Geheime Wahlen laufen auf Papier im Saal.

type Right = { right_id: number; for: string; name: string; can_use: boolean };
type Ballot = {
  id: number; meeting: string; item: number; kind_label: string; question: string; secret: boolean; can_vote: boolean;
  options: Array<{ code: string; label: string }>; rights: Right[];
};
type OpenBallots = { available: boolean; ballots: Ballot[]; live: boolean; poll_seconds: number };

export function rightLabel(right: Right): string {
  return right.for === "proxy" ? `Vollmacht für ${right.name || "ein Mitglied"}` : "Deine Stimme";
}

export function BallotPopupOverlay() {
  const { user } = useAuth();
  const active = Boolean(user?.is_club_member);
  const [view, setView] = useState<OpenBallots | null>(null);
  const [later, setLater] = useState<number[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!active) return;
    try {
      const { data } = await api.get<OpenBallots>("/membership/me/ballots/open");
      setView(data);
    } catch {
      // still: ein Fehler beim Nachsehen soll keinen Screen stören
    }
  }, [active]);

  useEffect(() => {
    load();
  }, [load]);
  // Das Signal kommt über den Änderungsstrom. Ohne Feed beim Server fragt die App am Versammlungstag selbst nach
  // (poll_seconds) - auch wenn der Strom verbunden ist, denn dann kommt über ihn nichts.
  useLiveRefresh(load, ["ballots"], { fallbackMs: 300000 });
  const pollSeconds = view?.poll_seconds || 0;
  useEffect(() => {
    if (!active || pollSeconds <= 0) return undefined;
    const timer = setInterval(load, pollSeconds * 1000);
    return () => clearInterval(timer);
  }, [active, pollSeconds, load]);

  if (!active || !view?.ballots?.length) return null;
  const ballot = view.ballots.find((item) => !later.includes(item.id)) || null;
  const waiting = view.ballots.filter((item) => later.includes(item.id) && item.can_vote);
  const key = (right: Right) => `${ballot?.id}:${right.right_id}`;
  const usable = ballot ? ballot.rights.filter((right) => right.can_use) : [];

  const cast = async () => {
    if (!ballot) return;
    const rights = usable.filter((right) => chosen[key(right)]);
    if (!rights.length) return;
    setBusy(true);
    setMessage("");
    try {
      for (const right of rights) {
        await api.post(`/membership/me/ballots/${ballot.id}/votes`, { right_id: right.right_id, option: chosen[key(right)] });
      }
      setMessage("Danke – deine Stimme ist angekommen.");
    } catch (problem) {
      setMessage(errorMessage(problem, "Die Stimme ist nicht angekommen – bitte noch einmal versuchen."));
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <>
      <Modal visible={Boolean(ballot)} transparent animationType="fade" onRequestClose={() => ballot && setLater((current) => [...current, ballot.id])}>
        <View style={styles.backdrop}>
          {ballot ? (
            <View style={styles.sheet} testID="ballot-popup">
              <Muted style={styles.eyebrow}>Abstimmung offen{ballot.meeting ? ` · ${ballot.meeting}` : ""}</Muted>
              <Heading>{ballot.question}</Heading>
              {ballot.item ? <Muted>Tagesordnungspunkt {ballot.item} · {ballot.kind_label}</Muted> : null}
              {ballot.secret ? (
                <Body style={styles.secret} testID="ballot-popup-secret">Geheime Wahl auf Papier: Den Stimmzettel bekommst du im Saal. In der App wird hier nicht abgestimmt.</Body>
              ) : (
                <>
                  <Muted>Offene Abstimmung: Deine Stimme wird mit deinem Namen gespeichert. Eine Stimme lässt sich nicht ändern.</Muted>
                  {usable.map((right) => (
                    <View key={right.right_id} style={styles.right}>
                      <Muted style={styles.rightLabel}>{rightLabel(right)}</Muted>
                      <View style={styles.options}>
                        {ballot.options.map((option) => {
                          const selected = chosen[key(right)] === option.code;
                          return (
                            <Pressable key={option.code} disabled={busy} onPress={() => setChosen((current) => ({ ...current, [key(right)]: option.code }))}
                              accessibilityRole="button" accessibilityState={{ selected }} style={[styles.option, selected && styles.optionSelected]}
                              testID={`ballot-option-${right.right_id}-${option.code}`}>
                              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </>
              )}
              {message ? <Body testID="ballot-popup-message">{message}</Body> : null}
              <View style={styles.actions}>
                <Button label={ballot.secret ? "Verstanden" : "Später"} variant="secondary" onPress={() => setLater((current) => [...current, ballot.id])} testID="ballot-popup-later" />
                {!ballot.secret ? (
                  <Button label="Stimme abgeben" onPress={cast} disabled={busy || !usable.some((right) => chosen[key(right)])} testID="ballot-popup-cast" />
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
      {!ballot && waiting.length ? (
        <Pressable style={styles.band} onPress={() => setLater((current) => current.filter((id) => id !== waiting[0].id))} testID="ballot-band" accessibilityRole="button">
          <Ionicons name="checkbox-outline" size={16} color={colors.cyan} />
          <Text style={styles.bandText} numberOfLines={1}>Abstimmung offen: {waiting[0].question} – jetzt abstimmen</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.7)", flex: 1, justifyContent: "center", padding: 16 },
  sheet: { backgroundColor: "#0F1012", borderColor: "rgba(41,182,232,0.4)", borderRadius: radius.md, borderWidth: 1, gap: 10, maxWidth: 520, padding: 18, width: "100%" },
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  secret: { backgroundColor: "rgba(255,215,0,0.1)", borderColor: "rgba(255,215,0,0.4)", borderRadius: 6, borderWidth: 1, padding: 10 },
  right: { gap: 6 },
  rightLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { borderColor: "rgba(255,255,255,0.18)", borderRadius: 6, borderWidth: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  optionSelected: { backgroundColor: "rgba(41,182,232,0.15)", borderColor: colors.cyan },
  optionText: { color: "rgba(255,255,255,0.85)", fontWeight: "700" },
  optionTextSelected: { color: colors.cyan },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" },
  band: {
    alignItems: "center", alignSelf: "center", backgroundColor: "rgba(15,16,18,0.95)", borderColor: "rgba(41,182,232,0.5)", borderRadius: 999, borderWidth: 1,
    bottom: 96, flexDirection: "row", gap: 8, maxWidth: "92%", paddingHorizontal: 14, paddingVertical: 8, position: "absolute",
  },
  bandText: { color: colors.cyan, flexShrink: 1, fontWeight: "800" },
});
