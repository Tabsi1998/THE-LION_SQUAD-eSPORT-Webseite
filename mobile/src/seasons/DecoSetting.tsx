import React from "react";
import { StyleSheet, View } from "react-native";
import { Card } from "../components/Card";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { Body, Heading, Muted } from "../components/Text";
import { useSeason, type SeasonPreference } from "./SeasonProvider";
import { appNamesSeason } from "./SeasonStage";
import { useSoundsOn } from "./sound/player";

// Der Schalter (#636): saisonale Deko an, dezent oder aus - angemeldet im Konto (gilt auch auf der Website), als Gast auf
// dem Gerät. Seit #1146 steht er in den Einstellungen unter „Darstellung“ (Zahnrad im Profil; Gäste im Profil-Tab).

export const DECO_ITEMS: Array<{ key: SeasonPreference; label: string }> = [
  { key: "on", label: "An" },
  { key: "subtle", label: "Dezent" },
  { key: "off", label: "Aus" },
];

export const SOUND_ITEMS: Array<{ key: "on" | "off"; label: string }> = [
  { key: "on", label: "An" },
  { key: "off", label: "Aus" },
];

export function DecoSetting({ title = "Darstellung" }: { title?: string | null } = {}) {
  const { preference, setPreference, seasons, reducedMotion } = useSeason();
  // Nur, was die App auch zeigt - eine Saison, die erst das Web zeichnet, hieße hier sonst „läuft gerade“ ohne Bild.
  const running = seasons.filter(appNamesSeason).map((season) => season.label).join(", ");
  const [soundsOn, setSoundsOn] = useSoundsOn();
  return (
    <View style={styles.group} testID="season-deco-setting">
      {title ? <Heading>{title}</Heading> : null}
      <Card>
        <Body style={styles.title}>Saisonale Deko</Body>
        <Muted style={styles.hint}>
          {running ? `Gerade läuft: ${running}.` : "Halloween, Advent, Silvester, Fasching und Ostern schmücken die App zur passenden Zeit."}
          {reducedMotion ? " Dein Handy hat „Bewegung reduzieren“ an – dann bleibt alles ruhig." : ""}
        </Muted>
        <SegmentedTabs items={DECO_ITEMS} value={preference} onChange={(value) => { void setPreference(value); }} style={styles.tabs} />
        {/* Töne der Deko (#772): je Gerät wie im Web; leise, nur nach einem Antippen, still bei Lautlos und Vibration. */}
        <Body style={[styles.title, styles.sounds]}>Töne</Body>
        <Muted style={styles.hint}>Antippen lässt die Figuren klingen – die Katze miaut. Leise, und bei Lautlos oder Vibration still.</Muted>
        <View testID="season-sound-setting">
          <SegmentedTabs items={SOUND_ITEMS} value={soundsOn ? "on" : "off"} onChange={(value) => setSoundsOn(value === "on")} style={styles.tabs} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  title: { fontWeight: "700" },
  hint: { marginTop: 4 },
  tabs: { marginTop: 10 },
  sounds: { marginTop: 16 },
});
