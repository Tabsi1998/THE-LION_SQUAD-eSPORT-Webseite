import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { api, errorMessage } from "../../lib/api";
import { idSegment } from "../../lib/apiIds";
import {
  NOTICE_DURATION_DEFAULT,
  NOTICE_DURATIONS,
  NOTICE_MAX,
  NOTICE_MIN,
  deliveryText,
  newRequestId,
  noticeClock,
  noticeLength,
  noticeTemplates,
  recipientsText,
  remainingText,
  type LeadNoticeItem,
} from "../../lib/tournamentNotices";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { colors, radius, roles, surfaces } from "../../theme";
import { Button } from "../Button";

// Reiter „Hinweis“ der Turnierleitung in der App (#1166, #2393) - wie im Web (components/tls/tournament/NoticeComposer.jsx):
// ein Satz an alle im Turnier oder im ganzen Event, als Benachrichtigung, als Banner oben auf der Seite und auf Wunsch am
// TV. Darunter, was schon hinausging: wer, wann, an wen, wie viele - mit „Entfernen“ und „Fortsetzen“. Doppeltipp und
// neuer Versuch tragen dieselbe Kennung (`request_id`) - der Server schickt nichts doppelt. Nur, wer Hinweise schreiben
// darf (`can_notice`). „Turnier gleich pausieren“ bleibt im Web.

type LeadList = { items?: LeadNoticeItem[]; can_target_event?: boolean; event_id?: string | null; error?: string };

