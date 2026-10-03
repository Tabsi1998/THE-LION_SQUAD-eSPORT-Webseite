import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { Button } from "./Button";
import { Card } from "./Card";
import { Body, Heading, Muted } from "./Text";
import { api, errorMessage } from "../lib/api";
import { colors } from "../theme";

// Konten in der Mitgliederakte (#846) - wie im Web: ein auf der Website geprüftes Konto geht nur auf Wunsch in die Akte,
// je Konto ein Schalter; wünscht der Verein ein Konto, das fehlt, führt ein Knopf zum Verknüpfen im Profil.

export type MemberFileAccount = {
  network: string;
  platform: string;
  label: string;
  asked: string;
  asked_label: string;
  in_file: { handle: string; confirmed: boolean; client: string; confirmed_at: string };
  website: { linked: boolean; handle: string };
  shared: boolean;
  can_share: boolean;
};

export type MemberFileAccountsView = {
  available: boolean;
  reason?: string;
  text?: string;
  accounts?: MemberFileAccount[];
  wishes?: Array<{ network: string; platform: string; label: string; asked: string }>;
};

export function accountLine(row: MemberFileAccount): string {
  const inFile = row.in_file || { handle: "", confirmed: false };
  if (row.shared && inFile.confirmed) return `In der Akte: ${inFile.handle} – bestätigt durch die Website`;
  if (inFile.handle) return `In der Akte: ${inFile.handle}${inFile.confirmed ? " – bestätigt" : " – vom Vorstand eingetragen"}`;
  if (row.website?.linked) return `Auf der Website verknüpft: ${row.website.handle} – noch nicht in der Akte`;
  return "Auf der Website nicht verknüpft";
}

export function MemberFileAccounts({ onLink }: { onLink: (platform: string) => void }) {
  const [view, setView] = useState<MemberFileAccountsView | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<MemberFileAccountsView>("/membership/me/accounts");
      setView(data);
    } catch {
      setView(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!view) return null;
  // Ohne Verbindung zur Akte erklärt die Karte „Vereinsakte“ den Weg; hier steht nur, was Fähigkeit oder Recht betrifft.
  if (!view.available && !["no_capability", "right_missing"].includes(view.reason || "")) return null;

  const toggle = async (row: MemberFileAccount, on: boolean) => {
    setBusy(row.network);
    setError("");
    try {
      const { data } = await api.put<MemberFileAccountsView>(`/membership/me/accounts/${row.network}`, { share: on });
      setView(data);
    } catch (problem) {
      setError(errorMessage(problem, "Nicht gespeichert."));
    } finally {
      setBusy("");
    }
  };

  return (
    <Card style={styles.card} testID="membership-accounts">
      <Heading>Meine Konten in der Mitgliederakte</Heading>
      {!view.available ? (
        <Muted testID="membership-accounts-reason">{view.text}</Muted>
      ) : (
        <>
          <Muted>
            Ein Konto, das du auf der Website verknüpft hast, kommt auf deinen Wunsch in deine Mitgliederakte – dort steht es als „bestätigt durch die
            Website“. Ausschalten oder Trennen nimmt es wieder heraus. Übertragen werden nur Name und Kennung, nie Kennwörter.
          </Muted>
          {(view.wishes || []).map((wish) => (
            <View key={wish.network} style={styles.wish} testID={`membership-accounts-wish-${wish.network}`}>
              <Body>Der Verein wünscht: {wish.label} verknüpfen.</Body>
              <Button label="Jetzt verknüpfen" variant="secondary" onPress={() => onLink(wish.platform)} testID={`membership-accounts-link-${wish.network}`} />
            </View>
          ))}
          {(view.accounts || []).map((row) => (
            <View key={row.network} style={styles.row} testID={`membership-accounts-${row.network}`}>
              <View style={styles.text}>
                <Body style={styles.label}>{row.label}</Body>
                <Muted>{accountLine(row)}</Muted>
                {row.asked_label ? <Muted style={styles.asked}>{row.asked_label} dieses Konto.</Muted> : null}
              </View>
              <Switch
                value={!!row.shared}
                disabled={!row.can_share || busy === row.network}
                onValueChange={(on) => toggle(row, on)}
                accessibilityLabel={`${row.label} in die Mitgliederakte`}
                testID={`membership-accounts-${row.network}-switch`}
              />
            </View>
          ))}
          {!(view.accounts || []).length ? <Muted testID="membership-accounts-empty">Noch kein Konto verknüpft – das geht im Profil unter „Bearbeiten“.</Muted> : null}
          {error ? <Muted style={styles.error} testID="membership-accounts-error">{error}</Muted> : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
  },
  wish: {
    backgroundColor: "rgba(255, 215, 0, 0.06)",
    borderColor: "rgba(255, 215, 0, 0.4)",
    borderRadius: 6,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  row: {
    alignItems: "center",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontWeight: "800",
  },
  asked: {
    color: colors.gold,
  },
  error: {
    color: "#FF8A80",
  },
});
