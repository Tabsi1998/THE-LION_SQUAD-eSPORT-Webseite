import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { InvoiceList } from "../../components/InvoiceList";
import { EmptyState, OfflineNotice, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { emptyText, filterInvoices, payHint, sourceFilters, STATE_FILTERS, type SourceFilter, type StateFilter } from "../../lib/invoices";
import { formatMoney } from "../../lib/memberArea";
import { openInvoice, type Invoice, type InvoiceList as InvoiceListData } from "../../lib/memberDocuments";
import type { MoreStackParamList } from "../../navigation/types";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { colors } from "../../theme";

// Meine Rechnungen (#320): für jedes Konto, nicht nur Mitglieder - Event- und Turnierrechnungen
// stehen hier auch für Nicht-Mitglieder. Filter nach Quelle und Stand; Tippen öffnet das PDF.
// Bezahlt wird nicht in der App (Zahlungslinks bleiben im Browser, Überweisung laut Rechnung).

type Props = NativeStackScreenProps<MoreStackParamList, "MyInvoices">;

export function MyInvoicesScreen(_props: Props) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<InvoiceListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [state, setState] = useState<StateFilter>("all");

  const load = useCallback(async () => {
    try {
      const response = await api.get<InvoiceListData>("/account/invoices");
      setData(response.data);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Rechnungen konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(load, ["account/invoices", "membership"]);

  const open = async (invoice: Invoice) => {
    if (!accessToken) return;
    setOpenError("");
    setBusyKey(invoice.key);
    try {
      await openInvoice(invoice, accessToken);
    } catch (err) {
      setOpenError(errorMessage(err, "Der Beleg konnte nicht geöffnet werden."));
    } finally {
      setBusyKey(null);
    }
  };

  const sources = sourceFilters(data);
  const rows = filterInvoices(data?.invoices, source, state);
  const hint = payHint(data?.invoices || []);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.gold} />}
      >
        {loading ? (
          <SkeletonList count={3} hasImage={false} />
        ) : (
          <>
            {error ? <Muted style={styles.error}>{error}</Muted> : null}
            {data?.available === false ? (
              <OfflineNotice detail={`Die Mitgliederverwaltung antwortet gerade nicht${data.as_of ? ` – Stand ${formatDateTime(data.as_of)}` : ""}.`} />
            ) : null}
            {data?.summary?.open_count ? (
              <Muted style={styles.openSummary} testID="invoices-open">
                {data.summary.open_count} offen · {formatMoney(data.summary.open_total, data.currency)}
                {data.summary.overdue_count ? ` · ${data.summary.overdue_count} überfällig` : ""}
              </Muted>
            ) : null}
            {sources.length ? <SegmentedTabs items={sources} value={source} onChange={setSource} style={styles.tabs} /> : null}
            {data?.invoices?.length ? <SegmentedTabs items={STATE_FILTERS} value={state} onChange={setState} style={styles.tabs} /> : null}
            {openError ? <Muted style={styles.error}>{openError}</Muted> : null}
            <View style={styles.list}>
              {rows.length ? (
                <InvoiceList invoices={rows} currency={data?.currency} busyKey={busyKey} onOpen={open} />
              ) : (
                <EmptyState title={data?.invoices?.length ? "Nichts in dieser Auswahl" : "Keine Rechnungen"} detail={emptyText(data)} />
              )}
            </View>
            {hint ? <Muted testID="invoices-pay-hint">{hint}</Muted> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 40,
  },
  openSummary: {
    color: colors.white,
    fontWeight: "900",
  },
  tabs: {
    paddingHorizontal: 0,
  },
  list: {
    gap: 10,
  },
  error: {
    color: colors.live,
  },
});
