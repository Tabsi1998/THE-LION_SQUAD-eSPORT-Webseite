import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import { colors, radius } from "../theme";
import { MediaImage } from "./MediaImage";
import { Body, Muted } from "./Text";

// Bilder vom Handy (#1153): Profilbild, Banner, Team-Logo und Team-Banner. Ein Tipp aufs Bild fragt „Foto aufnehmen“
// oder „Aus der Galerie“, das Handy lässt zuschneiden (Profilbild und Logo quadratisch - das Profilbild erscheint rund -,
// Banner im Breitformat 3:1, wie im Web), dann geht es über denselben Weg wie im Web hoch (`/uploads/image`) und
// durch dieselbe Bildprüfung: ein gestopptes Bild verschwindet wieder, und die Person bekommt eine Nachricht.
// Ohne Netz oder bei einem Fehler bleibt das alte Bild, und eine Zeile sagt warum.

export type ImageShape = "round" | "square" | "banner";

/** Zuschnitt je Stelle - dieselben Formate wie im Web (ImageUpload `crop`). */
export const IMAGE_ASPECT: Record<ImageShape, [number, number]> = { round: [1, 1], square: [1, 1], banner: [3, 1] };

/** Hochladen wie im Web: dieselbe Adresse, dieselbe Prüfung. Liefert die Adresse des Bildes. */
export async function uploadPickedImage(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const type = asset.mimeType || "image/jpeg";
  const ext = (type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const form = new FormData();
  form.append("file", { uri: asset.uri, name: asset.fileName || `bild.${ext}`, type } as unknown as Blob);
  const { data } = await api.post<{ url?: string }>("/uploads/image", form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 });
  if (!data?.url) throw new Error("Der Server hat keine Adresse für das Bild geschickt.");
  return data.url;
}

/** Kamera oder Galerie, mit Zuschnitt im Format der Stelle. Null, wenn die Person abbricht. */
export async function pickImage(source: "camera" | "library", shape: ImageShape): Promise<ImagePicker.ImagePickerAsset | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: IMAGE_ASPECT[shape], quality: 0.85 };
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new PickProblem("Ohne Kamera-Erlaubnis geht das nicht – nimm ein Bild aus der Galerie oder erlaube die Kamera in den Einstellungen des Handys.");
    const result = await ImagePicker.launchCameraAsync(options);
    return result.canceled ? null : result.assets?.[0] || null;
  }
  const result = await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : result.assets?.[0] || null;
}

/** Ein Hinweis, den die Person lesen soll (keine Technik). */
export class PickProblem extends Error {}

/** Was schiefging - in Worten, mit dem Satz, dass das alte Bild bleibt. */
export function uploadProblemText(error: unknown): string {
  if (error instanceof PickProblem) return error.message;
  if (axios.isAxiosError(error) && !error.response) return "Ohne Netz – das alte Bild bleibt. Versuch es noch einmal, sobald du Netz hast.";
  return `${errorMessage(error, "Hochladen hat nicht geklappt.")} Das alte Bild bleibt.`;
}

export function ImagePickField({
  label,
  value,
  shape,
  onUploaded,
  fallback,
  hint,
  testID = "image-pick",
}: {
  label: string;
  value?: string | null;
  shape: ImageShape;
  /** Das neue Bild ist hochgeladen - speichern (Profil, Team). Wirft es, bleibt das alte Bild. */
  onUploaded: (url: string) => Promise<void> | void;
  /** Ohne Bild (etwa zwei Buchstaben). */
  fallback?: React.ReactNode;
  hint?: string;
  testID?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const run = async (source: "camera" | "library") => {
    setMessage(null);
    try {
      const asset = await pickImage(source, shape);
      if (!asset) return;
      setBusy(true);
      const url = await uploadPickedImage(asset);
      await onUploaded(url);
      setMessage({ text: "Gespeichert. Jedes Bild geht noch kurz durch die Bildprüfung.", ok: true });
    } catch (error) {
      setMessage({ text: uploadProblemText(error), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const choose = () => {
    if (busy) return;
    Alert.alert(label, "Woher kommt das Bild?", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Aus der Galerie", onPress: () => { void run("library"); } },
      { text: "Foto aufnehmen", onPress: () => { void run("camera"); } },
    ]);
  };

  const frame = shape === "banner" ? styles.banner : shape === "round" ? styles.round : styles.square;
  return (
    <View style={styles.wrap} testID={testID}>
      <Body style={styles.label}>{label}</Body>
      <Pressable
        onPress={choose}
        accessibilityRole="button"
        accessibilityLabel={`${label} ändern`}
        accessibilityHint="Foto aufnehmen oder aus der Galerie wählen"
        accessibilityState={{ busy }}
        style={({ pressed }) => [styles.pick, shape === "banner" && styles.pickBanner, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={[styles.frame, frame]}>
          <MediaImage uri={value || undefined} style={StyleSheet.absoluteFill} fallback={fallback || <Ionicons name="image-outline" color={colors.muted} size={24} />} />
        </View>
        <View style={[styles.badge, shape === "banner" && styles.badgeBanner]}>
          <Ionicons name={busy ? "cloud-upload-outline" : "camera-outline"} color={colors.black} size={16} />
        </View>
      </Pressable>
      {busy ? <Muted testID={`${testID}-busy`}>Wird hochgeladen …</Muted> : null}
      {message ? <Muted style={message.ok ? styles.ok : styles.problem} testID={`${testID}-message`} accessibilityLiveRegion="polite">{message.text}</Muted> : null}
      {hint && !message && !busy ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  label: {
    fontWeight: "800",
  },
  pick: {
    alignSelf: "flex-start",
  },
  pickBanner: {
    alignSelf: "stretch",
  },
  pressed: {
    opacity: 0.85,
  },
  frame: {
    alignItems: "center",
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  round: {
    borderRadius: 48,
    height: 96,
    width: 96,
  },
  square: {
    borderRadius: radius.lg,
    height: 96,
    width: 96,
  },
  banner: {
    aspectRatio: 3,
    borderRadius: radius.lg,
    width: "100%",
  },
  badge: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderColor: colors.black,
    borderRadius: 16,
    borderWidth: 2,
    bottom: -4,
    height: 32,
    justifyContent: "center",
    position: "absolute",
    right: -4,
    width: 32,
  },
  badgeBanner: {
    bottom: 8,
    right: 8,
  },
  ok: {
    color: colors.success,
  },
  problem: {
    color: colors.gold,
  },
});
