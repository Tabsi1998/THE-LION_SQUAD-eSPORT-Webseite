import React from "react";
import { StyleSheet, View } from "react-native";
import { Card } from "../components/Card";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { Body, Heading, Muted } from "../components/Text";
import { useSeason, type SeasonPreference } from "./SeasonProvider";
import { appCanShow } from "./SeasonStage";

// Der Schalter unter „Mehr“ (#636): saisonale Deko an, dezent oder aus - angemeldet im Konto (gilt
// auch auf der Website), als Gast auf dem Gerät. Sichtbar ist er immer, damit man ihn findet.

export const DECO_ITEMS: Array<{ key: SeasonPreference; label: string }> = [
  { key: "on", label: "An" },
  { key: "subtle", label: "Dezent" },
  { key: "off", label: "Aus" },
];

export function DecoSetting() {
  const { preference, setPreference, seasons, reducedMotion } = useSeason();
  // Nur, was die App auch zeigt - eine Saison, die erst das Web zeichnet, hieße hier sonst „läuft gerade“ ohne Bild.
  const running = seasons.filter(appCanShow).map((season) => season.label).join(", ");
  return (
    <View style={styles.group} testID="season-deco-setting">
      <Heading>Darstellung</Heading>
      <Card>
        <Body style={styles.title}>Saisonale Deko</Body>
        <Muted style={styles.hint}>
          {running ? `Gerade läuft: ${running}.` : "Halloween, Advent, Silvester, Fasching und Ostern schmücken die App zur passenden Zeit."}
          {reducedMotion ? " Dein Handy hat „Bewegung reduzieren“ an – dann bleibt alles ruhig." : ""}
        </Muted>
        <SegmentedTabs items={DECO_ITEMS} value={preference} onChange={(value) => { void setPreference(value); }} style={styles.tabs} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  title: { fontWeight: "700" },
  hint: { marginTop: 4 },
  tabs: { marginTop: 10 },
});