export function NoticeComposer({ tournament, stationName = "", onMessage }: {
  tournament: { id: string; slug?: string; event_id?: string | null };
  stationName?: string;
  onMessage: (text: string) => void;
}) {
  const [list, setList] = useState<LeadList | null>(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"tournament" | "event">("tournament");
  const [tv, setTv] = useState(false);
  const [duration, setDuration] = useState(NOTICE_DURATION_DEFAULT);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Eine Kennung je Hinweis: bleibt bei einem Fehler stehen (neuer Versuch = derselbe Hinweis). Neu nach dem Senden, nach
  // einer 409 und sobald sich Text, Ziel, Dauer oder TV-Haken seit dem letzten Versuch geändert haben.
  const requestId = useRef({ id: newRequestId(), key: "" });
  const base = `/tournaments/${idSegment(tournament.slug || tournament.id)}/lead/notices`;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<LeadList>(base);
      setList(data || { items: [] });
    } catch (err) {
      setList((current) => current || { items: [], error: errorMessage(err, "Die Hinweise konnten nicht geladen werden.") });
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load, ["tournaments"], { fallbackMs: 15000 });
  // Solange ein Versand läuft, alle drei Sekunden der Fortschritt; sonst je halbe Minute die Restzeit.
  const sending = (list?.items || []).some((item) => item.state === "sending" && !item.stale);
  useEffect(() => {
    const timer = setInterval(() => (sending ? void load() : setNow(Date.now())), sending ? 3000 : 30000);
    return () => clearInterval(timer);
  }, [sending, load]);

  useEffect(() => {
    let alive = true;
    setCount(null);
    api.post<{ recipients?: number }>(`${base}/preview`, { target })
      .then(({ data }) => { if (alive) setCount(data?.recipients ?? null); })
      .catch(() => { if (alive) setCount(null); });
    return () => { alive = false; };
  }, [base, target]);

  const templates = useMemo(() => noticeTemplates({ now, station: stationName }), [now, stationName]);
  const length = noticeLength(text);
  const canEvent = Boolean(list?.can_target_event);
  const hasEvent = Boolean(tournament.event_id || list?.event_id);
  const tooShort = length < NOTICE_MIN;

  const pickTemplate = (template: { key: string; text: string }) => {
    setText(template.text);
    // „Pause bis …“ kommt oft mit dem Pause-Bildschirm am TV - vorgeschlagen, nicht erzwungen.
    if (template.key === "pause") setTv(true);
  };

  const submit = async () => {
    if (busy || tooShort || length > NOTICE_MAX) return;
    setBusy(true);
    const key = JSON.stringify([text, target, duration, tv]);
    if (requestId.current.key && requestId.current.key !== key) requestId.current = { id: newRequestId(), key: "" };
    requestId.current.key = key;
    try {
      const { data } = await api.post<{ recipients?: number; replay?: boolean }>(base, {
        request_id: requestId.current.id, text, target, show_on_tv: tv, duration_minutes: duration,
      });
      const people = data?.recipients === 1 ? "1 Person" : `${data?.recipients ?? 0} Personen`;
      onMessage(data?.replay ? "Dieser Hinweis ist schon unterwegs." : `Hinweis gesendet – geht an ${people}.`);
      requestId.current = { id: newRequestId(), key: "" };
      setText("");
      await load();
    } catch (err) {
      // 409: Der Server kennt die Kennung mit anderen Werten - der nächste Versuch ist ein neuer Hinweis.
      if ((err as { response?: { status?: number } })?.response?.status === 409) requestId.current = { id: newRequestId(), key: "" };
      onMessage(errorMessage(err, "Der Hinweis konnte nicht gesendet werden. Bitte noch einmal tippen – er geht nicht doppelt hinaus."));
    } finally {
      setBusy(false);
    }
  };

  const remove = (item: LeadNoticeItem) => {
    Alert.alert("Hinweis entfernen?", `„${item.text}“ verschwindet vom Banner${item.tv ? " und vom TV" : ""}. Die Benachrichtigungen bleiben, wo sie sind.`, [
      { text: "Zurück", style: "cancel" },
      { text: "Entfernen", style: "destructive", onPress: () => { void removeNow(item); } },
    ]);
  };
  const removeNow = async (item: LeadNoticeItem) => {
    setWorking(item.id);
    try {
      await api.delete(`${base}/${idSegment(item.id)}`);
      onMessage("Hinweis entfernt.");
      await load();
    } catch (err) {
      onMessage(errorMessage(err, "Entfernen hat nicht geklappt."));
    } finally {
      setWorking("");
    }
  };

  // „Fortsetzen“: ein unterbrochener Versand läuft mit Text, Ziel und Kennung des Hinweises weiter - niemand doppelt.
  const resume = async (item: LeadNoticeItem) => {
    setWorking(item.id);
    try {
      const { data } = await api.post<{ resumed?: boolean }>(`${base}/${idSegment(item.id)}/resume`);
      onMessage(data?.resumed ? "Versand läuft weiter – niemand bekommt den Hinweis doppelt." : "Der Versand läuft schon oder ist fertig.");
      await load();
    } catch (err) {
      onMessage(errorMessage(err, "Fortsetzen hat nicht geklappt."));
    } finally {
      setWorking("");
    }
  };

  const items = list?.items || [];
  return (
    <View style={styles.stack} testID="lead-notice-tab">
      <View style={styles.form} testID="notice-form">
        <Text style={styles.label}>VORLAGEN</Text>
        <View style={styles.wrap}>
          {templates.map((template) => (
            <Pressable key={template.key} onPress={() => pickTemplate(template)} accessibilityRole="button" style={({ pressed }) => [styles.template, pressed && styles.pressed]} testID={`notice-template-${template.key}`}>
              <Text style={styles.templateText} maxFontSizeMultiplier={1.4}>{template.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, styles.gap]} nativeID="notice-text-label">HINWEIS</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          maxLength={NOTICE_MAX}
          multiline
          placeholder="z. B. Pause bis 14:30"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Hinweis"
          accessibilityLabelledBy="notice-text-label"
          style={styles.input}
          testID="notice-text-input"
        />
        <Text style={[styles.counter, length > NOTICE_MAX - 20 && styles.counterNear]} testID="notice-count">{length}/{NOTICE_MAX}</Text>

        <Text style={[styles.label, styles.gap]}>AN WEN</Text>
        <View style={styles.segment} accessibilityRole="radiogroup">
          {([["tournament", "Dieses Turnier"], ["event", "Ganzes Event"]] as const).map(([key, label]) => {
            const disabled = key === "event" && (!hasEvent || !canEvent);
            const active = target === key;
            return (
              <Pressable key={key} disabled={disabled} onPress={() => setTarget(key)} accessibilityRole="radio" accessibilityState={{ checked: active, disabled }} style={[styles.segmentItem, active && styles.segmentActive, disabled && styles.disabled]} testID={`notice-target-${key}`}>
                <Text style={[styles.segmentText, active && styles.segmentTextActive]} maxFontSizeMultiplier={1.3}>{label.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint} testID="notice-recipients">
          {recipientsText(count)}
          {!hasEvent ? " Dieses Turnier gehört zu keinem Event." : !canEvent && list ? " An das ganze Event schreibt, wer alle Turniere des Events leitet." : ""}
        </Text>

        <Text style={[styles.label, styles.gap]}>STEHT FÜR</Text>
        <View style={styles.segment} accessibilityRole="radiogroup">
          {NOTICE_DURATIONS.map(([minutes, label]) => {
            const active = duration === minutes;
            return (
              <Pressable key={minutes} onPress={() => setDuration(minutes)} accessibilityRole="radio" accessibilityState={{ checked: active }} style={[styles.segmentItem, active && styles.segmentActive]} testID={`notice-duration-${minutes}`}>
                <Text style={[styles.segmentText, active && styles.segmentTextActive]} maxFontSizeMultiplier={1.3}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.switchRow}>
          <Ionicons name="tv-outline" size={17} color={roles.brand} />
          <Text style={styles.switchText}>Auch am TV zeigen</Text>
          <Switch value={tv} onValueChange={setTv} accessibilityLabel="Auch am TV zeigen" trackColor={{ true: roles.brand, false: "rgba(255,255,255,0.2)" }} testID="notice-tv" />
        </View>

        <Button label={busy ? "Wird gesendet …" : "Hinweis senden"} icon="send" onPress={() => { void submit(); }} disabled={busy || tooShort} busy={busy} testID="notice-send" />
      </View>

      <View style={styles.stack}>
        <Text style={styles.label}>GESENDET · WER, WANN, AN WEN</Text>
        {list?.error ? <Text style={styles.error}>{list.error}</Text> : null}
        {list && !items.length && !list.error ? <Text style={styles.empty} testID="notice-log-empty">Noch kein Hinweis gesendet.</Text> : null}
        {items.map((item) => (
          <View key={item.id} style={[styles.logItem, item.active && styles.logActive]} testID={`notice-log-${item.id}`}>
            <Text style={styles.logText}>{item.text}</Text>
            <Text style={styles.meta}>{noticeClock(item)} · {item.author || "Turnierleitung"} · {item.target_label}{item.tv ? " · am TV" : ""}</Text>
            <Text style={styles.metaStrong} testID={`notice-delivery-${item.id}`}>{deliveryText(item)}</Text>
            <Text style={[styles.metaState, item.active && styles.metaActive]}>
              {item.removed_at ? `entfernt${item.removed_by ? ` von ${item.removed_by}` : ""}` : item.active ? `steht · ${remainingText(item.expires_at, now)}` : "abgelaufen"}
            </Text>
            {item.active && item.can_remove ? (
              <View style={styles.logTools}>
                {item.stale || item.state === "interrupted" ? (
                  <Button label="Fortsetzen" icon="refresh" onPress={() => { void resume(item); }} disabled={working === item.id} style={styles.flex} testID={`notice-resume-${item.id}`} />
                ) : null}
                <Button label="Entfernen" icon="trash-outline" variant="quiet" onPress={() => remove(item)} disabled={working === item.id} style={styles.flex} testID={`notice-remove-${item.id}`} />
              </View>
            ) : null}
          </View>
        ))}
        <Text style={styles.hint}>Die Benachrichtigung kommt nach den Einstellungen jeder Person (Thema „Turnier-Updates“). Banner und TV zeigen nur Text und Zeit, nie, wer geschrieben hat.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  counter: { color: "rgba(255,255,255,0.4)", fontSize: 11, fontVariant: ["tabular-nums"], textAlign: "right" },
  counterNear: { color: roles.honor },
  disabled: { opacity: 0.4 },
  empty: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, color: "rgba(255,255,255,0.5)", padding: 18, textAlign: "center" },
  error: { color: roles.warn },
  flex: { flex: 1 },
  form: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, gap: 8, padding: 14 },
  gap: { marginTop: 8 },
  hint: { color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 17 },
  input: { backgroundColor: colors.black, borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.sm, borderWidth: 1, color: colors.white, fontSize: 16, minHeight: 72, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: "top" },
  label: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  logActive: { backgroundColor: "rgba(255,215,0,0.04)", borderColor: "rgba(255,215,0,0.4)" },
  logItem: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, gap: 3, padding: 12 },
  logText: { color: colors.white, fontSize: 14, fontWeight: "800" },
  logTools: { columnGap: 8, flexDirection: "row", marginTop: 8 },
  meta: { color: "rgba(255,255,255,0.5)", fontSize: 11 },
  metaActive: { color: roles.honor },
  metaState: { color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: "800" },
  metaStrong: { color: "rgba(255,255,255,0.6)", fontSize: 11 },
  pressed: { opacity: 0.8 },
  segment: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flexDirection: "row", gap: 4, padding: 4 },
  segmentActive: { backgroundColor: roles.brand },
  segmentItem: { alignItems: "center", borderRadius: radius.sm, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 4 },
  segmentText: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "800", textAlign: "center" },
  segmentTextActive: { color: "#04141B" },
  stack: { gap: 10 },
  switchRow: { alignItems: "center", columnGap: 10, flexDirection: "row", marginTop: 8, minHeight: 48 },
  switchText: { color: "rgba(255,255,255,0.85)", flex: 1, fontSize: 14 },
  template: { borderColor: "rgba(255,255,255,0.18)", borderRadius: radius.sm, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 12 },
  templateText: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: "800" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
