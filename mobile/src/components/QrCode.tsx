import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { qrRows } from "../lib/qr";

// Ein QR-Code aus Views - ohne SVG-Bibliothek und ohne Bild vom Server (#346). Weißer Grund mit
// „stiller Zone“, damit jede Kamera ihn liest, auch auf dem dunklen App-Hintergrund.

export function QrCode({ value, size = 220, testID }: { value: string; size?: number; testID?: string }) {
  const matrix = useMemo(() => qrRows(value), [value]);
  const quiet = 4;
  const cell = size / (matrix.size + quiet * 2);
  const offset = quiet * cell;
  return (
    <View style={[styles.box, { width: size, height: size }]} testID={testID} accessibilityLabel="QR-Code der Mitgliedskarte" accessibilityRole="image">
      {matrix.rows.map((runs, row) =>
        runs.map(([start, length]) => (
          <View
            key={`${row}-${start}`}
            style={[styles.dark, { left: offset + start * cell, top: offset + row * cell, width: length * cell + 0.5, height: cell + 0.5 }]}
          />
        )),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  dark: {
    backgroundColor: "#000000",
    position: "absolute",
  },
});
