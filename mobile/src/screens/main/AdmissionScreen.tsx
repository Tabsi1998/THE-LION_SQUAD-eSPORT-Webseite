import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
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
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { colors, radius } from "../../theme";

// Einlass bei der Generalversammlung (#845, Entscheidung B): die Kamera liest den QR-Code der Mitgliedskarte, der
// Server (Vereinsmodul) setzt die Anwesenheit - groß steht, was passiert ist: „Anwesend: <Name>, stimmberechtigt“
// oder der Grund, warum nicht. Doppelt scannen ändert nichts; ohne Karte geht die Mitgliedsnummer; eine Rücknahme
// braucht einen Grund. Sichtbar nur für den Vorstand (Bereich „Verein“) - der Server prüft es bei jedem Aufruf.

type Props = NativeStackScreenProps<MoreStackParamList, "Admission">;

// Mehrere Geräte scannen gleichzeitig (#1063): so oft fragt der Einlass nach, solange er vorne ist - dazu sofort bei einer
// Live-Meldung und beim Zurückkommen.
const ADMISSION_POLL_MS = 10_000;
const ADMISSION_LIVE_RESOURCES = ["admin/admission"] as const;

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
  const [stale, setStale] = useState(false);
  const [number, setNumber] = useState("");
  // Die offene Rücknahme gehört zu genau einer Versammlung (#1064).
  const [undoFor, setUndoFor] = useState<{ meetingId: number; memberId: number } | null>(null);
  const [reason, setReason] = useState("");
  const [scanning, setScanning] = useState(true);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const getPermissionRef = useRef(getPermission);
  getPermissionRef.current = getPermission;
  const gate = useRef(new ScanGate()).current;
  // Kamera und Nachfragen nur, solange der Einlass vorne ist (#1056): App im Vordergrund und kein anderer Screen darüber.
  const focused = useIsFocused();
  const appActive = useAppActive();
  const live = focused && appActive;
  const liveRef = useRef(live);
  liveRef.current = live;
  // Welche Versammlung gerade gilt, und eine Kennung, die jeder Wechsel weiterzählt (#1005, #1064): eine Antwort zeigt
  // nur etwas an, wenn beides noch stimmt - auch nach einem Wechsel hin und zurück.
  const meetingRef = useRef<number | null>(null);
  const epochRef = useRef(0);
  // Ein Scan auf einmal (#1056): die Sperre steht sofort, nicht erst nach dem nächsten Zeichnen.
  const busyRef = useRef(false);
  // Reihenfolge der Abfragen (#1063): nur die zuletzt gestartete zählt, und keine, die vor einem eigenen Scan losging.
  const loadSeq = useRef(0);
  const changeSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epochRef.current += 1;
    };
  }, []);

  // Andere Versammlung (angetippt oder nach dem Nachladen): Ergebnis, offene Rücknahme und Scan-Sperre gehören zur alten
  // (#1005) - gleich beim Wechsel, nicht erst nach dem Zeichnen (#1064).
  const selectMeeting = useCallback((id: number | null) => {
    if (id === meetingRef.current) return;
    meetingRef.current = id;
    epochRef.current += 1;
    gate.reset();
    setMeetingId(id);
    setResult(null);
    setUndoFor(null);
    setReason("");
  }, [gate]);

  /** `quiet`: Nachfragen im Hintergrund - ein Aussetzer lässt den letzten Stand stehen statt eines Fehlerbildschirms. */
  const load = useCallback(async (quiet = false) => {
    const seq = ++loadSeq.current;
    const changes = changeSeq.current;
    try {
      const data = await loadAdmission();
      if (!mounted.current || seq !== loadSeq.current || changes !== changeSeq.current) return;
      setView(data);
      setStale(false);
      // Nur eine Versammlung behalten, die es noch gibt; sonst die erste gültige (#1005).
      selectMeeting(data.meetings.some((item) => item.id === meetingRef.current) ? meetingRef.current : data.meetings[0]?.id ?? null);
    } catch (error) {
      if (!mounted.current || seq !== loadSeq.current) return;
      const failed: AdmissionView = { ready: false, text: errorMessage(error, "Der Einlass ist gerade nicht erreichbar."), meetings: [] };
      setView((current) => (quiet && current?.ready ? current : failed));
      setStale(true);
    }
  }, [selectMeeting]);

  // Beim Öffnen, beim Zurückkommen (Hintergrund, anderer Screen) und alle zehn Sekunden: Zahlen und Liste neu; dazu das
  // Kamerarecht - es kann inzwischen in den Einstellungen geändert worden sein.
  useEffect(() => {
    if (!live) return undefined;
    void load(true);
    void getPermissionRef.current?.()?.catch?.(() => undefined);
    const timer = setInterval(() => { void load(true); }, ADMISSION_POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);
  const loadQuietly = useCallback(() => load(true), [load]);
  useLiveRefresh(loadQuietly, ADMISSION_LIVE_RESOURCES, { enabled: live });

  const meeting = (view?.meetings || []).find((item) => item.id === meetingId) || null;

  const patchMeeting = (id: number, change: (item: AdmissionMeeting) => AdmissionMeeting) => {
    // Ein eigener Scan ist neuer als jede Abfrage, die vorher losging (#1063).
    changeSeq.current += 1;
    setView((current) => (current ? { ...current, meetings: current.meetings.map((item) => (item.id === id ? change(item) : item)) } : current));
  };

  /** Ein Auftrag für genau diese Versammlung: `current()` sagt später, ob seine Antwort noch angezeigt werden darf. */
  const ticket = (id: number) => {
    const epoch = epochRef.current;
    return { id, current: () => mounted.current && epochRef.current === epoch && meetingRef.current === id };
  };

  const admit = async (payload: { code?: string; number?: string }) => {
    if (!meeting || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const job = ticket(meeting.id);
    try {
      const data = await admitMember(job.id, payload);
      if (!mounted.current) return;
      patchMeeting(job.id, (item) => rememberAdmission(item, data));
      if (!job.current()) return;
      setResult(resultFromScan(data));
      if (payload.number) setNumber("");
    } catch (error) {
      if (job.current()) setResult(resultFromError(error));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const undo = async (row: AdmissionRow) => {
    const text = reason.trim();
    if (!meeting || busyRef.current || !text || undoFor?.meetingId !== meeting.id || undoFor.memberId !== row.member_id || meetingRef.current !== meeting.id) return;
    busyRef.current = true;
    setBusy(true);
    const job = ticket(meeting.id);
    try {
      const data = await undoAdmission(job.id, row.member_id, text);
      if (!mounted.current) return;
      patchMeeting(job.id, (item) => rememberAdmission(item, data));
      if (!job.current()) return;
      setResult({ tone: "info", headline: `Zurückgenommen: ${row.name}`, detail: `Grund: ${text}` });
      setUndoFor(null);
      setReason("");
    } catch (error) {
      if (job.current()) setResult(resultFromError(error, "Nicht zurückgenommen"));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const onBarcode = ({ data }: { data: string }) => {
    // Ein Bild, das nach dem Verlassen noch ankommt, oder ein zweites, während der erste Scan läuft, zählt nicht (#1056).
    if (!liveRef.current || busyRef.current || !gate.accept(data)) return;
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

        {view?.ready && !view.meetings.length ? (
          <Card testID="admission-no-meeting">
            <Body>Gerade ist keine Versammlung zum Einlass offen. Zum Nachladen nach unten ziehen.</Body>
          </Card>
        ) : null}

        {view?.ready && meeting ? (
          <>
            {view.meetings.length > 1 ? (
              <View style={styles.meetingRow} testID="admission-meetings">
                {view.meetings.map((item) => (
                  <Pressable key={item.id} onPress={() => selectMeeting(item.id)} accessibilityRole="button" accessibilityState={{ selected: item.id === meeting.id }}
                    style={[styles.meetingChip, item.id === meeting.id && styles.meetingChipActive]} testID={`admission-meeting-${item.id}`}>
                    <Text style={[styles.meetingChipText, item.id === meeting.id && styles.meetingChipTextActive]}>{item.title}{item.time ? ` · ${item.time}` : ""}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Card testID="admission-meeting-card">
              <Body style={styles.meetingTitle}>{meeting.title}{meeting.time ? ` · ${meeting.time}` : ""}{meeting.place ? ` · ${meeting.place}` : ""}</Body>
              <Text style={[styles.counts, { color: meeting.counts?.quorum_reached ? colors.success : colors.gold }]} testID="admission-counts">{quorumText(meeting.counts)}</Text>
              {stale ? <Muted style={styles.stale} testID="admission-stale">Verbindung gestört – die Zahlen sind vielleicht nicht aktuell.</Muted> : null}
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
                scanning && live ? (
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
                        <Pressable onPress={() => { setUndoFor({ meetingId: meeting.id, memberId: row.member_id }); setReason(""); }} accessibilityRole="button" style={styles.undoButton} testID={`admission-undo-${row.member_id}`}>
                          <Ionicons name="arrow-undo-outline" size={14} color={colors.muted} />
                          <Text style={styles.undoText}>Zurücknehmen</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {undoFor?.meetingId === meeting.id && undoFor.memberId === row.member_id ? (
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
  meetingChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8 },
  meetingChipActive: { borderColor: colors.cyan, backgroundColor: "rgba(41,182,232,0.12)" },
  meetingChipText: { color: colors.muted, fontSize: 13 },
  meetingChipTextActive: { color: colors.white, fontWeight: "700" },
  meetingTitle: { fontWeight: "700" },
  counts: { marginTop: 4, fontSize: 13 },
  stale: { marginTop: 4, fontSize: 12 },
  result: { borderWidth: 1, borderRadius: radius.lg, padding: 18, backgroundColor: "rgba(255,255,255,0.03)", gap: 6 },
  resultHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  resultHeadline: { fontSize: 24, fontWeight: "900", flex: 1 },
  resultDetail: { fontSize: 15 },
  scanner: { height: 260, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  camera: { flex: 1 },
  cameraOff: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 20 },
  cameraToggle: { position: "absolute", right: 10, top: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  permissionText: { textAlign: "center" },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
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
