import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { logMobileError } from "../lib/mobileLog";
import { bugReportUrl } from "../lib/contactLinks";
import { openLink } from "../lib/openLink";
import { navigationRef } from "../navigation/rootNavigation";
import { colors, radius } from "../theme";
import { Button } from "./Button";

type State = {
  error?: Error;
};

/** Der Name des offenen Bildschirms (etwa „MatchDetail“) - leer, solange die Navigation nicht bereit ist. */
function currentScreen(): string {
  try {
    return navigationRef.isReady() ? String(navigationRef.getCurrentRoute()?.name || "") : "";
  } catch {
    return "";
  }
}

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("LionsAPP render crash", error, info.componentStack);
    logMobileError(error, "AppErrorBoundary", { componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={styles.safe}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>LionsAPP</Text>
            <Text style={styles.title}>App-Ansicht konnte nicht geladen werden</Text>
            <Text style={styles.body}>
              Die App ist weiter gestartet, aber diese Ansicht hat einen Fehler ausgelöst. Du kannst die Ansicht neu laden oder die App neu öffnen.
            </Text>
            <Button label="Ansicht neu laden" onPress={() => this.setState({ error: undefined })} />
            {/* Fehler melden (#2131 KO9): mit dem Namen des Bildschirms und der Version - ohne Kennungen aus der Adresse. */}
            <Button label="Fehler melden" variant="secondary" onPress={() => { void openLink(bugReportUrl(currentScreen(), Constants.expoConfig?.version)); }} testID="app-error-report" />
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  safe: {
    alignItems: "center",
    backgroundColor: colors.black,
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 12,
    padding: 18,
    width: "100%",
  },
  eyebrow: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: colors.white,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0,
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
