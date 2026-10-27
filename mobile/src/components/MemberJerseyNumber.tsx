import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Button } from "./Button";
import { Card } from "./Card";
import { Glow, useReduceMotion } from "./motion";
import { Body, Heading, Muted } from "./Text";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  CHECK_DELAY_MS,
  checkState,
  jerseyRequestLine,
  parseJerseyInput,
  setByLine,
  syncNote,
  type CheckTone,
  type JerseyCheck,
  type JerseyRange,
  type JerseyView,
} from "../lib/jerseyNumber";
import { colors, motion, radius, roles } from "../theme";

// Meine Nummer in der App (#2050, wie die Karte im Web aus #2034): einmal selbst wählen - mit Live-Prüfung und
// Bestätigung -, danach nur über einen Antrag an den Vorstand, wie die Vereinsdaten. Nicht öffentlich: die Nummer sehen
// nur das Mitglied und der Vorstand, deshalb steht sie nur hier im eigenen Mitgliederbereich. Texte und Regeln wie in
// frontend/src/pages/user/JerseyNumberCard.jsx.

const TAKEN_TEXT = "Diese Nummer hat schon jemand.";
// Die Nummer setzt sich (#2050): leicht anheben und einblenden, einmal, nach dem Festlegen. Mit „Bewegung reduzieren“
// nur das Einblenden.
const SETTLE_LIFT = 10;
const SETTLE_SCALE = 0.96;
const settleEase = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

/** Erfolg beim Festlegen spüren - im selben Moment, in dem die Nummer erscheint; ohne Motor bleibt es still. */
function settleFeedback() {
  try {
    void Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {});
  } catch {
    // ohne Vibration weiter
  }
}

function isCanceled(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "CanceledError" || name === "AbortError";
}

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

