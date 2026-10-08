import React from "react";
import { StyleSheet, Text as RNText, type TextProps } from "react-native";
import { mergeRefs, useRoomProbe } from "../seasons/useRoom";
import { colors } from "../theme";

// Schrift der App. Solange eine Saison Deko an Karten hängt, meldet sich jede Zeile für die Platzprüfung (#1295) -
// Netze, Fledermäuse, Ketten und Wimpel liegen dann nie über Überschriften, Augenbrauen oder Text.

type Props = TextProps & { ref?: React.Ref<RNText> };

function ProbedText({ style, base, ...props }: Props & { base: object }) {
  const probe = useRoomProbe("text");
  return (
    <RNText
      {...props}
      ref={probe ? mergeRefs(props.ref, probe.ref) : props.ref}
      onTextLayout={probe ? (event) => {
        probe.onTextLayout?.(event);
        props.onTextLayout?.(event);
      } : props.onTextLayout}
      style={[base, style]}
    />
  );
}

export function Title(props: Props) {
  return <ProbedText {...props} base={styles.title} />;
}

export function Heading(props: Props) {
  return <ProbedText {...props} base={styles.heading} />;
}

export function Body(props: Props) {
  return <ProbedText {...props} base={styles.body} />;
}

export function Muted(props: Props) {
  return <ProbedText {...props} base={styles.muted} />;
}

const styles = StyleSheet.create({
  title: {
    color: colors.white,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 0,
  },
  heading: {
    color: colors.white,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0,
  },
  body: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0,
  },
});
