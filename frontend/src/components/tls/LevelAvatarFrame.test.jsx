import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import RING from "@/lib/loewenRangRing.json";
import { frameFit } from "@/lib/loewenRang";
import { CROWN_LABELS, LevelAvatarFrame, crownVariant, levelFrameConfig } from "./LevelAvatarFrame";

// Löwen-Rang (#1454): der Rahmen des Rangs als Grafik, am gemessenen Ring ausgerichtet, Schild mit Rauten.

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(() => Promise.resolve({ data: { crowns: {} } })) } }));

// jsdom zeichnet nicht: die Signatur im Profil bekommt einen leeren Kontext und keine Kantenpunkte.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })));
});
afterEach(() => vi.unstubAllGlobals());

function frame(props = {}, testId = "f") {
  render(<LevelAvatarFrame testId={testId} {...props}><span>Foto</span></LevelAvatarFrame>);
  return screen.getByTestId(testId);
}

test("Rang-Zuordnung: Level 9 zeigt Rahmen 2 (Fährte), Level 55 den Löwenkönig", () => {
  const nine = frame({ level: 9 });
  expect(nine.dataset.rank).toBe("2");
  expect(nine.dataset.rankName).toBe("Fährte");
  expect(nine.querySelector("img.tls-lvf-img").getAttribute("src")).toContain("/assets/loewen-rang/rang-02-320.webp");
  expect(levelFrameConfig(55)).toMatchObject({ rank: 12, name: "Löwenkönig" });
});

test("Ausrichtung: Größe und Versatz kommen aus der Ring-Geometrie", () => {
  const el = frame({ level: 32 });
  const ring = RING["07"];
  const scale = 1 / (2 * ring.r);
  expect(Number(el.style.getPropertyValue("--lvf-scale"))).toBeCloseTo(scale, 4);
  expect(Number(el.style.getPropertyValue("--lvf-ox"))).toBeCloseTo((0.5 - ring.cx) * scale, 4);
  expect(Number(el.style.getPropertyValue("--lvf-oy"))).toBeCloseTo((0.5 - ring.cy) * scale, 4);
  expect(el.querySelector(".tls-lvf-photo")).toHaveTextContent("Foto");
});

test("Bild lazy, mit srcset und passender Breite", () => {
  const img = frame({ level: 1, size: "card" }).querySelector("img.tls-lvf-img");
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("decoding")).toBe("async");
  expect(img.getAttribute("srcset").split(", ")).toHaveLength(3);
  const px = Math.round(150 * frameFit(RING["01"]).photo / (2 * RING["01"].r));
  expect(img.getAttribute("sizes")).toBe(`${px}px`);
  expect(img.getAttribute("width")).toBe(String(px));
  expect(img.getAttribute("alt")).toBe("");
});

test("Schild: Rauten für die Level im Rang - 5 leer, 9 vier gefüllt", () => {
  const five = frame({ level: 5 });
  const plate = five.querySelector("[data-testid='level-frame-badge']");
  expect(plate).toHaveTextContent("LVL 5");
  expect(plate.querySelectorAll(".tls-lvf-pip")).toHaveLength(4);
  expect(plate.querySelectorAll(".tls-lvf-pip.is-on")).toHaveLength(0);
});

test("Schild: Level 9 hat vier gefüllte Rauten", () => {
  const plate = frame({ level: 9 }).querySelector("[data-testid='level-frame-badge']");
  expect(plate.querySelectorAll(".tls-lvf-pip.is-on")).toHaveLength(4);
});

test("Schild: bei 60 MAX und Prestige-Sterne darüber", () => {
  const plate = frame({ level: 60, prestige: 3 }).querySelector("[data-testid='level-frame-badge']");
  expect(plate).toHaveTextContent("MAX");
  expect(plate.querySelector(".tls-lvf-stars")).toHaveTextContent("★★★");
  expect(plate.querySelector(".tls-lvf-stars").getAttribute("aria-label")).toBe("Prestige 3");
  expect(plate.querySelectorAll(".tls-lvf-pip.is-on")).toHaveLength(5);
});

test("Ohne Prestige keine Sterne, Prestige über 5 bleibt bei 5", () => {
  expect(frame({ level: 12 }).querySelector(".tls-lvf-stars")).toBeNull();
});

test("Prestige über 5 bleibt bei fünf Sternen", () => {
  expect(frame({ level: 2, prestige: 9 }).querySelector(".tls-lvf-stars")).toHaveTextContent(/^★★★★★$/);
});

test("Listen: nur die Grafik - kein Glanz, kein Schild", () => {
  const el = frame({ level: 40, compact: true });
  expect(el.className).toContain("tls-lvf--list");
  expect(el.querySelector(".tls-lvf-shine")).toBeNull();
  expect(el.querySelector("[data-testid='level-frame-badge']")).toBeNull();
  expect(el.querySelector("img.tls-lvf-img")).not.toBeNull();
});

test("Profil: Glanz mit der Maske aus dem Rahmenbild, stärker je Level im Rang", () => {
  const low = frame({ level: 25 });
  const shine = low.querySelector(".tls-lvf-shine");
  expect(shine.style.getPropertyValue("--lvf-mask")).toContain("rang-06-640.webp");
  const lowStrength = Number(low.style.getPropertyValue("--lvf-shine"));
  const high = frame({ level: 29 }, "hoch");
  expect(Number(high.style.getPropertyValue("--lvf-shine"))).toBeGreaterThan(lowStrength);
});

