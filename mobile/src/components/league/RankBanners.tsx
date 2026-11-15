import * as Clipboard from "expo-clipboard";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Share, StyleSheet, View } from "react-native";
import { resolveMediaUrl } from "../../lib/api";
import { colors, radius } from "../../theme";
import { Button } from "../Button";
import { Card } from "../Card";
import { MediaImage } from "../MediaImage";
import { Glow, StaggerIn, tapFeedback } from "../motion";
import { Body, Heading, Muted } from "../Text";

// Rankingbanner (#2425, Nr. 60; App: #2173, Web: components/tls/league/RankBannerCopy.jsx): je öffentlicher Season ein Live-Bild mit Platz
// und Bilanz des Teams - der Link bleibt fest, das Bild zeichnet der Server nach dem Stand der Tabelle. Hier mit Vorschau,
// „Rankingbanner kopieren“ (für Discord oder das Streaming-Programm) und „Teilen“ über das Teilen-Menü des Handys. Ohne `rank_banners`
// (ältere Server, keine öffentliche Season) steht nichts da.
// Bewegung (Detail-Runde): Nach dem Kopieren wird der Knopf zum Haken („Kopiert“, zwei Sekunden), leuchtet einmal auf, dazu eine
// leichte Vibration; „Bewegung reduzieren“: nur der Wechsel.

export type RankBannerRow = {
  key?: string | null;
  league?: string | null;
  season?: string | null;
  name?: string | null;
  division?: string | null;
  staffel?: string | null;
  image_url?: string | null;
  page_url?: string | null;
};

const COPIED_MS = 2000;

/** Die volle Adresse des Bildes - zum Einfügen in Discord oder ins Streaming-Programm. */
export function rankBannerLink(path?: string | null): string {
  return path ? resolveMediaUrl(path) : "";
}

function BannerActions({ row, testID }: { row: RankBannerRow; testID: string }) {
  const link = rankBannerLink(row.image_url);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    Promise.resolve(Clipboard.setStringAsync(link)).catch(() => undefined);
    tapFeedback();
    AccessibilityInfo.announceForAccessibility?.("Link zum Rankingbanner kopiert");
    setCopied(true);
    setFlash((value) => value + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  const share = () => {
    const title = [row.name, row.season].filter(Boolean).join(" · ") || "Rankingbanner";
    Share.share({ message: `Rankingbanner ${title}\n${link}`, url: link, title: "Rankingbanner" }).catch(() => undefined);
  };
  return (
    <View style={styles.actions}>
      <View style={styles.copy}>
        <Button
          label={copied ? "Kopiert" : "Rankingbanner kopieren"}
          variant="secondary"
          arrow={false}
          icon={copied ? "checkmark" : "link-outline"}
          accessibilityLabel={copied ? "Link zum Rankingbanner kopiert" : "Link zum Rankingbanner kopieren"}
          onPress={copy}
          testID={`${testID}-copy`}
        />
        {flash ? <Glow trigger={flash} tone="ok" radius={radius.sm} /> : null}
      </View>
      <Button label="Teilen" variant="secondary" arrow={false} icon="share-outline" accessibilityLabel="Link zum Rankingbanner teilen" onPress={share} testID={`${testID}-share`} />
    </View>
  );
}

/** Die Rankingbanner eines Teams (Teamseite): je Season Vorschau, Liga N und die Knöpfe zum Kopieren und Teilen. */
export function RankBanners({ rows, testID = "team-rank-banners" }: { rows?: RankBannerRow[] | null; testID?: string }) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row?.image_url);
  if (!list.length) return null;
  return (
    <Card style={styles.card} testID={testID}>
      <Heading accessibilityRole="header">Rankingbanner</Heading>
      <Muted>Platz und Bilanz als Bild mit festem Link – für Discord oder den Stream. Es aktualisiert sich von selbst.</Muted>
      <StaggerIn style={styles.list}>
        {list.map((row, index) => {
          const key = row.key || String(index);
          return (
            <View key={key} style={styles.row} testID={`${testID}-${key}`}>
              <Body style={styles.title} numberOfLines={2}>{[row.league, row.season].filter(Boolean).join(" · ")}</Body>
              <Muted style={styles.small} numberOfLines={2}>{[row.name, row.division, row.staffel ? `Staffel ${row.staffel}` : ""].filter(Boolean).join(" · ")}</Muted>
              <View style={styles.preview} accessible accessibilityRole="image" accessibilityLabel={`Rankingbanner ${row.name || ""} ${row.season || ""}`.trim()}>
                <MediaImage uri={row.image_url} style={StyleSheet.absoluteFill} fallback={null} />
              </View>
              <BannerActions row={row} testID={`${testID}-${key}`} />
            </View>
          );
        })}
      </StaggerIn>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  list: { gap: 14 },
  row: { gap: 6 },
  title: { fontWeight: "800" },
  small: { fontSize: 12 },
  // Das Bild ist 1200×300 - die Vorschau hält das Seitenverhältnis.
  preview: { aspectRatio: 4, backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, overflow: "hidden", width: "100%" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  copy: { position: "relative" },
});
