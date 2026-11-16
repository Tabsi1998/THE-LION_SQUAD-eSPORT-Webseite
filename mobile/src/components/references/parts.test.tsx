import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { auditTree, MIN_TARGET, type A11yNode } from "../../a11y/audit";
import { FilterChip } from "./parts";

// Filter-Chip der Referenzen (Feinschliff aus #2449): auch ein kurzer Name wie „R1“ hat eine Tippfläche von 48 Punkten -
// in der Höhe mit hitSlop, in der Breite über die Mindestbreite.

test("Tippfläche mindestens 48 hoch und breit, gewählt wird angesagt", async () => {
  const onPress = jest.fn();
  await render(<FilterChip label="R1" selected={false} onPress={onPress} testID="chip" />);
  const chip = screen.getByTestId("chip");
  const style = StyleSheet.flatten(chip.props.style) as { minHeight?: number; minWidth?: number };
  const slop = chip.props.hitSlop as { top?: number; bottom?: number };
  expect((style.minHeight || 0) + (slop.top || 0) + (slop.bottom || 0)).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(style.minWidth).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(auditTree(screen.toJSON() as A11yNode)).toEqual([]);
  expect(chip.props.accessibilityState).toEqual({ selected: false });
  await fireEvent.press(chip);
  expect(onPress).toHaveBeenCalledTimes(1);
});
