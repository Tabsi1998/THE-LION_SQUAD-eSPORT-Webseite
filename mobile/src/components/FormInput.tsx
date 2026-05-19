import React from "react";
import { StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";
import { colors, radius } from "../theme";

export function FormInput({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.muted}
        style={[styles.input, props.style]}
        autoCapitalize={props.autoCapitalize || "none"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 7,
  },
  label: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.black,
    color: colors.white,
    paddingHorizontal: 14,
    fontSize: 16,
  },
});
