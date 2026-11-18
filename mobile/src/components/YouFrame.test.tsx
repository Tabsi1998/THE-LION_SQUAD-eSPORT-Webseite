import fs from "fs";
import path from "path";
import React from "react";
import { StyleSheet, Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { YOU_CORNER, YOU_FILL, YOU_TAG_BACKGROUND, YouFrame, YouTag } from "./YouFrame";
import { saysYou, youLabel, youSpeech } from "../lib/youLabel";
import { colors, roles, surfaces } from "../theme";

// Ecken-Klammern für „das bist du“ (#1316, App-Teil von Web #2517): Maße wie `.tls-you` im Web, ruhig, nur für „du“, das
// Etikett mit AA-Kontrast. Die Wächter halten fest, wo der Baustein stehen darf und wo nie (Level-Rahmen, Saison-Bühne);
// eine neue Stelle für „du“ wird hier eingetragen. TV gibt es in der App nicht, Tastatur-Fokus auch nicht.

const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

// Einsatzorte für „du“: Ranglisten (Turnier- und Liga-Tabelle, Endrangliste, Fast Lap, Jahreswertung), Turnierbaum und
// Spielplan, Teilnehmerliste, Kalender, Event-Zeilen und die Gesichter der Team-Seite.
const PLACES = [
  "components/MonthCalendar.tsx",
  "components/team/TeamHeader.tsx",
  "components/tournament/ScheduleList.tsx",
  "components/tournament/StandingsTables.tsx",
  "components/tournament/bracket/BracketCanvas.tsx",
  "components/tournament/bracket/BracketCard.tsx",
  "screens/main/EventDetailScreen.tsx",
  "screens/main/FastLapDetailScreen.tsx",
  "screens/main/SeasonPassScreen.tsx",
  "screens/main/TournamentDetailScreen.tsx",
];

test("der Baustein steht nur an den eingetragenen Stellen für „du“", () => {
  const found = sourceFiles(SRC)
    .filter((file) => /from "(\.\.?\/)+(components\/)?YouFrame"/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .filter((rel) => rel !== "components/YouFrame.tsx")
    .sort();
  expect(found).toEqual(PLACES);
}, 30_000);

test("Level-Rahmen und Saison-Bühne tragen keine Ecken-Klammern", () => {
  const forbidden = [...sourceFiles(path.join(SRC, "seasons")), path.join(SRC, "components/LoewenRangFrame.tsx")];
  for (const file of forbidden) {
    expect([path.basename(file), /YouFrame|YouCorners|YouFill/.test(fs.readFileSync(file, "utf8"))]).toEqual([path.basename(file), false]);
  }
});

test("ruhig: keine Bewegung, kein Schein - und dieselben Maße wie im Web", () => {
  const source = read("components/YouFrame.tsx");
  expect(source).not.toMatch(/Animated|animation|transition|shadow|elevation|withTiming|withSpring/);
  expect(YOU_CORNER).toEqual({ len: 11, width: 2, out: 5 });
  expect(YOU_FILL).toBe("rgba(41,182,232,0.08)");
  expect(roles.brand.toUpperCase()).toBe("#29B6E8");
  // Dieselben Werte stehen im Web (styles/system.css).
  const web = fs.readFileSync(path.resolve(SRC, "../../frontend/src/styles/system.css"), "utf8");
  expect(web).toMatch(/--tls-corner-len: 11px;/);
  expect(web).toMatch(/--tls-corner-width: 2px;/);
  expect(web).toMatch(/--tls-corner-out: 5px;/);
  expect(web).toMatch(/--tls-you-fill: inset 0 0 0 100vmax rgb\(var\(--tls-brand-rgb\) \/ 0\.08\);/);
});

test("aktiv: Fläche, vier Winkel 11 × 2 und 5 Punkte außen; inset an der Kante, plain ohne Fläche; sonst nichts", async () => {
  const view = await render(<YouFrame active testID="frame"><Text>Paula</Text></YouFrame>);
  expect(screen.getByTestId("you-fill")).toBeTruthy();
  const corners = screen.getByTestId("you-corners");
  expect(corners).toHaveStyle({ top: -5, left: -5, right: -5, bottom: -5 });
  expect(corners.props.pointerEvents).toBe("none");
  expect(corners.children).toHaveLength(4);
  const first = StyleSheet.flatten((corners.children[0] as unknown as { props: { style: unknown } }).props.style);
  expect(first).toMatchObject({ width: 11, height: 11, borderTopWidth: 2, borderLeftWidth: 2, borderColor: roles.brand });
  await view.unmount();

  await render(<YouFrame active inset plain><Text>Paula</Text></YouFrame>);
  expect(screen.getByTestId("you-corners")).toHaveStyle({ top: -0, left: -0 });
  expect(screen.queryByTestId("you-fill")).toBeNull();
});

test("nicht aktiv: dieselbe View ohne Zeichen", async () => {
  await render(<YouFrame active={false} testID="frame"><Text>Mira</Text></YouFrame>);
  expect(screen.getByTestId("frame")).toHaveTextContent("Mira");
  expect(screen.queryByTestId("you-corners")).toBeNull();
  expect(screen.queryByTestId("you-fill")).toBeNull();
});

test("Etikett „Du“ bzw. „Dein Team“ - Markenfarbe mit AA-Kontrast auf allen Flächen", async () => {
  await render(<YouTag testID="tag" />);
  expect(screen.getByTestId("tag")).toHaveTextContent(/^Du$/);
  expect(youLabel({ team_id: null })).toBe("Du");
  expect(youLabel(null)).toBe("Du");
  expect(youLabel({ team_id: "t1" })).toBe("Dein Team");
  expect(youLabel({ team: { id: "t1" } })).toBe("Dein Team");
  expect(youSpeech("Du")).toBe("du");
  expect(youSpeech("Dein Team")).toBe("Dein Team");
  expect(saysYou("Du bist dabei")).toBe(true);
  expect(saysYou("Warteliste")).toBe(false);
  expect(saysYou("Dubai Cup")).toBe(false);

  // Kontrast nach WCAG: Markenfarbe auf der Pille (12 % Markenfarbe) über jeder Fläche, auch mit der Fläche „du“ (8 %).
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rgba = (value: string) => { const [r, g, b, a] = value.replace(/[^\d.,]/g, "").split(",").map(Number); return { c: [r, g, b], a }; };
  const over = (top: { c: number[]; a: number }, base: number[]) => base.map((v, i) => top.c[i] * top.a + v * (1 - top.a));
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const surface of [colors.black, colors.surface, surfaces.s1, surfaces.s2]) {
    const plain = over(rgba(YOU_TAG_BACKGROUND), rgb(surface));
    const onFill = over(rgba(YOU_TAG_BACKGROUND), over(rgba(YOU_FILL), rgb(surface)));
    expect([surface, ratio(rgb(roles.brand), plain) >= 4.5, ratio(rgb(roles.brand), onFill) >= 4.5]).toEqual([surface, true, true]);
  }
});
