import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HERO_HAT_SHARES, HeaderMascotHat, HeroMascotHat, hatRoom, hatSpot, heroHatSpot } from "./MascotHat";

// Etwas auf dem Kopf des Löwen (gemeinsam für Partyhut und Hasenohren): im Kopf ganz in der Kopfzeile (dort
// eingehängt - Dialoge liegen darüber), auf dem großen Löwen der Schrift ausweichend; Antippen meldet den Punkt und
// lässt wippen - höchstens alle `cooldownMs`; ohne Bewegung nur ein Bild.

function Art({ size }) {
  return <svg width={size} height={size * 1.3} data-testid="art" />;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

test("im Kopf bleibt das Stück ganz im Fenster; das große weicht der Schrift aus - kleiner, dann tiefer, sonst keins", () => {
  expect(hatSpot({ left: 40, top: 16, width: 120, height: 40 }, { x: 0.1, y: 0.05 }, 18)).toEqual({ left: 43, top: -3 });
  expect(hatSpot({ left: 40, top: 16, width: 120, height: 40 }, { x: 0.1, y: 0.05 }, 18, 2).top).toBe(2);
  const lion = { left: 1000, top: 200, width: 200, height: 260 };
  const head = { x: 0.5, y: 0.1 };
  expect(heroHatSpot(lion, head, () => true)).toEqual({ left: 1080, top: 180, size: 40 });
  const below = (limit) => (_x, y) => y > limit;
  const spot = heroHatSpot(lion, head, below(190));
  expect(spot).not.toBeNull();
  expect(spot.top).toBeGreaterThan(190);
  expect(spot.size).toBeLessThanOrEqual(Math.round(lion.width * HERO_HAT_SHARES[0]));
  expect(heroHatSpot(lion, head, () => false)).toBeNull();
});

test("frei für das große Stück: Schrift und Bilder sperren - der Löwe, die Stücke selbst und eigene Ebenen nicht", () => {
  const anchor = document.createElement("div");
  const lionImg = document.createElement("img");
  anchor.append(lionImg);
  const text = document.createElement("p");
  text.textContent = "Mitglied wird, wer sich einbringt";
  const hat = document.createElement("span");
  hat.className = "tls-mascot-hat";
  const grass = document.createElement("div");
  grass.className = "tls-easter-layer";
  const blade = document.createElement("svg");
  grass.append(blade);
  document.body.append(anchor, text, hat, grass);
  document.elementsFromPoint = (_x, y) => (y < 100 ? [hat, text, document.body] : y < 200 ? [hat, lionImg, anchor, document.body] : [blade, grass, document.body]);
  expect(hatRoom(document, 10, 50, anchor)).toBe(false);
  expect(hatRoom(document, 10, 150, anchor)).toBe(true);
  expect(hatRoom(document, 10, 150, null)).toBe(false);
  expect(hatRoom(document, 10, 250, anchor)).toBe(false);
  expect(hatRoom(document, 10, 250, anchor, ".tls-easter-layer")).toBe(true);
  delete document.elementsFromPoint;
});

/** Kopf mit Logo und der große Löwe, beide „geladen“ und vermessen. */
function stage() {
  const header = document.createElement("header");
  const column = document.createElement("div");
  const logo = document.createElement("img");
  logo.dataset.testid = "tls-logo";
  column.append(logo);
  header.append(column);
  const anchor = document.createElement("div");
  anchor.dataset.seasonAnchor = "lion";
  const lion = document.createElement("img");
  anchor.append(lion);
  document.body.append(header, anchor);
  const loaded = (img, rect) => {
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: rect.width * 2 });
    Object.defineProperty(img, "naturalHeight", { value: rect.height * 2 });
    img.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  };
  loaded(logo, { left: 40, top: 16, width: 160, height: 48 });
  loaded(lion, { left: 1000, top: 220, width: 220, height: 260 });
  header.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1440, height: 80, right: 1440, bottom: 80 });
  return { header };
}

test("im Kopf hängt das Stück in der Kopfzeile selbst; Antippen meldet den Punkt - höchstens alle cooldownMs", () => {
  const { header } = stage();
  const onTap = vi.fn();
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  render(<MemoryRouter><HeaderMascotHat Art={Art} moving label="Ohren – zucken lassen" title="Ohren" testId="ears" onTap={onTap} cooldownMs={4000} wiggleClass="tls-mascot-hat--twitch" /></MemoryRouter>);
  const ears = screen.getByTestId("ears");
  expect(ears.tagName).toBe("BUTTON");
  expect(header.contains(ears)).toBe(true);
  expect(ears).toHaveAccessibleName("Ohren – zucken lassen");
  // Koordinaten relativ zur Kopfzeile, nie über ihren oberen Rand.
  expect(parseFloat(ears.style.top)).toBeGreaterThanOrEqual(2);
  fireEvent.click(ears);
  expect(onTap).toHaveBeenCalledTimes(1);
  expect(ears.className).toContain("tls-mascot-hat--twitch");
  now.mockReturnValue(1_000_000 + 3999);
  fireEvent.click(ears);
  expect(onTap).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1_000_000 + 4000);
  fireEvent.click(ears);
  expect(onTap).toHaveBeenCalledTimes(2);
});

test("ohne Bewegung nur ein Bild - auf dem großen Löwen gehört es zur Seite", () => {
  stage();
  render(<MemoryRouter><HeroMascotHat Art={Art} moving={false} label="x" title="x" testId="hero-ears" /></MemoryRouter>);
  const hero = screen.getByTestId("hero-ears");
  expect(hero.tagName).toBe("SPAN");
  expect(hero.closest(".tls-mascot-hat-page")).not.toBeNull();
  expect(document.querySelectorAll("button")).toHaveLength(0);
});
