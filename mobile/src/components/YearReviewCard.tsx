import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { Card } from "./Card";
import { Heading, Muted } from "./Text";
import { api } from "../lib/api";
import { colors } from "../theme";

// Jahresrückblick (#1195) auf „Start“ - wie im Web auf dem Dashboard: ab Mitte Dezember „Dein Jahr 2026 ist da“, nur
// wenn es für dich einen Rückblick gibt. Sonst steht hier nichts.

type Status = { available: boolean; year?: number | null };

export function YearReviewCard({ onOpen }: { onOpen: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<Status>("/year-review/status")
      .then(({ data }) => { if (alive) setStatus(data); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, []);
  if (!status?.available) return null;
  return (
    <Card style={styles.card} testID="year-review-card-home">
      <View style={styles.text}>
        <Muted style={styles.eyebrow}>Jahresrückblick</Muted>
        <Heading>{`Dein Jahr ${status.year} ist da`}</Heading>
        <Muted>Turniere, Siege, Events und Bestzeiten zum Durchtippen – nur für dich.</Muted>
      </View>
      <Button label="Ansehen" onPress={onOpen} testID="year-review-open" />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, borderColor: "rgba(255,215,0,0.42)", backgroundColor: "rgba(255,215,0,0.055)" },
  text: { gap: 4 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: "900", letterSpacing: 1.5, textTransform: "uppercase" },
});