test("Team-Rahmen sagt TEAM im Schild", () => {
  expect(frame({ level: 3, team: true }).querySelector("[data-testid='level-frame-badge']")).toHaveTextContent("TEAM LVL 3");
});

test("Listen: Level und Rang als zugänglicher Name, sonst über das Schild", () => {
  const list = frame({ level: 9, compact: true });
  expect(list.getAttribute("role")).toBe("img");
  expect(list.getAttribute("aria-label")).toBe("Level 9, Rang Fährte");
  expect(frame({ level: 2, compact: true, team: true }, "team").getAttribute("aria-label")).toBe("Team-Level 2, Rang Jungtier");
  expect(frame({ level: 60, prestige: 2 }, "profil").getAttribute("role")).toBeNull();
});

test("feste Fläche: jeder Rang dieselbe Größe, das Foto passt sich an", () => {
  const low = frame({ level: 1 }, "rang1");
  const high = frame({ level: 42 }, "rang9");
  expect(low.className).toContain("tls-lvf--profile");
  expect(high.className).toContain("tls-lvf--profile");
  // Rang 1 bekommt ein großes Foto, Rang 9 mit den Schwingen ein kleineres.
  expect(Number(low.style.getPropertyValue("--lvf-fit"))).toBeGreaterThan(Number(high.style.getPropertyValue("--lvf-fit")));
  expect(Number(high.style.getPropertyValue("--lvf-fit"))).toBe(frameFit(RING["09"]).photo);
  expect(high.className).toContain("tls-lvf--plate");
  expect(frame({ level: 60, prestige: 1 }, "sterne").className).toContain("tls-lvf--stars");
});

test("Kronen (#1458): klein, ohne Dauer-Leuchten und ohne Schweben (CSS)", () => {
  const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8").replace(/\r\n/g, "\n");
  const start = css.indexOf("/* Kronen der Punktewertung (#1458)");
  const block = css.slice(start, css.indexOf("/* profile quick-stat highlight", start));
  const crown = block.match(/\.tls-lvf-crown \{[^}]*\}/)[0];
  // etwa ein Drittel von früher (96 px im Profil): 11,5 % der Fläche, mindestens 14 px
  expect(crown).toContain("--crown-w: max(14px, calc(var(--lvf-s) * 0.115));");
  expect(crown).not.toMatch(/infinite/);
  expect(block).not.toMatch(/tls-lvf-crown::before|tls-lvf-crown::after|tls-lvf-crown-rays \{/);
  expect(block).toContain(".tls-lvf--still .tls-lvf-crown { animation: none; }");
});

test("Kronen: kein Strahlenkranz mehr, Onyx statt Obsidian (Rang 10 heißt Obsidian)", () => {
  const el = frame({ level: 31, crown: "onyx" }, "onyx");
  const crown = el.querySelector("[data-testid='avatar-crown']");
  expect(crown.getAttribute("title")).toBe("Onyx · Level 30+");
  expect(crown.className).toContain("tls-lvf-crown--onyx");
  expect(el.querySelector(".tls-lvf-crown-rays")).toBeNull();
  expect(Object.values(CROWN_LABELS).join(" ")).not.toMatch(/Obsidian/);
  // ältere Antworten mit „obsidian“ zeigen ebenfalls die Onyx-Krone
  expect(crownVariant("obsidian")).toBe("onyx");
  expect(crownVariant("gold")).toBe("gold");
  expect(crownVariant(null)).toBeNull();
  const legacy = frame({ level: 31, crown: "obsidian" }, "alt").querySelector("[data-testid='avatar-crown']");
  expect(legacy.getAttribute("title")).toBe("Onyx · Level 30+");
});

test("Signatur (#1455): nur im Profil und ab dem zweiten Level im Rang", async () => {
  const profile = frame({ level: 58 }, "profil-58");
  const canvas = await screen.findByTestId("loewen-signature");
  expect(profile.contains(canvas)).toBe(true);
  expect(canvas.dataset.signature).toBe("storm");
  expect(frame({ level: 55 }, "profil-55").querySelector("canvas")).toBeNull();
  for (const [props, id] of [[{ level: 58, compact: true }, "liste"], [{ level: 58, size: "card" }, "karte"], [{ level: 58, size: "mini" }, "mini"]]) {
    expect(frame(props, id).querySelector("canvas")).toBeNull();
  }
  await waitFor(() => expect(screen.getAllByTestId("loewen-signature")).toHaveLength(1));
});

test("Signatur: mit „Bewegung reduzieren“ kein Canvas", async () => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
  try {
    const el = frame({ level: 60 }, "ruhig");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(el.querySelector("canvas")).toBeNull();
  } finally {
    delete window.matchMedia;
  }
});

test("mini (Podest): klein, still, ohne Schild", () => {
  const mini = frame({ level: 12, size: "mini" }, "podest");
  expect(mini.className).toContain("tls-lvf--mini");
  expect(mini.className).toContain("tls-lvf--still");
  expect(mini.getAttribute("aria-label")).toBe("Level 12, Rang Rudel");
  expect(mini.querySelector(".tls-lvf-shine")).toBeNull();
  expect(mini.querySelector("[data-testid='level-frame-badge']")).toBeNull();
});
