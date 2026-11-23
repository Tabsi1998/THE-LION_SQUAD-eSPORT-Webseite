import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { useSingleFlight } from "../../lib/useSingleFlight";
import { uploadPartForAsset, type PickedAsset } from "../../lib/chatAttachments";
import { openLink } from "../../lib/openLink";
import { colors, radius } from "../../theme";
import { AuthorizedImage } from "../AuthorizedImage";
import { Button } from "../Button";
import { Body, Muted } from "../Text";

// Nachweise zu einem Bezug (#2360; App #2173) wie frontend/src/components/tls/results/ProofList.jsx: mehrere Bilder und Video-Links
// zu einem Vorfall oder einem Verfahren. Der Server entscheidet, wer was sieht und wer hinzufügen oder entfernen darf
// (`can_add`, `can_remove`); hier wird nur gezeigt, was er liefert. Ein Video ist immer nur ein Link, der im Browser aufgeht.
// Die MOSS-Datei (ZIP) gibt es nur im Web - die App zeigt dazu den Hinweis.

export type ProofItem = {
  id: string;
  type?: "image" | "link" | "file" | string;
  kind?: string;
  side?: string | null;
  own?: boolean;
  own_side?: boolean;
  can_remove?: boolean;
  url?: string | null;
  link?: string | null;
  scan_state?: string | null;
  removed?: boolean;
};
type ProofData = { items?: ProofItem[]; open?: boolean; can_add?: boolean; limit?: number; link_max_length?: number };

/** Was als Nachweis zählt (Regelwerk § 10.6) - wie im Web. */
export function proofHintText(limit = 10): string {
  return `Auf Bildern und Videos muss die Ingame-Uhr oder ein anderer Zeitstempel zu sehen sein. Videos gibst du als Link an (nur https, etwa ungelistet hochgeladen), mindestens 720p und 15 Sekunden; bei mehr als zwei Minuten schreib die Zeitstellen dazu (Regelwerk § 10.6). Höchstens ${limit} Nachweise je Seite.`;
}

function linkLabel(link?: string | null): string {
  try {
    const url = new URL(String(link || ""));
    const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
    return `${url.hostname}${rest.length > 40 ? `${rest.slice(0, 40)}…` : rest}`;
  } catch {
    return String(link || "");
  }
}

function sideName(item: ProofItem, sideLabels?: Record<string, string> | null): string {
  if (!item.side) return "Leitung";
  return sideLabels?.[item.side] || (item.own_side ? "Eigene Seite" : "Gegenseite");
}

