import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { MediaImage } from "./MediaImage";
import { logoToneMode, type ToneLogo } from "../lib/sponsors";
import { colors } from "../theme";

// Sponsoren- und Partner-Logos einfarbig weiß (#1916, App-Teil von #1321) - wie SponsorLogo.jsx im Web, so wirken alle
// gleich wertvoll. Am Handy gibt es kein Drüberfahren, die Logos bleiben weiß:
// - eine hochgeladene weiße Fassung (`logo_mono_url`);
// - sonst bei durchsichtigen Logos (`logo_transparent`, sagt der Server) weiß eingefärbt;
// - sonst (Logo mit Kasten oder unbekannt) das Original auf einer ruhigen Fläche - nie ein weißes Rechteck.

type Props = {
  logo: ToneLogo;
  /** Rückfall ohne Logo oder wenn es nicht lädt (Name oder Kürzel). */
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function SponsorLogo({ logo, fallback, style, testID }: Props) {
  const mode = logoToneMode(logo);
  const uri = mode === "file" ? logo.logo_mono_url : logo.logo_url;
  if (mode === "surface") {
    return (
      // Die Fläche gewinnt gegen einen durchsichtigen Grund des Aufrufers; Größe und Lage kommen vom Aufrufer.
      <View style={[style, styles.surface]} testID={testID ? `${testID}-surface` : undefined}>
        <MediaImage uri={uri} resizeMode="contain" style={styles.inner} fallback={fallback} />
      </View>
    );
  }
  return (
    <View style={style} testID={testID ? `${testID}-${mode}` : undefined}>
      <MediaImage
        uri={uri}
        resizeMode="contain"
        style={styles.inner}
        imageStyle={mode === "tint" ? styles.tint : undefined}
        fallback={fallback}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { backgroundColor: "transparent", borderWidth: 0, flex: 1, width: "100%" },
  tint: { tintColor: colors.white },
  // Ruhige Fläche wie `tls-sponsor-logo--surface` im Web.
  surface: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 2,
    borderWidth: 1,
    padding: "6%",
  },
});