// Live-Prüfung beim Tippen: kurz warten, ältere Antworten verwerfen, nie den Knopf freigeben, bevor der Server „frei“
// gesagt hat. Geprüft wird per POST - die Nummer gehört nicht in die Adresse und damit nicht ins Zugriffsprotokoll.
function useNumberCheck(input: string, range: JerseyRange | undefined, nonce = 0) {
  const [state, setState] = useState<{ result: JerseyCheck | null; busy: boolean; failed: boolean }>({ result: null, busy: false, failed: false });
  const seq = useRef(0);
  const local = parseJerseyInput(input, range);
  useEffect(() => {
    const mine = ++seq.current;
    if (local.value === null || local.error) {
      setState({ result: null, busy: false, failed: false });
      return undefined;
    }
    setState({ result: null, busy: true, failed: false });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.post<JerseyCheck>("/membership/me/jersey-number/check", { number: local.value }, { signal: controller.signal })
        .then(({ data }) => { if (mine === seq.current) setState({ result: data, busy: false, failed: false }); })
        .catch((error) => { if (mine === seq.current && !isCanceled(error)) setState({ result: null, busy: false, failed: true }); });
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [local.value, local.error, nonce]);
  return { local, ...state, view: checkState({ input, local: local.error, ...state }) };
}

const TONE_COLOR: Record<CheckTone, string> = { ok: roles.ok, bad: roles.warn, busy: colors.muted, idle: colors.muted };
const TONE_ICON: Record<CheckTone, keyof typeof Ionicons.glyphMap> = { ok: "checkmark", bad: "close", busy: "ellipsis-horizontal", idle: "ellipsis-horizontal" };

function CheckChip({ view, testID }: { view: { tone: CheckTone; text: string }; testID: string }) {
  if (view.tone === "idle") return <View testID={testID} accessibilityLiveRegion="polite" />;
  const color = TONE_COLOR[view.tone];
  return (
    <View testID={testID} data-tone={view.tone} accessibilityLiveRegion="polite" style={[styles.chip, { borderColor: color }]}>
      <Ionicons name={TONE_ICON[view.tone]} size={14} color={color} />
      <Muted style={[styles.chipText, { color }]}>{view.text}</Muted>
    </View>
  );
}

// Raster der Nummern im Bereich: frei zum Antippen, vergeben bzw. reserviert ausgegraut - ohne Namen. So muss niemand
// durchprobieren. Bei sehr großen Bereichen schickt der Server keine Liste, dann bleibt nur das Feld.
export function FreeGrid({ view, value, onPick, testID }: { view: JerseyView; value: number | null; onPick: (n: number) => void; testID: string }) {
  if (!Array.isArray(view.free_numbers) || !view.range) return null;
  const free = new Set(view.free_numbers);
  const numbers: number[] = [];
  for (let n = view.range.min; n <= view.range.max; n += 1) numbers.push(n);
  return (
    <View style={styles.grid} testID={testID}>
      <Muted style={styles.label}>Frei: {view.free_count} – zum Auswählen antippen</Muted>
      <View style={styles.cells} accessibilityLabel="Nummern im Bereich">
        {numbers.map((n) => {
          const open = free.has(n);
          const picked = open && value === n;
          return (
            <Pressable
              key={n}
              disabled={!open}
              onPress={() => onPick(n)}
              accessibilityRole="button"
              accessibilityLabel={open ? `${n} wählen` : `${n} nicht frei`}
              accessibilityState={{ disabled: !open, selected: picked }}
              hitSlop={2}
              testID={`${testID}-${n}`}
              style={({ pressed }) => [styles.cell, picked && styles.cellChosen, !open && styles.cellOff, pressed && open && styles.cellPressed]}
            >
              <Body style={[styles.cellText, picked && styles.cellTextChosen, !open && styles.cellTextOff]}>{n}</Body>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function NumberInput({ value, onChange, placeholder, large, testID, label }: { value: string; onChange: (text: string) => void; placeholder?: string; large?: boolean; testID: string; label: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={(text) => onChange(text.replace(/\s+/g, "").slice(0, 4))}
      keyboardType="number-pad"
      maxLength={4}
      autoComplete="off"
      autoCorrect={false}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      accessibilityLabel={label}
      testID={testID}
      style={[styles.input, styles.numberInput, large && styles.numberInputLarge]}
    />
  );
}

function ChooseForm({ view, onChosen }: { view: JerseyView; onChosen: (data: JerseyView) => void }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState("");
  const check = useNumberCheck(input, view.range, nonce);
  const ready = check.view.tone === "ok" && Boolean(check.result?.free) && !busy;
  const noneLeft = view.free_count === 0;
  const range = view.range || { min: 0, max: 99 };

  const send = async (number: number) => {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post<JerseyView>("/membership/me/jersey-number", { number, confirmed: true });
      onChosen(data);
    } catch (problem) {
      // 409: vergeben - meist hat sich jemand die Nummer eben gesichert. Gleich neu prüfen.
      setError(errorMessage(problem, statusOf(problem) === 409 ? TAKEN_TEXT : "Das hat nicht geklappt."));
      setNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!ready || check.local.value === null) return;
    const number = check.local.value;
    Alert.alert(
      `Die ${number} als deine Nummer festlegen?`,
      "Danach änderst du sie nicht mehr selbst – nur noch über einen Antrag an den Vorstand.",
      [{ text: "Abbrechen", style: "cancel" }, { text: "Festlegen", onPress: () => { void send(number); } }],
    );
  };

  return (
    <View style={styles.block} testID="jersey-choose-form">
      {view.again ? (
        <Muted style={styles.again} testID="jersey-again">Der Vorstand hat deine Nummer freigegeben – such dir einmal eine neue aus.</Muted>
      ) : null}
      <Body>
        Such dir eine Nummer von {range.min} bis {range.max} aus. Jede gibt es im Verein nur einmal.
        {view.reserved?.length ? ` Nicht wählbar: ${view.reserved.join(", ")}.` : ""}
      </Body>
      {noneLeft ? (
        <Muted style={styles.noneLeft} testID="jersey-none-left">Gerade ist keine Nummer frei. Melde dich beim Vorstand – er findet eine Lösung.</Muted>
      ) : (
        <>
          <View style={styles.inputRow}>
            <NumberInput value={input} onChange={(text) => { setInput(text); setError(""); }} placeholder={`${range.min}–${range.max}`} large label="Deine Nummer" testID="jersey-input" />
            <View style={styles.chipSlot}>
              <CheckChip view={check.view} testID="jersey-check" />
            </View>
          </View>
          <Button label={busy ? "Lege fest …" : "Nummer festlegen"} onPress={submit} disabled={!ready} busy={busy} arrow={false} testID="jersey-choose" />
          {error ? <Muted style={styles.error} testID="jersey-error">{error}</Muted> : null}
          <FreeGrid view={view} value={check.local.value} onPick={(n) => { setInput(String(n)); setError(""); }} testID="jersey-grid" />
        </>
      )}
      <Muted style={styles.small}>Einmal festgelegt, ändert sie nur noch der Vorstand.</Muted>
    </View>
  );
}

function RequestForm({ view, onSent, onCancel }: { view: JerseyView; onSent: () => void; onCancel: () => void }) {
  const [wished, setWished] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const check = useNumberCheck(wished, view.range);
  const wishBlocked = wished.trim() !== "" && check.view.tone !== "ok";
  const ready = reason.trim().length >= 3 && !wishBlocked && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/membership/me/jersey-number/requests", { wished: wished.trim() === "" ? null : check.local.value, reason: reason.trim() });
      onSent();
    } catch (problem) {
      setError(errorMessage(problem, statusOf(problem) === 409 ? TAKEN_TEXT : "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.block, styles.requestBox]} testID="jersey-request-form">
      <Muted style={styles.label}>Wunschnummer (optional)</Muted>
      <View style={styles.inputRow}>
        <NumberInput value={wished} onChange={setWished} label="Wunschnummer (optional)" testID="jersey-wish" />
        <View style={styles.chipSlot}>
          <CheckChip view={check.view} testID="jersey-wish-check" />
        </View>
      </View>
      <FreeGrid view={view} value={check.local.value} onPick={(n) => setWished(String(n))} testID="jersey-wish-grid" />
      <Muted style={styles.label}>Warum eine andere?</Muted>
      <TextInput
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={500}
        placeholder="Ein Satz reicht."
        placeholderTextColor={colors.muted}
        accessibilityLabel="Warum eine andere?"
        testID="jersey-reason"
        style={[styles.input, styles.multiline]}
      />
      <Muted style={styles.small}>Ohne Wunsch gibt dir der Vorstand die Wahl frei, und du suchst dir selbst eine neue aus.</Muted>
      {error ? <Muted style={styles.error} testID="jersey-request-error">{error}</Muted> : null}
      <Button label={busy ? "Sende …" : "Antrag senden"} onPress={() => { void submit(); }} disabled={!ready} busy={busy} arrow={false} testID="jersey-request-send" />
      <Button label="Abbrechen" variant="quiet" onPress={onCancel} disabled={busy} testID="jersey-request-cancel" />
    </View>
  );
}

/** Die große Nummer. Frisch festgelegt setzt sie sich: hebt sich leicht, blendet ein und leuchtet einmal in Gold. */
function SettledNumber({ number, fresh }: { number: number; fresh: boolean }) {
  const reduce = useReduceMotion();
  const settle = useSharedValue(fresh ? 0 : 1);
  useEffect(() => {
    if (!fresh) return;
    settle.set(0);
    settle.set(withTiming(1, { duration: reduce ? motion.mid : motion.slow, easing: settleEase }));
    // Nur beim Festlegen - nicht bei jedem Nachladen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);
  const style = useAnimatedStyle(() => {
    const t = settle.get();
    if (reduce) return { opacity: t };
    return { opacity: t, transform: [{ translateY: (1 - t) * SETTLE_LIFT }, { scale: SETTLE_SCALE + (1 - SETTLE_SCALE) * t }] };
  });
  return (
    <View style={styles.numberWrap}>
      <Animated.View style={style}>
        <Body style={styles.number} testID="jersey-number" data-fresh={fresh ? "1" : undefined} accessibilityLabel={`Deine Nummer: ${number}`}>
          {number}
        </Body>
      </Animated.View>
      <Glow active={fresh} tone="honor" delay={fresh ? motion.mid : 0} radius={radius.lg} testID="jersey-glow" />
    </View>
  );
}

export function MemberJerseyNumber() {
  const [view, setView] = useState<JerseyView | null>(null);
  const [asking, setAsking] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<JerseyView>("/membership/me/jersey-number");
      setView(data && typeof data === "object" ? data : null);
    } catch {
      // Ohne Antwort (älterer Server, kein Netz) keine Karte - kein Fehler im Mitgliederbereich.
      setView(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return null;

  // Funktion aus bzw. kein Mitglied: ein ruhiger Satz vom Server, keine Fehlermeldung.
  if (view.available !== true) {
    if (!view.text) return null;
    return (
      <Card style={styles.card} testID="jersey-card">
        <JerseyHeading />
        <Muted testID="jersey-off">{view.text}</Muted>
      </Card>
    );
  }

  const chosen = (data: JerseyView) => {
    setView(data);
    setFresh(true);
    if (data?.number !== null && data?.number !== undefined) {
      setNotice(`Die ${data.number} gehört jetzt dir.`);
      settleFeedback();
    }
  };
  const sync = syncNote(view.dolibarr);
  const requests = view.requests || [];
  const earlier = requests.filter((row) => row.status !== "received" && row.status !== "deciding").slice(0, 3);
  const hasNumber = view.number !== null && view.number !== undefined;

  return (
    <Card style={styles.card} testID="jersey-card">
      <JerseyHeading />
      <Muted style={styles.small}>Zum Beispiel fürs Trikot. Sehen können sie nur du und der Vorstand.</Muted>

      {!hasNumber ? (
        view.can_choose ? <ChooseForm view={view} onChosen={chosen} /> : null
      ) : (
        <View style={styles.block}>
          <View style={styles.numberRow}>
            <SettledNumber number={view.number as number} fresh={fresh} />
            <Muted style={styles.setBy} testID="jersey-set-by">
              {setByLine(view.set_by)}
              {view.chosen_at ? ` am ${formatDate(view.chosen_at)}` : ""}
            </Muted>
          </View>
          {notice ? <Body style={styles.notice} testID="jersey-notice">{notice}</Body> : null}
          {sync ? <Muted style={styles.sync} testID="jersey-sync">{sync}</Muted> : null}
          {view.open_request ? (
            <Body style={styles.openRequest} testID="jersey-open-request">
              Dein Antrag liegt beim Vorstand ({jerseyRequestLine(view.open_request)}, eingereicht am {formatDate(view.open_request.received_at)}).
            </Body>
          ) : asking ? (
            <RequestForm
              view={view}
              onCancel={() => setAsking(false)}
              onSent={() => {
                setAsking(false);
                setFresh(false);
                setNotice("Antrag gesendet – der Vorstand meldet sich.");
                void load();
              }}
            />
          ) : (
            <View style={styles.askRow}>
              <Button label="Andere Nummer beantragen" variant="secondary" onPress={() => { setAsking(true); setNotice(""); }} testID="jersey-ask" />
              <Muted style={styles.small}>Ändern geht nur über den Vorstand.</Muted>
            </View>
          )}
        </View>
      )}

      {earlier.length ? (
        <View style={styles.requests} testID="jersey-requests">
          <Muted style={styles.label}>Frühere Anträge</Muted>
          {earlier.map((row) => (
            <View key={row.id} style={styles.request}>
              <Body>{jerseyRequestLine(row)}</Body>
              <Muted>
                {row.status_label || row.status}
                {row.decision_reason ? ` – ${row.decision_reason}` : ""}
                {row.decided_at ? ` · ${formatDate(row.decided_at)}` : ""}
              </Muted>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function JerseyHeading() {
  return (
    <View style={styles.heading}>
      <Ionicons name="shirt-outline" size={18} color={colors.gold} />
      <Heading>Meine Nummer</Heading>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  block: {
    gap: 10,
  },
  small: {
    fontSize: 12,
  },
  label: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  again: {
    backgroundColor: "rgba(41, 182, 232, 0.1)",
    borderColor: "rgba(41, 182, 232, 0.4)",
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.white,
    padding: 10,
  },
  noneLeft: {
    color: colors.gold,
  },
  inputRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  chipSlot: {
    flexShrink: 1,
    minHeight: 28,
    justifyContent: "center",
  },
  chip: {
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 1,
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.white,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  numberInput: {
    fontSize: 22,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
    textAlign: "center",
    width: 88,
  },
  numberInputLarge: {
    fontSize: 30,
    width: 108,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  grid: {
    gap: 6,
  },
  cells: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  cell: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 44,
  },
  cellChosen: {
    backgroundColor: "rgba(255, 215, 0, 0.15)",
    borderColor: colors.gold,
  },
  cellOff: {
    borderColor: "rgba(255,255,255,0.05)",
  },
  cellPressed: {
    transform: [{ scale: 0.96 }],
  },
  cellText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
  },
  cellTextChosen: {
    color: colors.gold,
  },
  cellTextOff: {
    color: "rgba(255,255,255,0.2)",
    textDecorationLine: "line-through",
  },
  numberRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  numberWrap: {
    paddingHorizontal: 4,
  },
  number: {
    color: colors.gold,
    fontSize: 64,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
    lineHeight: 70,
  },
  setBy: {
    flexShrink: 1,
    fontSize: 12,
    paddingBottom: 8,
  },
  notice: {
    color: colors.white,
    fontWeight: "800",
  },
  sync: {
    borderLeftColor: "rgba(255,255,255,0.15)",
    borderLeftWidth: 2,
    fontSize: 12,
    paddingLeft: 10,
  },
  openRequest: {
    borderLeftColor: "rgba(255, 215, 0, 0.5)",
    borderLeftWidth: 2,
    paddingLeft: 10,
  },
  askRow: {
    gap: 6,
  },
  requestBox: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 12,
  },
  requests: {
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 10,
  },
  request: {
    borderLeftColor: "rgba(255,255,255,0.15)",
    borderLeftWidth: 2,
    gap: 2,
    paddingLeft: 10,
  },
  error: {
    color: "#FF8A80",
  },
});
