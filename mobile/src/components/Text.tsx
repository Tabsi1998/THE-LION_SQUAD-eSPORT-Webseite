import React from "react";
import { StyleSheet, Text as RNText, type TextProps } from "react-native";
import { colors } from "../theme";

export function Title(props: TextProps) {
  return <RNText {...props} style={[styles.title, props.style]} />;
}

export function Heading(props: TextProps) {
  return <RNText {...props} style={[styles.heading, props.style]} />;
}

export function Body(props: TextProps) {
  return <RNText {...props} style={[styles.body, props.style]} />;
}

export function Muted(props: TextProps) {
  return <RNText {...props} style={[styles.muted, props.style]} />;
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
