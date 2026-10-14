import React, { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { Card } from "./Card";
import { Body, Heading, Muted } from "./Text";
import { api, errorMessage } from "../lib/api";
import { CONSENTS_HIDDEN, consentStateLine, missingGivenText, type ConsentRow, type ConsentsView } from "../lib/consents";
import { formatDateTime } from "../lib/format";
import { colors, radius } from "../theme";

// Meine Einwilligungen (#1537) - wie im Web: je Zweck der Stand aus der Mitgliederverwaltung, der Text zum Aufklappen
// (auch nach dem Zustimmen; bei einer neuen Fassung beide), Zustimmen nur mit der gelesenen Fassung, Widerrufen jederzeit -
// beides nach einer Rückfrage. Ob ein Zweck Pflicht ist, sagt das Modul nicht; der Abschnitt sagt dazu nichts.
// Antwortet die Mitgliederverwaltung nicht, steht das da - mit „Nochmal versuchen“.

type Problem = { text: string };

export function MemberConsents() {
  const [view, setView] = useState<ConsentsView | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<ConsentsView>("/membership/me/consents");
      if (data?.available === true && Array.isArray(data.consents)) {
        setView(data);
        setProblem(null);
      } else if (CONSENTS_HIDDEN.includes(data?.reason || "")) {
        setView(null);
        setProblem(null);
      } else {
        setProblem({ text: data?.text || "" });
      }
    } catch (err) {
      setProblem({ text: errorMessage(err, "") });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!view && !problem) return null;

  const send = async (row: ConsentRow, decision: "given" | "withdrawn") => {
    setBusy(row.code);
    setError("");
    try {
      const body = decision === "given" ? { code: row.code, decision, version: row.current_version } : { code: row.code, decision };
      const { data } = await api.post<{ consents?: ConsentRow[] | null }>("/membership/me/consents", body);
      if (Array.isArray(data?.consents)) setView((current) => ({ ...(current || { available: true }), consents: data.consents || [] }));
      else await load();
      setOpen("");
    } catch (err) {
      setError(errorMessage(err, "Das hat nicht geklappt."));
    } finally {
      setBusy("");
    }
  };

  const askGive = (row: ConsentRow) => {
    if (busy) return;
    Alert.alert(
      `„${row.label}“ zustimmen?`,
      `Du stimmst der Fassung ${row.current_version} zu, die du gerade gelesen hast. Das gilt sofort in der Mitgliederverwaltung; widerrufen kannst du jederzeit.`,
      [{ text: "Abbrechen", style: "cancel" }, { text: "Zustimmen", onPress: () => { send(row, "given"); } }],
    );
  };

  const askWithdraw = (row: ConsentRow) => {
    if (busy) return;
    Alert.alert(
      `„${row.label}“ widerrufen?`,
      "Der Widerruf gilt sofort in der Mitgliederverwaltung. Du kannst später wieder zustimmen.",
      [{ text: "Abbrechen", style: "cancel" }, { text: "Widerrufen", style: "destructive", onPress: () => { send(row, "withdrawn"); } }],
    );
  };

  return (
    <Card style={styles.card} testID="membership-consents">
      <Heading>Meine Einwilligungen</Heading>
      <Muted>Jederzeit widerrufbar. Der Stand kommt aus der Mitgliederverwaltung; ein Widerruf gilt dort sofort.</Muted>
      {problem ? (
        <View style={styles.problem} testID="consents-error" accessibilityLiveRegion="polite">
          <Body>Deine Einwilligungen wurden nicht geladen.</Body>
          {problem.text ? <Muted>{problem.text}</Muted> : null}
          <Button label="Nochmal versuchen" icon="refresh" arrow={false} variant="secondary" compact onPress={() => { load(); }} testID="consents-retry" />
        </View>
      ) : null}
      {view?.as_of ? <Muted style={styles.asOf}>Stand {formatDateTime(view.as_of)}</Muted> : null}
      {(view?.consents || []).map((row) => (
        <View key={row.code} style={styles.row} testID={`consent-${row.code}`}>
          <Body style={styles.label}>{row.label}</Body>
          <Muted style={row.state === "given" ? styles.given : row.state === "withdrawn" ? styles.withdrawn : undefined} testID={`consent-state-${row.code}`}>
            {consentStateLine(row)}
          </Muted>
          {row.text_changed ? <Muted style={styles.withdrawn} testID={`consent-changed-${row.code}`}>Text geändert – bitte die neue Fassung lesen.</Muted> : null}
          {open === row.code ? <ConsentTexts row={row} /> : null}
          <View style={styles.actions}>
            {open === row.code ? (
              <>
                {row.can_give && row.text ? (
                  <Button label="Zustimmen" compact arrow={false} onPress={() => askGive(row)} disabled={busy !== ""} busy={busy === row.code} testID={`consent-give-${row.code}`} />
                ) : null}
                <Button label="Schließen" variant="quiet" compact onPress={() => setOpen("")} testID={`consent-close-${row.code}`} />
              </>
            ) : (
              <Button
                label={!row.can_give ? "Text lesen" : row.state === "given" ? "Neue Fassung lesen" : "Lesen und zustimmen"}
                variant="secondary"
                compact
                onPress={() => setOpen(row.code)}
                testID={`consent-open-${row.code}`}
              />
            )}
            {row.can_withdraw ? (
              <Button label="Widerrufen" variant="danger" compact onPress={() => askWithdraw(row)} disabled={busy !== ""} busy={busy === row.code} testID={`consent-withdraw-${row.code}`} />
            ) : null}
          </View>
        </View>
      ))}
      {view && !(view.consents || []).length ? <Muted testID="consents-empty">Der Verein hat derzeit keine Einwilligungstexte hinterlegt.</Muted> : null}
      {error ? <Muted style={styles.error} testID="consents-decide-error">{error}</Muted> : null}
    </Card>
  );
}

