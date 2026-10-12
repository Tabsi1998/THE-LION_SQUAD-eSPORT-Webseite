import React from "react";
import { Pressable, Text, View } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { auditTree, findingLines, textOf, type A11yNode } from "./audit";

async function linesFor(element: React.ReactElement): Promise<string[]> {
  await render(element);
  return findingLines(auditTree(screen.root as unknown as A11yNode));
}

describe("Prüf-Hilfe Barrierefreiheit (#1155)", () => {
  test("ein Symbol-Knopf ohne Namen und mit kleiner Fläche fällt auf", async () => {
    const lines = await linesFor(
      <Pressable onPress={() => undefined} style={{ width: 32, height: 32 }} testID="glocke">
        <Text>{""}</Text>
      </Pressable>,
    );
    expect(lines).toEqual(["name: glocke", "target: glocke"]);
  });

  test("mit Namen und genug Fläche (auch über hitSlop) ist alles gut", async () => {
    const lines = await linesFor(
      <View>
        <Pressable onPress={() => undefined} accessibilityRole="button" accessibilityLabel="Benachrichtigungen" style={{ width: 40, height: 40 }} hitSlop={4} />
        <Pressable onPress={() => undefined} style={{ minHeight: 48 }}>
          <Text>Weiter</Text>
        </Pressable>
      </View>,
    );
    expect(lines).toEqual([]);
  });

  test("ein Reiter muss sagen, ob er gewählt ist", async () => {
    const lines = await linesFor(
      <View>
        <Pressable accessibilityRole="tab" onPress={() => undefined}>
          <Text>Alle</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: true }} onPress={() => undefined}>
          <Text>Ungelesen</Text>
        </Pressable>
      </View>,
    );
    expect(lines).toEqual(["tab-state: Alle"]);
  });

  test("Schrift, die nicht mitwächst oder auf eine Zeile gekürzt wird, fällt auf", async () => {
    const lines = await linesFor(
      <View>
        <Text allowFontScaling={false}>Fest</Text>
        <Text maxFontSizeMultiplier={1.2}>Gedeckelt</Text>
        <Text maxFontSizeMultiplier={1.2} adjustsFontSizeToFit>Passt sich an</Text>
        <Text numberOfLines={1}>Gekürzt</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Wird kleiner</Text>
        <Text numberOfLines={2}>Darf umbrechen</Text>
      </View>,
    );
    expect(lines).toEqual(["clip: Gekürzt", "scaling: Fest", "scaling: Gedeckelt"]);
  });

  test("lesbarer Text zählt, Symbole nicht", () => {
    const node: A11yNode = { type: "View", props: {}, children: [{ type: "Text", props: {}, children: [""] }, { type: "Text", props: {}, children: ["Teilen"] }] };
    expect(textOf(node)).toBe("Teilen");
  });
});
