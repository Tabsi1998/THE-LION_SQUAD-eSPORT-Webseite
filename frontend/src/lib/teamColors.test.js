import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTO_COLOR, TEAM_COLORS, bandBackground, teamColorHex } from "@/lib/teamColors";

// Team-Farbe (#1347): Server, Website und App kennen dieselben acht Farben - sonst zeigte die App ein anderes Band
// als die Website, oder der Server lehnte eine Farbe ab, die das Formular anbietet.

const repo = path.resolve(__dirname, "../../..");
const pairs = (text, pattern) => [...text.matchAll(pattern)].map((m) => [m[1], m[2].toUpperCase()]);

test("Server, Website und App haben dieselben acht Farben in derselben Reihenfolge", () => {
  const web = TEAM_COLORS.map((color) => [color.key, color.hex.toUpperCase()]);
  expect(web).toHaveLength(8);
  const backend = readFileSync(path.join(repo, "backend/services/team_colors.py"), "utf8");
  const mobile = readFileSync(path.join(repo, "mobile/src/lib/teamColors.ts"), "utf8");
  expect(pairs(backend, /"([a-z]+)": "(#[0-9A-Fa-f]{6})"/g)).toEqual(web);
  expect(pairs(mobile, /key: "([a-z]+)", label: "[^"]+", hex: "(#[0-9A-Fa-f]{6})"/g)).toEqual(web);
});

test("ohne gültige Farbe das Vereins-Cyan; das Band ist ein dunkler Verlauf in der Farbe", () => {
  expect(AUTO_COLOR).toBe("auto");
  expect(teamColorHex("violet")).toBe("#6A47B8");
  expect(teamColorHex("auto")).toBe("#1C8DB8");
  expect(teamColorHex(undefined)).toBe("#1C8DB8");
  expect(bandBackground("#3159C9")).toMatch(/^linear-gradient\(160deg, #3159C9E6 0%, #3159C98C 38%, #0A0A0A 100%\)$/);
});
