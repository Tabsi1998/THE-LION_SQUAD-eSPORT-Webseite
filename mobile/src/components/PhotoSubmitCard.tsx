import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import { uploadPartForAsset, type PickedAsset } from "../lib/chatAttachments";
import { submissionDoneText, submissionHint, type PhotoSubmissionInfo } from "../lib/gallery";
import { colors, radius } from "../theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { Body, Heading, Muted } from "./Text";

// Fotos vom Event einsenden (#1186): im Album eines Events für Mitglieder, bis eine Woche nach dem Event - aus der
// Galerie (mehrere auf einmal) oder mit der Kamera. Ohne den Haken „einverstanden“ geht nichts hinaus; der Name am Foto
// lässt sich abwählen. Der Server speichert die Bilder neu (ohne Ort und Kamera-Daten), schickt sie durch die
// Bildprüfung und zeigt sie erst nach der Freigabe durch den Vorstand.

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export function PhotoSubmitCard({ albumId, info, onSent }: { albumId: string; info: PhotoSubmissionInfo | null | undefined; onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [consent, setConsent] = useState(false);
  const [credit, setCredit] = useState(true);
  const [sending, setSending] = useState<{ at: number; of: number } | null>(null);
  const [done, setDone] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [note, setNote] = useState("");

  if (!info) return null;
  const hint = submissionHint(info);
  if (!info.can_submit && !done) return hint ? <Muted testID="photo-submit-closed">{hint}</Muted> : null;
  const room = Math.max(0, info.remaining - assets.length);

  const add = (picked: PickedAsset[]) => {
    const fitting = picked.filter((asset) => !asset.mimeType || ALLOWED.has(asset.mimeType));
    const taken = fitting.slice(0, room);
    const left = picked.length - taken.length;
    setAssets((current) => [...current, ...taken]);
    setNote(left ? `${left} ${left === 1 ? "Bild passt" : "Bilder passen"} nicht dazu – nur PNG, JPG oder WebP und höchstens ${info.remaining} Fotos.` : "");
    setDone("");
    setErrors([]);
  };

  const fromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: room, quality: 0.85 });
    if (!result.canceled && result.assets?.length) add(result.assets);
  };

  const fromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setNote("Ohne Kamera-Erlaubnis geht nur ein Bild aus der Galerie.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (!result.canceled && result.assets?.[0]) add([result.assets[0]]);
  };

  const send = async () => {
    if (!consent || !assets.length) return;
    let sent = 0;
    const failed: string[] = [];
    for (let index = 0; index < assets.length; index += 1) {
      setSending({ at: index + 1, of: assets.length });
      const form = new FormData();
      form.append("file", uploadPartForAsset(assets[index], "image") as unknown as Blob);
      form.append("consent", "true");
      form.append("credit", credit ? "true" : "false");
      try {
        await api.post(`/gallery/${encodeURIComponent(albumId)}/submissions`, form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120_000 });
        sent += 1;
      } catch (err) {
        failed.push(errorMessage(err, "Hochladen hat nicht geklappt."));
      }
    }
    setSending(null);
    setAssets([]);
    setConsent(false);
    setErrors(failed);
    setDone(submissionDoneText(sent, failed.length));
    if (sent) onSent?.();
  };

  return (
    <Card style={styles.card} testID="photo-submit">
      <Heading>Warst du dabei?</Heading>
      {hint ? <Muted testID="photo-submit-hint">{hint}</Muted> : null}
      {done ? <Body style={styles.done} testID="photo-submit-done">{done}</Body> : null}
      {errors.map((line, index) => <Muted key={`${index}-${line}`} style={styles.error}>{line}</Muted>)}
      {!open && info.can_submit ? <Button label="Fotos einsenden" icon="images-outline" arrow={false} onPress={() => setOpen(true)} testID="photo-submit-open" /> : null}
      {open && info.can_submit ? (
        <View style={styles.stack}>
          <View style={styles.row}>
            <Button label="Aus der Galerie" variant="secondary" icon="image-outline" compact disabled={!room || !!sending} onPress={() => { void fromLibrary(); }} testID="photo-submit-library" />
            <Button label="Foto aufnehmen" variant="secondary" icon="camera-outline" compact disabled={!room || !!sending} onPress={() => { void fromCamera(); }} testID="photo-submit-camera" />
          </View>
          {assets.length ? (
            <View style={styles.thumbs} testID="photo-submit-files">
              {assets.map((asset, index) => (
                <View key={`${asset.uri}-${index}`} style={styles.thumb}>
                  <Image source={{ uri: asset.uri }} style={styles.image} accessibilityLabel={`Foto ${index + 1}`} />
                  {!sending ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Foto ${index + 1} entfernen`} onPress={() => setAssets((current) => current.filter((_, at) => at !== index))} hitSlop={8} style={styles.remove}>
                      <Ionicons name="close" size={14} color={colors.white} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          {note ? <Muted style={styles.note}>{note}</Muted> : null}
          <Pressable onPress={() => setConsent((current) => !current)} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: consent }} testID="photo-submit-consent">
            <View style={[styles.checkbox, consent && styles.checkboxActive]} />
            <Body style={styles.flex}>Die Personen auf den Fotos sind einverstanden, dass die Bilder in der Galerie erscheinen.</Body>
          </Pressable>
          <Pressable onPress={() => setCredit((current) => !current)} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: credit }} testID="photo-submit-credit">
            <View style={[styles.checkbox, credit && styles.checkboxActive]} />
            <Body style={styles.flex}>Mit meinem Namen zeigen („Foto: …“)</Body>
          </Pressable>
          <Button
            label={sending ? `Sende ${sending.at} von ${sending.of} …` : assets.length ? `${assets.length} ${assets.length === 1 ? "Foto" : "Fotos"} senden` : "Senden"}
            busy={!!sending}
            disabled={!consent || !assets.length}
            arrow={false}
            onPress={() => { void send(); }}
            testID="photo-submit-send"
          />
          <Muted>Die Fotos erscheinen erst nach der Freigabe durch den Vorstand.</Muted>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  stack: { gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  thumb: { borderRadius: radius.lg, height: 72, overflow: "hidden", width: 72 },
  image: { height: "100%", width: "100%" },
  remove: { backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 10, padding: 3, position: "absolute", right: 4, top: 4 },
  checkRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  checkbox: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, height: 20, width: 20 },
  checkboxActive: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  flex: { flex: 1, minWidth: 0 },
  done: { color: colors.success },
  note: { color: colors.gold },
  error: { color: colors.live },
});
