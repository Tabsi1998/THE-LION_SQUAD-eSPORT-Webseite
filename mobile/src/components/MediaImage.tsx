import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, View, type ImageResizeMode, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import { resolveMediaUrl } from "../lib/api";
import { colors } from "../theme";

export function MediaImage({
  uri,
  fallback,
  style,
  imageStyle,
  resizeMode = "cover",
}: {
  uri?: string | null;
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
}) {
  const sourceUrl = useMemo(() => resolveMediaUrl(uri), [uri]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [sourceUrl]);

  return (
    <View style={[styles.shell, style]}>
      {sourceUrl && !failed ? (
        <Image
          source={{ uri: sourceUrl }}
          style={[StyleSheet.absoluteFill, imageStyle]}
          resizeMode={resizeMode}
          onError={() => setFailed(true)}
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
