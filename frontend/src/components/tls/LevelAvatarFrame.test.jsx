import { render, screen } from "@testing-library/react";
import RING from "@/lib/loewenRangRing.json";
import { LevelAvatarFrame, levelFrameConfig } from "./LevelAvatarFrame";

// Löwen-Rang (#1454): der Rahmen des Rangs als Grafik, am gemessenen Ring ausgerichtet, Schild mit Rauten.

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(() => Promise.resolve({ data: { crowns: {} } })) } }));

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
  const px = Math.round(96 / (2 * RING["01"].r));
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
