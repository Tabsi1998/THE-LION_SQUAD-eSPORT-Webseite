import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { MoreStackParamList } from "../../navigation/types";
import { useNotifications } from "../../notifications/NotificationContext";
import { getPushDiagnostics, type PushDiagnostics } from "../../notifications/PushService";
import { colors } from "../../theme";

type Props = NativeStackScreenProps<MoreStackParamList, "Notifications">;
type NotificationFilter = "all" | "unread";

export function NotificationsScreen({ navigation }: Props) {
  const { items, load, markAllRead, openNotification } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [pushDiagnostics, setPushDiagnostics] = useState<PushDiagnostics | null>(null);
  const [pushStatus, setPushStatus] = useState<any | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await load();
    } finally {
      setLoading(false);
    }
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const refreshPushStatus = useCallback(async (register = false) => {
    const diagnostics = await getPushDiagnostics(register);
    setPushDiagnostics(diagnostics);
    const [{ data: status }] = await Promise.all([
      api.get("/mobile/push-status").catch(() => ({ data: null })),
      api.post("/mobile/push-receipts/check").catch(() => null),
    ]);
    setPushStatus(status);
    return { diagnostics, status };
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", refresh);
    refresh();
    refreshPushStatus(false);
    return unsubscribe;
  }, [navigation, refresh, refreshPushStatus]);

  const sendTestNotification = useCallback(async () => {
    if (testing) return;
    setTesting(true);
    setTestMessage("");
    try {
      const before = await refreshPushStatus(true);
      const { data } = await api.post("/mobile/notifications/test");
      const notification = data?.notification || {};
      await new Promise((resolve) => setTimeout(resolve, 1400));
      await refreshPushStatus(false);
      const pushCount = Number(notification.push_sent_count || 0);
      const registered = before.diagnostics.registerOk || before.status?.has_enabled_token;
      setTestMessage(
        registered && pushCount > 0
          ? "Test gesendet. Wenn Android Benachrichtigungen erlaubt, sollte jetzt eine Handy-Benachrichtigung erscheinen."
          : "Test erzeugt nur In-App. Push-Token oder Firebase/FCM-Konfiguration ist noch nicht sauber aktiv.",
      );
      await load();
    } catch (err) {
      setTestMessage(errorMessage(err, "Test-Benachrichtigung konnte nicht gesendet werden."));
    } finally {
      setTesting(false);
    }
  }, [load, testing]);

  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const visibleItems = useMemo(
    () => (filter === "unread" ? items.filter((item) => !item.read) : items),
    [filter, items]
  );
  const latestLabel = items[0]?.created_at ? formatDateTime(items[0].created_at) : "Keine Einträge";

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl tintColor={colors.cyan} refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Muted>LionsAPP</Muted>
          <Title>Benachrichtigungen</Title>
          <Muted>{unread ? `${unread} ungelesen` : "Alles gelesen"} · {items.length} gesamt</Muted>
        </View>

        <View style={styles.stats}>
          <StatCard icon="notifications" label="Ungelesen" value={String(unread)} accent={colors.cyan} />
          <StatCard icon="time" label="Letzte Meldung" value={latestLabel} accent={colors.gold} compact />
        </View>

        <View style={styles.filterRow}>
          <FilterButton active={filter === "all"} label="Alle" onPress={() => setFilter("all")} />
          <FilterButton active={filter === "unread"} label="Ungelesen" onPress={() => setFilter("unread")} />
        </View>

        {items.length ? <Button label="Alle als gelesen markieren" onPress={markAllRead} variant="secondary" /> : null}
        <PushStatusCard diagnostics={pushDiagnostics} backend={pushStatus} onRefresh={() => refreshPushStatus(true)} />
        <Button label={testing ? "Test wird gesendet ..." : "Test-Benachrichtigung senden"} onPress={sendTestNotification} disabled={testing} variant="secondary" />
        {testMessage ? <Muted style={styles.testMessage}>{testMessage}</Muted> : null}
        {loading ? <SkeletonList count={4} hasImage={false} /> : null}
        {!loading && !items.length ? (
          <EmptyState
            icon="notifications-outline"
            title="Keine Benachrichtigungen"
            detail="Erinnerungen, Mentions, Nachrichten und Match-Updates erscheinen hier."
          />
        ) : null}
        {!loading && items.length > 0 && !visibleItems.length ? (
          <EmptyState icon="checkmark-done-outline" title="Alles gelesen" detail="Neue ungelesene Meldungen landen automatisch wieder hier." />
        ) : null}
        {visibleItems.map((item) => (
          <Pressable key={item.id} onPress={() => openNotification(item)} style={({ pressed }) => [pressed && styles.pressed]}>
            <Card style={[styles.note, !item.read && styles.unread]}>
              <View style={styles.noteHead}>
                <Heading style={styles.noteTitle}>{item.title}</Heading>
                {!item.read ? <View style={styles.dot} /> : null}
              </View>
              {item.body ? <Body>{item.body}</Body> : null}
              <View style={styles.meta}>
                {item.kind ? <Muted style={styles.kind}>{item.kind}</Muted> : null}
                {item.created_at ? <Muted>{formatDateTime(item.created_at)}</Muted> : null}
                <Muted style={styles.openHint}>Öffnen</Muted>
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

function PushStatusCard({ diagnostics, backend, onRefresh }: { diagnostics: PushDiagnostics | null; backend: any | null; onRefresh: () => void }) {
  const activeToken = Boolean(backend?.has_enabled_token);
  const latest = Array.isArray(backend?.tokens) ? backend.tokens[0] : null;
  const receiptError = latest?.last_receipt_error || latest?.last_ticket_error;
  return (
    <Card style={styles.pushCard}>
      <View style={styles.noteHead}>
        <View style={styles.linkIcon}>
          <Ionicons name={activeToken ? "checkmark-circle-outline" : "warning-outline"} color={activeToken ? colors.success : colors.gold} size={18} />
        </View>
        <View style={styles.flex}>
          <Heading style={styles.noteTitle}>Handy-Push</Heading>
          <Muted>{activeToken ? "Token beim Backend registriert" : "Kein aktiver Push-Token registriert"}</Muted>
        </View>
      </View>
      <View style={styles.diagnosticGrid}>
        <Diagnostic label="Native" value={diagnostics?.nativeAvailable ? "OK" : "Fehlt"} />
        <Diagnostic label="Gerät" value={diagnostics?.isDevice ? "Echt" : "Simulator"} />
        <Diagnostic label="Rechte" value={diagnostics?.permissionStatus || "unbekannt"} />
        <Diagnostic label="Channels" value={String(diagnostics?.channelCount ?? "-")} />
      </View>
      {diagnostics?.tokenPreview || latest?.token_preview ? <Muted>Token: {diagnostics?.tokenPreview || latest?.token_preview}</Muted> : null}
      {receiptError ? <Muted style={styles.errorText}>Expo/FCM: {receiptError}</Muted> : null}
      {diagnostics?.error ? <Muted style={styles.errorText}>{diagnostics.error}</Muted> : null}
      <Button label="Push neu prüfen / registrieren" onPress={onRefresh} variant="secondary" />
    </Card>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.diagnostic}>
      <Muted>{label}</Muted>
      <Body style={styles.strong}>{value}</Body>
    </View>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  compact = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: string;
  compact?: boolean;
}) {
  return (
    <Card style={styles.statCard}>
      <View style={[styles.statIcon, { borderColor: accent }]}>
        <Ionicons name={icon} color={accent} size={18} />
      </View>
      <Muted>{label}</Muted>
      <Heading numberOfLines={compact ? 2 : 1} style={[styles.statValue, compact && styles.statValueCompact]}>
        {value}
      </Heading>
    </Card>
  );
}

function FilterButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.filterButton, active && styles.filterButtonActive, pressed && styles.pressed]}
    >
      <Body style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    padding: 18,
    paddingBottom: 30,
  },
  header: {
    gap: 4,
  },
  stats: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    gap: 6,
    minHeight: 116,
  },
  statIcon: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  statValue: {
    fontSize: 20,
  },
  statValueCompact: {
    fontSize: 15,
    lineHeight: 20,
  },
  filterRow: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    padding: 4,
  },
  filterButton: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    justifyContent: "center",
    minHeight: 38,
  },
  filterButtonActive: {
    backgroundColor: colors.cyan,
  },
  filterLabel: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "900",
  },
  filterLabelActive: {
    color: colors.black,
  },
  note: {
    gap: 8,
  },
  unread: {
    borderColor: "rgba(41,182,232,0.5)",
  },
  noteHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  noteTitle: {
    flex: 1,
    fontSize: 17,
  },
  dot: {
    backgroundColor: colors.cyan,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  kind: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  openHint: {
    color: colors.gold,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  testMessage: {
    color: colors.cyan,
  },
  pushCard: {
    gap: 10,
  },
  diagnosticGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  diagnostic: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: "47%",
    padding: 10,
  },
  linkIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  strong: {
    fontWeight: "900",
  },
  errorText: {
    color: colors.live,
  },
  pressed: {
    opacity: 0.72,
  },
});
