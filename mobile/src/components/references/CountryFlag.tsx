import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { countryCode, countryName, flagBox, flagUrl } from "../../lib/countryFlags";
import { Muted } from "../Text";

// Flagge je Termin und Rennen (#1925, App-Teil in #1945) - wie CountryFlag im Web: die SVG-Datei der eigenen Website
// (/assets/flags/<code>.svg, gemeinfrei), Name des Landes für den Vorleser, fester Kasten mit gleicher Höhe und der
// Breite nach dem echten Seitenverhältnis (bis 2:1), damit beim Laden nichts springt. Jede Datei lädt nur einmal je
// App-Start. Ohne Netz oder bei einem Fehler steht der Ländercode als Text im Kasten; ohne bekanntes Land gibt es nichts.

const cache = new Map<string, Promise<string | null>>();

/** Nur für Tests: vergisst die geladenen Flaggen. */
export function resetFlagCache() {
  cache.clear();
}

function loadFlag(code: string): Promise<string | null> {
  const known = cache.get(code);
  if (known) return known;
  const url = flagUrl(code);
  const request = !url ? Promise.resolve(null) : fetch(url)
    .then(async (response) => {
      const text = response.ok ? await response.text() : "";
      return /^\s*<svg[\s>]/i.test(text) ? text : null;
    })
    .catch(() => null)
    .then((xml) => {
      // Ein Fehlschlag bleibt nicht hängen - beim nächsten Öffnen wird es noch einmal versucht.
      if (!xml) cache.delete(code);
      return xml;
    });
  cache.set(code, request);
  return request;
}

export function CountryFlag({ code, height = 14 }: { code?: string | null; height?: number }) {
  const known = countryCode(code);
  const [xml, setXml] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!known) return undefined;
    let alive = true;
    setXml(undefined);
    loadFlag(known).then((value) => { if (alive) setXml(value); });
    return () => { alive = false; };
  }, [known]);
  if (!known) return null;
  const box = flagBox(known, height);
  return (
    <View style={[styles.box, xml === null && styles.textBox, xml === null ? { minWidth: box.width, height: box.height } : box]} accessible accessibilityRole="image" accessibilityLabel={countryName(known)}>
      {xml ? <SvgXml xml={xml} width={box.width} height={box.height} preserveAspectRatio="xMidYMid slice" testID="country-flag-svg" /> : null}
      {xml === null ? <Muted style={styles.text}>{known}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 2, flexShrink: 0, overflow: "hidden" },
  textBox: { alignItems: "center", borderColor: "rgba(255,255,255,0.18)", borderWidth: 1, justifyContent: "center", paddingHorizontal: 2 },
  text: { color: "#E4E4E7", fontSize: 9, fontWeight: "800", letterSpacing: 0.4, lineHeight: 12 },
});
