import React from "react";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "./Button";
import { buttonColors, radius } from "../theme";

// Bausteine wie im Web (#1151): vier Knöpfe - wichtig (blau, mit Pfeil), zweitrangig (blauer Rahmen), leise (grauer
// Rahmen), gefährlich (roter Rahmen statt roter Fläche) - und ein Wächter wie im Web (lib/buttons.test.js): ein
// Pressable mit eigener Knopf-Farbe außerhalb von `Button` fällt auf.

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: ({ name, testID }: { name: string; testID?: string }) => <Text testID={testID}>{`icon:${name}`}</Text> };
});

function flat(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>;
}

test("vier Arten: nur „wichtig“ ist gefüllt und hat den Pfeil, „gefährlich“ ist ein roter Rahmen", async () => {
  const onPress = jest.fn();
  await render(
    <>
      <Button label="Team-Chat öffnen" onPress={onPress} testID="b-primary" />
      <Button label="Discord öffnen" variant="secondary" onPress={onPress} testID="b-secondary" />
      <Button label="Kader ansehen" variant="quiet" onPress={onPress} testID="b-quiet" />
      <Button label="Team verlassen" variant="danger" onPress={onPress} testID="b-danger" />
    </>,
  );
  expect(flat("b-primary").backgroundColor).toBe(buttonColors.primary.background);
  expect(screen.getByTestId("b-primary-arrow")).toBeTruthy();
  for (const variant of ["secondary", "quiet", "danger"] as const) {
    expect(flat(`b-${variant}`).backgroundColor).toBe("transparent");
    expect(flat(`b-${variant}`).borderColor).toBe(buttonColors[variant].border);
    expect(screen.queryByTestId(`b-${variant}-arrow`)).toBeNull();
  }
  expect(buttonColors.danger.border).toMatch(/^rgba\(255, 59, 48/);
  expect(flat("b-danger").borderRadius).toBe(radius.lg);
  expect(flat("b-primary").minHeight).toBe(48);
  await fireEvent.press(screen.getByTestId("b-danger"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("beschäftigt oder gesperrt: nicht drückbar, der Vorleser hört es; kompakt bleibt die Tippfläche groß", async () => {
  const onPress = jest.fn();
  await render(<Button label="Speichert ..." busy compact arrow={false} onPress={onPress} testID="b-busy" />);
  const node = screen.getByTestId("b-busy");
  expect(node.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(node.props.hitSlop).toBe(6);
  expect(screen.queryByTestId("b-busy-arrow")).toBeNull();
  await fireEvent.press(node);
  expect(onPress).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------- Wächter

const SRC = path.resolve(__dirname, "..");
const FILL = /backgroundColor:\s*(colors\.(cyan|live|gold|success|cyanHover)|"#(29B6E8|FF3B30|FFD700|00FF88|1E95C2)")/i;
const DANGER_FRAME = /borderColor:\s*(colors\.live|"rgba\(255, ?59, ?48)/;
// Umschalter mit Zustand, Karten, Zeilen und Kacheln sind keine Knöpfe im Sinn von #1151 - wie im Web.
const STATE_SUFFIX = /(Active|Selected|On|Mine|Chosen)$/;
const NOT_A_BUTTON = /^(chip|pill|toggle|option|tab|cell|filter|card|tile|row|band|popup|bubble|admission|surface|mention|meeting|pack|team|user|member|pinned|embed|link|share|showcase|action)/i;

// Bewusst keine der vier Arten - jede neue Ausnahme braucht hier eine Begründung.
const EXCEPTIONS: Record<string, number> = {
  "achievements/profile/AchievementPanels.tsx": 1, // Prestige: Gold heißt Ehre
  "components/ActionRow.tsx": 2, // Zeilen in Listen (Abmelden, Löschen) - eigener Baustein mit Symbol und Pfeil
  "components/ChatThreadView.tsx": 1, // Senden-Symbol im Eingabefeld
  "components/FriendsCard.tsx": 1, // Häkchen zum Annehmen (Symbol-Knopf)
  "screens/main/TeamsScreen.tsx": 1, // Chat-Symbol an der Team-Karte
};

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesIn(full);
    return name.endsWith(".tsx") && !name.includes(".test.") && name !== "Button.tsx" ? [full] : [];
  });
}

function styleEntries(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const marker = "StyleSheet.create({";
  let at = text.indexOf(marker);
  while (at >= 0) {
    let i = at + marker.length;
    const start = i;
    let depth = 1;
    while (depth && i < text.length) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
      i += 1;
    }
    for (const match of text.slice(start, i - 1).matchAll(/\n\s+([A-Za-z0-9_]+):\s*\{([^{}]*)\}/g)) entries[match[1]] = match[2];
    at = text.indexOf(marker, i);
  }
  return entries;
}

function openingTags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(/<(Pressable|TouchableOpacity)[\s>]/g)) {
    let j = (match.index || 0) + match[0].length - 1;
    const start = j;
    let depth = 0;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0 && text[j - 1] !== "=") break;
      j += 1;
    }
    tags.push(text.slice(start, j));
  }
  return tags;
}

function ownButtons(text: string): number {
  const entries = styleEntries(text);
  let count = 0;
  for (const attrs of openingTags(text)) {
    for (const [, name] of attrs.matchAll(/styles\.([A-Za-z0-9_]+)/g)) {
      const props = entries[name] || "";
      if (!(FILL.test(props) || DANGER_FRAME.test(props))) continue;
      if (STATE_SUFFIX.test(name) || NOT_A_BUTTON.test(name)) continue;
      count += 1;
    }
  }
  return count;
}

test("keine Knöpfe mit eigenem Stil außerhalb von Button (nur die eingetragenen Ausnahmen)", () => {
  const found: Record<string, number> = {};
  for (const file of filesIn(SRC)) {
    const count = ownButtons(readFileSync(file, "utf8"));
    if (count) found[path.relative(SRC, file).split(path.sep).join("/")] = count;
  }
  expect(found).toEqual(EXCEPTIONS);
});

test("der Wächter erkennt eine eigene rote Fläche und lässt Umschalter in Ruhe", () => {
  const sample = `
    <Pressable onPress={go} style={({ pressed }) => [styles.leave, pressed && styles.pressed]}><Text>Verlassen</Text></Pressable>
    <Pressable onPress={pick} style={[styles.chip, active && styles.chipActive]}><Text>Alle</Text></Pressable>
    const styles = StyleSheet.create({
      leave: { backgroundColor: colors.live, minHeight: 48 },
      chip: { borderWidth: 1 },
      chipActive: { backgroundColor: colors.cyan },
      pressed: { opacity: 0.8 },
    });`;
  expect(ownButtons(sample)).toBe(1);
});
