import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";

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
            <Pressable accessibilityRole="button" onPress={() => this.setState({ error: undefined })} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <Text style={styles.buttonText}>Ansicht neu laden</Text>
            </Pressable>
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
    borderRadius: 8,
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
  button: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 7,
    minHeight: 46,
    justifyContent: "center",
    marginTop: 4,
  },
  buttonText: {
    color: colors.black,
    fontSize: 15,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
