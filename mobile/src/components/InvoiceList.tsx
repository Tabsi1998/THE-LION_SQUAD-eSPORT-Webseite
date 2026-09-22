import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { formatDate } from "../lib/format";
import { sourceLine } from "../lib/invoices";
import { formatMoney } from "../lib/memberArea";
import type { Invoice } from "../lib/memberDocuments";
import { colors } from "../theme";
import { Body, Muted } from "./Text";

/**
 * Eine Zeile je Beleg (#320): Nummer, Vorgang, Betrag, Stand - Tippen öffnet das PDF.
 * Dieselbe Zeile in „Meine Mitgliedschaft“ und „Meine Rechnungen“, keine zwei Listen.
 */
export function InvoiceList({
  invoices,
  currency,
  busyKey,
  onOpen,
}: {
  invoices: Invoice[];
  currency?: string;
  busyKey: string | null;
  onOpen: (invoice: Invoice) => void;
}) {
  return (
    <>
      {invoices.map((invoice) => (
        <Pressable
          key={invoice.key}
          onPress={() => onOpen(invoice)}
          disabled={busyKey === invoice.key}
          accessibilityRole="button"
          accessibilityLabel={`${invoice.type_label} ${invoice.ref} öffnen`}
          testID={`invoice-${invoice.key}`}
          style={({ pressed }) => [styles.invoice, pressed && styles.pressed]}
        >
          <Ionicons name={busyKey === invoice.key ? "hourglass-outline" : "document-text-outline"} color={colors.gold} size={20} />
          <View style={styles.text}>
            <Body style={styles.title}>{invoice.type_label} {invoice.ref}</Body>
            <Muted>{[sourceLine(invoice), invoice.date ? formatDate(invoice.date) : ""].filter(Boolean).join(" · ")}</Muted>
          </View>
          <View style={styles.right}>
            <Body style={styles.amount}>{formatMoney(invoice.total, currency)}</Body>
            <InvoiceBadge invoice={invoice} />
          </View>
        </Pressable>
      ))}
    </>
  );
}

function InvoiceBadge({ invoice }: { invoice: Invoice }) {
  const color = invoice.status === "paid" ? colors.success : invoice.overdue ? colors.live : colors.cyan;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Muted style={[styles.badgeText, { color }]}>{invoice.status_label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  invoice: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  text: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  title: {
    fontWeight: "900",
  },
  right: {
    alignItems: "flex-end",
    gap: 4,
  },
  amount: {
    fontWeight: "900",
  },
  badge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
