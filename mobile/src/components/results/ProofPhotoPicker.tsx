import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { api, errorMessage } from "../../lib/api";
import { uploadPartForAsset, type PickedAsset } from "../../lib/chatAttachments";
import { colors } from "../../theme";
import { Muted } from "../Text";

// Foto vom Ergebnis (#1157, #1158): Kamera oder Galerie, ein Bild je Meldung. Es wird sofort hochgeladen - der Server
// speichert es neu (ohne Ort und Kamera-Daten) und zeigt es nur der Gegenseite und der Turnierleitung, nach der
// Bildprüfung. Die Kamera nutzt die Kamera-Erlaubnis, die die App für den Einlass schon kennt.

export type ProofPhoto = { status: "uploading" | "ready" | "error"; previewUri: string; id?: string; error?: string } | null;

export function useProofPhotoUpload(matchId: string, onChange: (photo: ProofPhoto) => void) {
  return useCallback(async (asset: PickedAsset) => {
    onChange({ status: "uploading", previewUri: asset.uri });
    try {
      const form = new FormData();
      form.append("file", uploadPartForAsset(asset, "image") as unknown as Blob);
      const { data } = await api.post<{ id: string }>(`/matches/${matchId}/proof-photos`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120_000,
      });
      onChange({ status: "ready", previewUri: asset.uri, id: data.id });
    } catch (err) {
      onChange({ status: "error", previewUri: asset.uri, error: errorMessage(err, "Hochladen hat nicht geklappt.") });
    }
  }, [matchId, onChange]);
}

export function ProofPhotoPicker({ matchId, value, onChange, testID = "proof-photo" }: { matchId: string; value: ProofPhoto; onChange: (photo: ProofPhoto) => void; testID?: string }) {
  const upload = useProofPhotoUpload(matchId, onChange);

  const fromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      onChange({ status: "error", previewUri: "", error: "Ohne Kamera-Erlaubnis geht nur ein Bild aus der Galerie." });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (!result.canceled && result.assets?.[0]) await upload(result.assets[0]);
  };

  const fromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 0.85 });
    if (!result.canceled && result.assets?.[0]) await upload(result.assets[0]);
  };

  return (
    <View style={styles.stack} testID={testID}>
      <Muted style={styles.label}>Foto vom Ergebnis (freiwillig)</Muted>
      {value && value.previewUri ? (
        <View style={styles.preview}>
          <View style={styles.thumb}>
            <Image source={{ uri: value.previewUri }} style={styles.image} accessibilityLabel="Foto vom Ergebnis" />
            {value.status === "uploading" ? <View style={styles.busy}><ActivityIndicator color={colors.white} /></View> : null}
          </View>
          <Muted style={[styles.flex, value.status === "error" && styles.error]} testID={`${testID}-state`}>
            {value.status === "error" ? value.error : value.status === "uploading" ? "Wird hochgeladen …" : "Foto angehängt – sehen nur die Gegenseite und die Turnierleitung."}
          </Muted>
          <Pressable accessibilityRole="button" accessibilityLabel="Foto entfernen" onPress={() => onChange(null)} hitSlop={10} testID={`${testID}-remove`}>
            <Ionicons name="close" size={20} color={colors.muted} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          <Pressable accessibilityRole="button" onPress={() => { void fromCamera(); }} style={styles.button} testID={`${testID}-camera`}>
            <Ionicons name="camera-outline" size={18} color={colors.cyan} />
            <Muted style={styles.buttonText}>Foto aufnehmen</Muted>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { void fromGallery(); }} style={styles.button} testID={`${testID}-gallery`}>
            <Ionicons name="image-outline" size={18} color={colors.cyan} />
            <Muted style={styles.buttonText}>Aus der Galerie</Muted>
          </Pressable>
        </View>
      )}
      {value && !value.previewUri && value.error ? <Muted style={styles.error}>{value.error}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  busy: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.5)", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  button: { alignItems: "center", borderColor: "rgba(41,182,232,0.5)", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 6, minHeight: 44, paddingHorizontal: 12 },
  buttonText: { color: colors.cyan, fontWeight: "900" },
  error: { color: colors.live, fontWeight: "800" },
  flex: { flex: 1, minWidth: 0 },
  image: { height: "100%", width: "100%" },
  label: { fontWeight: "900" },
  preview: { alignItems: "center", backgroundColor: colors.black, borderColor: colors.border, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 10, padding: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stack: { gap: 8 },
  thumb: { borderRadius: 6, height: 56, overflow: "hidden", width: 76 },
});
