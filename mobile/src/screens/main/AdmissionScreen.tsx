import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAppActive } from "../../seasons/halloween";
import {
  ScanGate,
  admitMember,
  loadAdmission,
  quorumText,
  rememberAdmission,
  resultFromError,
  resultFromScan,
  rowText,
  undoAdmission,
  type AdmissionMeeting,
  type AdmissionResult,
  type AdmissionRow,
  type AdmissionView,
} from "../../lib/admission";
import { errorMessage } from "../../lib/api";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Einlass bei der Generalversammlung (#845, Entscheidung B): die Kamera liest den QR-Code der Mitgliedskarte, der
// Server (Vereinsmodul) setzt die Anwesenheit - groß steht, was passiert ist: „Anwesend: <Name>, stimmberechtigt“
// oder der Grund, warum nicht. Doppelt scannen ändert nichts; ohne Karte geht die Mitgliedsnummer; eine Rücknahme
// braucht einen Grund. Sichtbar nur für den Vorstand (Bereich „Verein“) - der Server prüft es bei jedem Aufruf.

type Props = NativeStackScreenProps<MoreStackParamList, "Admission">;

const TONES: Record<AdmissionResult["tone"], { color: string; icon: "checkmark-circle" | "information-circle" | "close-circle" }> = {
  ok: { color: colors.success, icon: "checkmark-circle" },
  info: { color: colors.gold, icon: "information-circle" },
  error: { color: colors.live, icon: "close-circle" },
};

export function AdmissionScreen(_props: Props) {
  const [view, setView] = useState<AdmissionView | null>(null);
  const [meetingId, setMeetingId] = useState<number | null>(null);
  const [result, setResult] = useState<AdmissionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [number, setNumber] = useState("");
  const [undoFor, setUndoFor] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [scanning, setScanning] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const gate = useRef(new ScanGate()).current;
  const active = useAppActive();

  const load = useCallback(async () => {
    try {
      const data = await loadAdmission();
      setView(data);
      setMeetingId((current) => current ?? data.meetings[0]?.id ?? null);
    } catch (error) {
      setView({ ready: false, text: errorMessage(error, "Der Einlass ist gerade nicht erreichbar."), meetings: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const meeting = (view?.meetings || []).find((item) => item.id === meetingId) || null;

  const patchMeeting = (id: number, change: (item: AdmissionMeeting) => AdmissionMeeting) => {
    setView((current) => (current ? { ...current, meetings: current.meetings.map((item) => (item.id === id ? change(item) : item)) } : current));
  };

  const admit = async (payload: { code?: string; number?: string }) => {
    if (!meeting || busy) return;
    setBusy(true);
    try {
      const data = await admitMember(meeting.id, payload);
      setResult(resultFromScan(data));
      patchMeeting(meeting.id, (item) => rememberAdmission(item, data));
      if (payload.number) setNumber("");
    } catch (error) {
      setResult(resultFromError(error));
    } finally {
      setBusy(false);
    }
  };

  const undo = async (row: AdmissionRow) => {
    if (!meeting || busy || !reason.trim()) return;
    setBusy(true);
    try {
      const data = await undoAdmission(meeting.id, row.member_id, reason.trim());
      patchMeeting(meeting.id, (item) => rememberAdmission(item, data));
      setResult({ tone: "info", headline: `Zurückgenommen: ${row.name}`, detail: `Grund: ${reason.trim()}` });
      setUndoFor(null);
      setReason("");
    } catch (error) {
      setResult(resultFromError(error, "Nicht zurückgenommen"));
    } finally {
      setBusy(false);
    }
  };

  const onBarcode = ({ data }: { data: string }) => {
    if (busy || !gate.accept(data)) return;
    void admit({ code: data });
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const cameraReady = Boolean(permission?.granted);
  const tone = result ? TONES[result.tone] : null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.cyan} />} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Muted style={styles.eyebrow}>Vorstand</Muted>
          <Title>Einlass</Title>
          <Muted>Mitgliedskarte scannen – die Anwesenheit steht sofort in der Vereinsakte, Stimmrecht und Beschlussfähigkeit gleich mit.</Muted>
        </View>

        {!view ? <Muted testID="admission-loading">Lade …</Muted> : null}

        {view && !view.ready ? (
          <Card testID="admission-not-ready">
            <Body>{view.text || "Heute ist keine Generalversammlung angesetzt."}</Body>
          </Card>
        ) : null}

        {view?.ready && meeting ? (
          <>
            {view.meetings.length > 1 ? (
              <View style={styles.meetingRow} testID="admission-meetings">
                {view.meetings.map((item) => (
                  <Pressable key={item.id} onPress={() => setMeetingId(item.id)} accessibilityRole="button" accessibilityState={{ selected: item.id === meeting.id }}
                    style={[styles.meetingChip, item.id === meeting.id && styles.meetingChipActive]} testID={`admission-meeting-${item.id}`}>
                    <Text style={[styles.meetingChipText, item.id === meeting.id && styles.meetingChipTextActive]}>{item.title}{item.time ? ` · ${item.time}` : ""}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Card testID="admission-meeting-card">
              <Body style={styles.meetingTitle}>{meeting.title}{meeting.time ? ` · ${meeting.time}` : ""}{meeting.place ? ` · ${meeting.place}` : ""}</Body>
              <Text style={[styles.counts, { color: meeting.counts?.quorum_reached ? colors.success : colors.gold }]} testID="admission-counts">{quorumText(meeting.counts)}</Text>
            </Card>

            {result && tone ? (
              <View style={[styles.result, { borderColor: tone.color }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="admission-result">
                <View style={styles.resultHead}>
                  <Ionicons name={tone.icon} size={30} color={tone.color} />
                  <Text style={[styles.resultHeadline, { color: tone.color }]} testID="admission-result-headline">{result.headline}</Text>
                </View>
                {result.detail ? <Body style={styles.resultDetail}>{result.detail}</Body> : null}
              </View>
            ) : null}

            <View style={styles.scanner} testID="admission-scanner">
              {cameraReady ? (
                scanning && active ? (
                  <CameraView
                    style={styles.camera}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={busy ? undefined : onBarcode}
                    testID="admission-camera"
                  />
                ) : (
                  <Pressable onPress={() => setScanning(true)} style={styles.cameraOff} accessibilityRole="button" testID="admission-camera-resume">
                    <Ionicons name="camera-outline" size={28} color={colors.muted} />
                    <Muted>Kamera ist aus – antippen zum Scannen.</Muted>
                  </Pressable>
                )
              ) : (
                <View style={styles.cameraOff} testID="admission-camera-permission">
                  <Ionicons name="camera-outline" size={28} color={colors.muted} />
                  <Muted style={styles.permissionText}>
                    {permission?.canAskAgain === false
                      ? "Die App darf die Kamera nicht verwenden – bitte in den Android-Einstellungen unter Berechtigungen einschalten. Bis dahin geht die Mitgliedsnummer von Hand."
                      : "Zum Scannen braucht die App die Kamera – nur hier, nur am Eingang."}
                  </Muted>
                  {permission?.canAskAgain !== false ? <Button label="Kamera erlauben" variant="secondary" onPress={() => { void requestPermission(); }} testID="admission-camera-allow" /> : null}
                </View>
              )}
              {cameraReady && scanning ? (
                <Pressable onPress={() => setScanning(false)} style={styles.cameraToggle} accessibilityRole="button" accessibilityLabel="Kamera ausschalten" testID="admission-camera-pause">
                  <Ionicons name="pause" size={16} color={colors.white} />
                </Pressable>
              ) : null}
            </View>

            <Card>
              <FormInput label="Ohne Karte: Mitgliedsnummer" value={number} onChangeText={setNumber} keyboardType="number-pad" testID="admission-number" placeholder="z. B. 1042" placeholderTextColor={colors.muted} />
              <Button label={busy ? "Bitte warten …" : "Einlassen"} onPress={() => { if (number.trim()) void admit({ number: number.trim() }); }} disabled={busy || !number.trim()} testID="admission-number-submit" />
            </Card>

            <Heading>Zuletzt</Heading>
            {(meeting.recent || []).length ? (
              <View style={styles.list} testID="admission-recent">
                {(meeting.recent || []).map((row) => (
                  <View key={row.member_id} style={styles.row} testID={`admission-row-${row.member_id}`}>
                    <View style={styles.rowHead}>
                      <Body style={styles.rowName}>{row.name}</Body>
                      <Muted style={row.state === "present" ? undefined : styles.rowGone}>{rowText(row)}</Muted>
                      {row.state === "present" ? (
                        <Pressable onPress={() => { setUndoFor(row.member_id); setReason(""); }} accessibilityRole="button" style={styles.undoButton} testID={`admission-undo-${row.member_id}`}>
                          <Ionicons name="arrow-undo-outline" size={14} color={colors.muted} />
                          <Text style={styles.undoText}>Zurücknehmen</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {undoFor === row.member_id ? (
                      <View style={styles.undoForm}>
                        <FormInput label="Grund der Rücknahme" value={reason} onChangeText={setReason} maxLength={200} placeholder="z. B. falscher Ausweis" placeholderTextColor={colors.muted} testID="admission-undo-reason" />
                        <View style={styles.undoActions}>
                          <Button label="Rücknahme bestätigen" variant="danger" onPress={() => { void undo(row); }} disabled={busy || !reason.trim()} testID="admission-undo-confirm" />
                          <Pressable onPress={() => setUndoFor(null)} accessibilityRole="button" style={styles.cancel} testID="admission-undo-cancel"><Muted>Abbrechen</Muted></Pressable>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Muted testID="admission-recent-empty">Noch niemand eingelassen.</Muted>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  header: { gap: 4 },
  eyebrow: { textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: colors.cyan },
  meetingRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  meetingChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  meetingChipActive: { borderColor: colors.cyan, backgroundColor: "rgba(41,182,232,0.12)" },
  meetingChipText: { color: colors.muted, fontSize: 13 },
  meetingChipTextActive: { color: colors.white, fontWeight: "700" },
  meetingTitle: { fontWeight: "700" },
  counts: { marginTop: 4, fontSize: 13 },
  result: { borderWidth: 1, borderRadius: 4, padding: 18, backgroundColor: "rgba(255,255,255,0.03)", gap: 6 },
  resultHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  resultHeadline: { fontSize: 24, fontWeight: "900", flex: 1 },
  resultDetail: { fontSize: 15 },
  scanner: { height: 260, borderRadius: 6, overflow: "hidden", backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  camera: { flex: 1 },
  cameraOff: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 20 },
  cameraToggle: { position: "absolute", right: 10, top: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  permissionText: { textAlign: "center" },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: 4 },
  row: { padding: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)", gap: 8 },
  rowHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  rowName: { fontWeight: "700" },
  rowGone: { textDecorationLine: "line-through" },
  undoButton: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4 },
  undoText: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  undoForm: { gap: 8 },
  undoActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  cancel: { paddingVertical: 8 },
});
