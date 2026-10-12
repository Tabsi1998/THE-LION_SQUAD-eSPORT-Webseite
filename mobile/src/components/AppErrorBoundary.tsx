import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logMobileError } from "../lib/mobileLog";
import { colors, radius } from "../theme";
import { Button } from "./Button";

type State = {
  error?: Error;
};

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
