import React, { useState } from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";
import { useBranding } from "../branding/BrandingProvider";

const BUILTIN = {
  wordmark: require("../../assets/brand/tls-wordmark.png"),
  mascot: require("../../assets/brand/tls-mascot.png"),
};

/** Logo oder Maskottchen aus den Einstellungen; sonst - und wenn das Bild nicht lädt - das eingebaute (#229). */
export function BrandLogo({
  variant = "wordmark",
  style,
  testID = "brand-logo",
}: {
  variant?: "wordmark" | "mascot";
  style?: StyleProp<ImageStyle>;
  testID?: string;
}) {
  const branding = useBranding();
  const remote = variant === "mascot" ? branding.mascotUrl : branding.logoUrl;
  const [failedUrl, setFailedUrl] = useState("");
  const useRemote = Boolean(remote) && failedUrl !== remote;
  return (
    <Image
      source={useRemote ? { uri: remote } : BUILTIN[variant]}
      style={style}
      resizeMode="contain"
      onError={() => setFailedUrl(remote)}
      accessibilityLabel={branding.clubName}
      testID={testID}
    />
  );
}
