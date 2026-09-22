import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Linking, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Body } from "./Text";
import { api } from "../lib/api";
import { dismissKey, loadDismissed, rememberDismissed, tickerDurationMs, toneColor, visibleBanners, type SiteBanner } from "../lib/banners";
import { navigateToNotification, targetFromUrl } from "../navigation/rootNavigation";
import { useLiveRefresh } from "../realtime/LiveChangesProvider";
import { colors } from "../theme";

// Laufbanner (#245) oben über den Tabs: dieselben Banner wie die Website, nur die mit Kanal
// „app“. Ticker mit der eingestellten Mindestlaufzeit, Tipp öffnet das Ziel (in der App, wenn es
// eines gibt, sonst den Browser), das X blendet den Banner aus, bis er sich ändert.

export function SiteBannerTicker() {
  const insets = useSafeAreaInsets();
  const [banners, setBanners] = useState<SiteBanner[]>([]);
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const [width, setWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ items?: SiteBanner[] }>("/settings/site-banners", { params: { channel: "app" } });
      setBanners(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setBanners([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDismissed().then(setDismissed); }, []);
  useLiveRefresh(load, ["settings"], { fallbackMs: 120000 });

  const banner = useMemo(() => visibleBanners(banners, dismissed || [])[0] || null, [banners, dismissed]);
  const ticker = banner?.mode !== "static";

  useEffect(() => {
    if (!banner || !ticker || !width || !textWidth) return undefined;
    offset.setValue(width);
    const loop = Animated.loop(Animated.timing(offset, {
      toValue: -textWidth,
      duration: tickerDurationMs(banner.text, banner.speed_seconds),
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [banner, offset, textWidth, ticker, width]);

  if (!banner || dismissed === null) return null;
  const color = toneColor(banner.tone);
  const text = banner.link_label ? `${banner.text} – ${banner.link_label}` : banner.text;

  const open = () => {
    if (!banner.link_url) return;
    // Ein Ziel in der App (Event, Turnier, Profil …) öffnet sich in der App, alles andere im Browser.
    if (targetFromUrl(banner.link_url)) {
      navigateToNotification({ id: `banner-${banner.id}`, kind: "site_banner", title: banner.text, url: banner.link_url } as never);
    } else {
      Linking.openURL(banner.link_url).catch(() => undefined);
    }
  };
  const dismiss = async () => {
    setDismissed(await rememberDismissed(dismissed, dismissKey(banner)));
  };

  return (
    <View style={[styles.bar, { borderColor: color, paddingTop: Math.max(insets.top, 6) }]} testID="site-banner" accessibilityRole="alert">
      <Pressable onPress={open} disabled={!banner.link_url} style={styles.body} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} accessibilityRole={banner.link_url ? "link" : "text"} testID="site-banner-text">
        {ticker ? (
          <Animated.View style={[styles.track, { transform: [{ translateX: offset }] }]}>
            <Body style={[styles.text, { color }]} numberOfLines={1} onLayout={(event) => setTextWidth(event.nativeEvent.layout.width)}>{text}</Body>
          </Animated.View>
        ) : (
          <Body style={[styles.text, styles.static, { color }]} numberOfLines={2}>{text}</Body>
        )}
      </Pressable>
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Hinweis ausblenden" hitSlop={8} style={styles.close} testID="site-banner-dismiss">
        <Ionicons name="close" color={colors.muted} size={16} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: colors.black,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  body: { flex: 1, minHeight: 24, overflow: "hidden", justifyContent: "center" },
  track: { alignSelf: "flex-start", flexDirection: "row" },
  text: { fontSize: 13, fontWeight: "800" },
  static: { textAlign: "center" },
  close: { alignItems: "center", height: 28, justifyContent: "center", width: 28 },
});