export function ProofListCard({ matchId, kind, refId = "", title = "Nachweise", sideLabels = null, testID = "proof-list" }: {
  matchId: string;
  kind: "incident" | "protest" | "statement" | "moss" | "report";
  refId?: string;
  title?: string;
  sideLabels?: Record<string, string> | null;
  testID?: string;
}) {
  const { accessToken } = useAuth();
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; data: ProofData | null }>({ status: "loading", data: null });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<ProofData>(`/matches/${matchId}/proofs`, { params: { kind, ref_id: refId } });
      setState({ status: "ready", data: data || {} });
    } catch {
      setState({ status: "error", data: null });
    }
  }, [kind, matchId, refId]);

  useEffect(() => {
    setState({ status: "loading", data: null });
    void load();
  }, [load]);

  // Gegen Doppeltippen (#2173): ein Hochladen bzw. Entfernen zur Zeit.
  const once = useSingleFlight();
  const send = async (fill: (form: FormData) => void, fallback: string) => Boolean(await once(async () => {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("ref_id", refId);
      fill(form);
      await api.post(`/matches/${matchId}/proofs`, form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120_000 });
      await load();
      return true;
    } catch (failure) {
      setError(errorMessage(failure, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }));

  const addImage = async (asset?: PickedAsset | null) => {
    if (asset) await send((form) => form.append("file", uploadPartForAsset(asset, "image") as unknown as Blob), "Hochladen hat nicht geklappt.");
  };
  const fromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Ohne Kamera-Erlaubnis geht nur ein Bild aus der Galerie.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (!result.canceled) await addImage(result.assets?.[0]);
  };
  const fromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 0.85 });
    if (!result.canceled) await addImage(result.assets?.[0]);
  };
  const addLink = async () => {
    const value = link.trim();
    if (!value) {
      setError("Bitte einen Link angeben.");
      return;
    }
    if (!/^https:\/\//i.test(value)) {
      setError("Nur Links mit https:// sind erlaubt.");
      return;
    }
    if (await send((form) => form.append("link", value), "Der Link ließ sich nicht hinzufügen.")) setLink("");
  };
  const remove = async (item: ProofItem) => {
    if (confirmId !== item.id) {
      setConfirmId(item.id);
      return;
    }
    await once(async () => {
      setBusy(true);
      setError("");
      try {
        await api.delete(`/matches/${matchId}/proofs/${item.id}`);
        await load();
      } catch (failure) {
        setError(errorMessage(failure, "Entfernen hat nicht geklappt."));
      } finally {
        setConfirmId(null);
        setBusy(false);
      }
    });
  };

  const data = state.data;
  const items = data?.items || [];
  return (
    <View style={styles.stack} testID={testID}>
      <Muted style={styles.eyebrow}>{title}</Muted>
      {state.status === "loading" ? <Muted>Nachweise werden geladen …</Muted> : null}
      {state.status === "error" ? (
        <Pressable onPress={() => { void load(); }} accessibilityRole="button" testID={`${testID}-load-error`}>
          <Muted>Die Nachweise ließen sich nicht laden. <Muted style={styles.link}>Noch einmal versuchen</Muted></Muted>
        </Pressable>
      ) : null}
      {state.status === "ready" ? (
        <>
          {items.length ? items.map((item) => {
            const waiting = item.type !== "link" && item.own && ["pending", "review"].includes(String(item.scan_state || ""));
            return (
              <View key={item.id} style={styles.item} testID={`${testID}-item-${item.id}`}>
                {item.type === "link" ? (
                  <Pressable onPress={() => { void openLink(String(item.link || "")); }} accessibilityRole="link" style={styles.flex} testID={`${testID}-link-${item.id}`}>
                    <Body numberOfLines={1} style={styles.linkText}>{linkLabel(item.link)}</Body>
                  </Pressable>
                ) : item.type === "file" ? (
                  <Muted style={styles.flex}>MOSS-Datei – herunterladen im Web</Muted>
                ) : (
                  <View style={styles.row}>
                    {item.url ? <AuthorizedImage url={item.url} token={accessToken} width={400} style={styles.thumb} /> : <View style={styles.thumb} />}
                    <Muted style={styles.flex}>Bild</Muted>
                  </View>
                )}
                <Muted>{sideName(item, sideLabels)}{item.removed ? " · von der Seite entfernt, nur noch für die Leitung sichtbar" : ""}{waiting ? " · wird noch geprüft, bis dahin nur für dich sichtbar" : ""}</Muted>
                {item.can_remove ? (
                  <Pressable onPress={() => { void remove(item); }} disabled={busy} accessibilityRole="button" accessibilityLabel={confirmId === item.id ? "Wirklich entfernen" : "Nachweis entfernen"}
                    style={styles.remove} testID={`${testID}-remove-${item.id}`}>
                    {confirmId === item.id ? <Muted style={styles.danger}>{item.kind === "moss" ? "Wirklich entfernen? Die Leitung sieht ihn weiter." : "Wirklich entfernen?"}</Muted>
                      : <Ionicons name="trash-outline" size={18} color={colors.muted} />}
                  </Pressable>
                ) : null}
              </View>
            );
          }) : <Muted testID={`${testID}-empty`}>Noch keine Nachweise.</Muted>}
          {data?.can_add ? (
            <View style={styles.stack} testID={`${testID}-add`}>
              <View style={styles.row}>
                <View style={styles.flex}><Button label="Foto aufnehmen" variant="secondary" icon="camera-outline" arrow={false} onPress={() => { void fromCamera(); }} disabled={busy} testID={`${testID}-camera`} /></View>
                <View style={styles.flex}><Button label="Bild hinzufügen" variant="secondary" icon="image-outline" arrow={false} onPress={() => { void fromGallery(); }} disabled={busy} testID={`${testID}-gallery`} /></View>
              </View>
              <TextInput value={link} onChangeText={setLink} maxLength={data.link_max_length || 500} placeholder="Link zum Video (https://…)" placeholderTextColor={colors.muted}
                autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} accessibilityLabel="Link zum Video" testID={`${testID}-link-input`} />
              <Button label="Link hinzufügen" variant="secondary" icon="link-outline" arrow={false} onPress={() => { void addLink(); }} disabled={busy} testID={`${testID}-link-add`} />
              {busy ? <ActivityIndicator color={colors.cyan} /> : null}
              {kind === "moss" ? <Muted>Die MOSS-Datei (ZIP) lädst du im Web hoch.</Muted> : null}
              <Muted testID={`${testID}-hint`}>{proofHintText(data.limit)}</Muted>
            </View>
          ) : (
            <Muted testID={`${testID}-closed`}>{data?.open ? "Hier kannst du keine Nachweise hinzufügen." : "Abgeschlossen – die Nachweise lassen sich nicht mehr ändern."}</Muted>
          )}
          <Muted>{kind === "moss" ? "MOSS-Nachweise sehen nur du, Captain und Vertreter deiner Seite und die Leitung – nie die Gegenseite." : "Nachweise sehen nur die beiden Seiten dieses Spiels und die Leitung."}</Muted>
        </>
      ) : null}
      {error ? <Muted style={styles.danger} accessibilityRole="alert" testID={`${testID}-error`}>{error}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  danger: { color: "#FF6B60", fontWeight: "800" },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  flex: { flex: 1, minWidth: 0 },
  input: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, color: colors.white, minHeight: 44, paddingHorizontal: 12 },
  item: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 4, padding: 8 },
  link: { color: colors.cyan, fontWeight: "800", textDecorationLine: "underline" },
  linkText: { color: colors.cyan, fontWeight: "800" },
  remove: { alignItems: "flex-end", justifyContent: "center", minHeight: 44 },
  row: { alignItems: "center", flexDirection: "row", gap: 8 },
  stack: { gap: 8 },
  thumb: { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 4, height: 56, width: 80 },
});