/** Der Text zum Aufklappen: erteilt ohne neue Fassung die eigene; mit neuer Fassung beide (die alte, soweit bekannt). */
function ConsentTexts({ row }: { row: ConsentRow }) {
  if (row.state === "given" && !row.text_changed) {
    return (
      <View style={styles.text} testID={`consent-given-text-${row.code}`}>
        <Muted style={styles.caption}>Deine Fassung {row.version}</Muted>
        <Body>{row.given_text || row.text || "Der Text ist gerade nicht abrufbar."}</Body>
      </View>
    );
  }
  return (
    <View style={styles.texts}>
      {row.state === "given" ? (
        row.given_text ? (
          <View style={styles.text} testID={`consent-given-text-${row.code}`}>
            <Muted style={styles.caption}>Zugestimmt hast du Fassung {row.version}</Muted>
            <Muted>{row.given_text}</Muted>
          </View>
        ) : (
          <Muted testID={`consent-given-missing-${row.code}`}>{missingGivenText(row)}</Muted>
        )
      ) : null}
      <View style={styles.text} testID={`consent-current-text-${row.code}`}>
        {row.state === "given" && row.given_text ? <Muted style={[styles.caption, styles.withdrawn]}>Neue Fassung {row.current_version}</Muted> : null}
        <Body>{row.text || "Der Text ist gerade nicht abrufbar – bitte später noch einmal öffnen."}</Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
  },
  asOf: {
    fontSize: 11,
  },
  problem: {
    borderColor: "rgba(255, 215, 0, 0.4)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  row: {
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  label: {
    fontWeight: "900",
  },
  given: {
    color: colors.success,
  },
  withdrawn: {
    color: colors.gold,
  },
  texts: {
    gap: 10,
  },
  text: {
    borderTopColor: "rgba(255, 255, 255, 0.1)",
    borderTopWidth: 1,
    gap: 4,
    paddingTop: 8,
  },
  caption: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  error: {
    color: colors.live,
  },
});
