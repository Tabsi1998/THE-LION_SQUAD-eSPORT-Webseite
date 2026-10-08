import React, { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { Card } from "./Card";
import { Heading, Muted } from "./Text";
import { api, resolveMediaUrl } from "../lib/api";
import { shareResultImage, shareResultLink, showsHint, type ResultShareOptions } from "../lib/resultShare";
import { colors, radius } from "../theme";

// „Ergebnis teilen“ (#1194) nach dem Turnier - wie im Web in „Dein Stand“: das hohe Bild als Vorschau, „Bild teilen“
// für WhatsApp-Status und Instagram-Story, „Link teilen“ für die Seite mit Vorschaubild. Ist das Profil privat oder
// das Turnier nicht öffentlich, steht da, warum (die Privatsphäre liegt wie überall unter Profil → Zahnrad - kein
// zweiter Weg dorthin, #1150); wer nicht mitgespielt hat, sieht nichts.

export function ResultShareCard({ tournamentId }: { tournamentId: string }) {
  const [options, setOptions] = useState<ResultShareOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    api.get<ResultShareOptions>(`/share/result-options/${encodeURIComponent(tournamentId)}`)
      .then(({ data }) => { if (alive) setOptions(data); })
      .catch(() => { if (alive) setOptions(null); });
    return () => { alive = false; };
  }, [tournamentId]);

  if (!options) return null;
  if (!options.shareable) {
    if (!showsHint(options)) return null;
    return (
      <Card style={styles.card} testID="result-share-hint">
        <Heading>Ergebnis teilen</Heading>
        <Muted>{options.text}</Muted>
        {options.reason === "private_profile" ? <Muted>In der App: Profil → Zahnrad → Privatsphäre.</Muted> : null}
      </Card>
    );
  }

  const run = async (task: () => Promise<"shared" | "failed">) => {
    setBusy(true);
    setMessage("");
    const result = await task();
    setBusy(false);
    if (result === "failed") setMessage("Teilen ging gerade nicht – versuch es gleich noch einmal.");
  };

  return (
    <Card style={styles.card} testID="result-share-card">
      <Heading>Ergebnis teilen</Heading>
      <View style={styles.row}>
        {options.image_paths?.story ? (
          <Image source={{ uri: resolveMediaUrl(options.image_paths.story) }} style={styles.preview} accessibilityLabel={options.headline || "Ergebnis-Bild"} testID="result-share-preview" />
        ) : null}
        <View style={styles.text}>
          <Muted>{options.headline}</Muted>
          <Muted>Als Bild für WhatsApp-Status und Instagram-Story – oder als Link mit Vorschau.</Muted>
        </View>
      </View>
      <Button label="Bild teilen" onPress={() => run(() => shareResultImage(options))} disabled={busy} testID="result-share-image" />
      <Button label="Link teilen" variant="secondary" onPress={() => run(() => shareResultLink(options))} disabled={busy} testID="result-share-link" />
      {message ? <Muted style={styles.error}>{message}</Muted> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  preview: { width: 72, height: 128, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.black },
  text: { flex: 1, gap: 4 },
  error: { color: colors.live },
});
