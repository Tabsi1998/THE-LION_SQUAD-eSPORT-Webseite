import React, { useEffect, useMemo, useState } from "react";
import { Image, PixelRatio, StyleSheet, View, type ImageResizeMode, type ImageStyle, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { resolveMediaUrl } from "../lib/api";
import { sizedUpload } from "../lib/gallery";
import { colors } from "../theme";

export type UploadWidth = 400 | 800 | 1600;

/** Die kleinste vorgehaltene Fassung, die die gezeichnete Breite in Gerätepixeln abdeckt (#219). */
export function widthForLayout(layoutWidth: number, pixelRatio: number = PixelRatio.get()): UploadWidth {
  const px = Math.ceil(layoutWidth * pixelRatio);
  if (px <= 400) return 400;
  if (px <= 800) return 800;
  return 1600;
}

/**
 * Bild aus den Uploads in passender Breite: Ohne `width` misst die Hülle sich selbst und lädt
 * die kleinste Fassung, die die Fläche in Gerätepixeln füllt - eine Kachel bekommt 400, eine
 * Karte 800, ein Kopfbild 1600 statt immer des Originals (#219). Fremde Adressen bleiben, wie
 * sie sind. Lädt das Bild nicht, steht der Rückfall da.
 */
export function MediaImage({
  uri,
  fallback,
  style,
  imageStyle,
  resizeMode = "cover",
  width,
}: {
  uri?: string | null;
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  /** Feste Fassung statt Messen - etwa wenn die Adresse schon eine Breite trägt. */
  width?: UploadWidth;
}) {
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);
  const chosen = width ?? (layoutWidth == null ? null : widthForLayout(layoutWidth));
  const sourceUrl = useMemo(() => (chosen == null ? "" : resolveMediaUrl(sizedUpload(uri, chosen))), [uri, chosen]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [sourceUrl]);

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    // Die erste sinnvolle Breite zählt; ein späteres Umbrechen lädt nicht neu.
    if (measured > 0) setLayoutWidth((previous) => previous ?? measured);
  };

  return (
    <View style={[styles.shell, style]} onLayout={width ? undefined : onLayout} testID="media-image-shell">
      {sourceUrl && !failed ? (
        <Image
          source={{ uri: sourceUrl }}
          style={[StyleSheet.absoluteFill, imageStyle]}
          resizeMode={resizeMode}
          onError={() => setFailed(true)}
          testID="media-image"
        />
      ) : (
        fallback
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
});
