import React from "react";
import { StyleSheet } from "react-native";
import { openSignIn } from "../navigation/rootNavigation";
import { Button } from "./Button";
import { Card } from "./Card";
import { Body } from "./Text";

// Gast zuerst (#918): Was ein Konto braucht, zeigt Gästen den Weg dorthin statt eines Fehlers vom Server.
export function SignInRequired({ text, style, testID = "sign-in-required" }: { text: string; style?: object; testID?: string }) {
  return (
    <Card style={[styles.card, style]} testID={testID}>
      <Body>{text}</Body>
      <Button label="Anmelden oder registrieren" onPress={() => openSignIn()} testID={`${testID}-button`} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
  },
});
