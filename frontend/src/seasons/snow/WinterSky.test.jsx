import { act, render, screen } from "@testing-library/react";
import { STAR_CHECKS_MS, WinterSky, pointFree } from "./WinterSky";

// Der Winterhimmel (W4 #730): hinter dem Inhalt; Blauschein nach der Nacht, Glühen auf der Seite der Sonne, Sterne
// nach Licht und Wolken - und nur an freien Stellen, nie hinter Schrift; ohne Bewegung still; der Mond der Saisons.

const NIGHT = { night: 1, warmth: 0, side: 0.7, clouds: 0, stars: 1, moon: 1 };
const DUSK = { night: 0.3, warmth: 0.8, side: 0.7, clouds: 0, stars: 0.3, moon: 0.4 };

afterEach(() => {
  vi.useRealTimers();
  delete document.elementFromPoint;
  document.body.innerHTML = "";
});

test("die Stelle ist frei, wenn dort keine Schrift, kein Bild und kein Bedienelement liegt", () => {
  const page = document.createElement("div");
  page.innerHTML = `<main><div id="empty"></div><button id="knopf">Los</button><img id="bild" alt="" /></main>`;
  document.body.appendChild(page);
  const hits = { "10,10": "empty", "20,20": "knopf", "30,30": "bild" };
  const doc = { body: document.body, documentElement: document.documentElement, elementFromPoint: (x, y) => document.getElementById(hits[`${x},${y}`]) };
  expect(pointFree(doc, 10, 10)).toBe(true);
  expect(pointFree(doc, 20, 20)).toBe(false);
  expect(pointFree(doc, 30, 30)).toBe(false);
  expect(pointFree(null, 1, 1)).toBe(true);
});

test("nachts: Blauschein voll, Sterne nach Zahl und nur an freien Stellen, mit Funkeln; der Mond steht am Himmel", async () => {
  vi.useFakeTimers();
  const blocked = document.createElement("p");
  blocked.textContent = "Text";
  document.body.appendChild(blocked);
  // Die obere linke Hälfte ist „Schrift“ - dort bleibt kein Stern.
  document.elementFromPoint = (x) => (x < window.innerWidth / 2 ? blocked : document.body);
  render(<WinterSky light={NIGHT} stars={32} moon year="2026" location={null} />);
  expect(screen.getByTestId("winter-sky").className).toContain("tls-winter-sky");
  expect(screen.getByTestId("snow-tint").style.opacity).toBe("1");
  expect(screen.queryByTestId("winter-glow")).toBeNull();
  const svg = screen.getByTestId("winter-stars");
  expect(svg.getAttribute("class")).toContain("tls-winter-stars--twinkle");
  expect(svg.querySelectorAll("circle")).toHaveLength(32);
  await act(async () => {
    vi.advanceTimersByTime(STAR_CHECKS_MS[0] + 10);
  });
  const circles = [...svg.querySelectorAll("circle")];
  const free = circles.filter((circle) => circle.getAttribute("data-free") === "1");
  expect(free.length).toBeGreaterThan(5);
  expect(free.length).toBeLessThan(32);
  free.forEach((circle) => expect(Number(circle.getAttribute("cx"))).toBeGreaterThanOrEqual(window.innerWidth / 2));
  circles.filter((circle) => circle.getAttribute("data-free") === "0").forEach((circle) => expect(circle.style.fillOpacity).toBe("0"));
  expect(screen.getByTestId("season-moon")).toBeTruthy();
});

test("Dämmerung: Glühen auf der Sonnenseite, weniger Sterne; ohne Bewegung funkelt nichts; ohne Mond-Erlaubnis kein Mond", () => {
  render(<WinterSky light={DUSK} stars={32} moon={false} year="2026" moving={false} />);
  const glow = screen.getByTestId("winter-glow");
  expect(glow.style.opacity).toBe("0.8");
  expect(glow.style.getPropertyValue("--glow-x")).toBe("70%");
  const svg = screen.getByTestId("winter-stars");
  expect(svg.querySelectorAll("circle")).toHaveLength(10);
  expect(svg.getAttribute("class")).not.toContain("twinkle");
  expect(screen.queryByTestId("season-moon")).toBeNull();
});

test("tags: kein Blauschein, keine Sterne - nur der blasse Mond", () => {
  render(<WinterSky light={{ night: 0, warmth: 0, side: 0.7, clouds: 0, stars: 0, moon: 0.25 }} stars={32} moon year="2026" />);
  expect(screen.queryByTestId("snow-tint")).toBeNull();
  expect(screen.queryByTestId("winter-stars")).toBeNull();
  expect(screen.getByTestId("season-moon")).toBeTruthy();
});
