import { SCENE, pawPrint, ridgePoints, sceneSvg, sceneUrl } from "./scene";
import { mulberry32 } from "@/seasons/rng";

// Das Bild des Adventkalenders (#641, #732): je Jahr dasselbe Bild, jedes Jahr ein anderes - am Boden verankert,
// damit Dorf und Berge in jedem Format zu sehen sind.

test("dasselbe Jahr, dasselbe Bild - ein anderes Jahr, ein anderes Bild", () => {
  expect(sceneSvg(2026)).toBe(sceneSvg(2026));
  expect(sceneSvg(2026)).not.toBe(sceneSvg(2027));
  expect(sceneSvg(2026)).toContain('data-year="2026"');
});

test("hoch gebaut und am Boden verankert", () => {
  const svg = sceneSvg(2026);
  expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE.width} ${SCENE.height}"`)).toBe(true);
  expect(svg).toContain('preserveAspectRatio="xMidYMax slice"');
  expect(svg.endsWith("</svg>")).toBe(true);
  expect(SCENE.height / SCENE.width).toBeGreaterThanOrEqual(8 / 3);
});

test("alle Teile des Bildes sind da", () => {
  const svg = sceneSvg(2026);
  for (const part of ["aurora", "stars", "leo", "moon", "mountains", "forest", "village", "paws", "snowfall"]) {
    expect(svg).toContain(`data-part="${part}"`);
  }
  // Das Sternbild Löwe: neun Sterne, zehn Linien.
  const leo = svg.slice(svg.indexOf('data-part="leo"'), svg.indexOf('data-part="moon"'));
  expect((leo.match(/<line /g) || []).length).toBe(10);
  expect((leo.match(/fill="#fff8e6"/g) || []).length).toBe(9);
  // Die Spur der Tatze: zwölf Abdrücke mit je vier Zehen.
  const paws = svg.slice(svg.indexOf('data-part="paws"'), svg.indexOf('data-part="snowfall"'));
  expect((paws.match(/<g transform=/g) || []).length).toBe(12);
  expect((paws.match(/<ellipse /g) || []).length).toBe(48);
});

test("sauberes SVG: keine kaputten Zahlen, jede Kennung nur einmal, nicht zu schwer", () => {
  for (const year of [2026, 2027, 2028, 2031]) {
    const svg = sceneSvg(year);
    expect(svg).not.toMatch(/NaN|undefined|Infinity|null/);
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const used of [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1])) expect(ids).toContain(used);
    expect(svg.length).toBeLessThan(110000);
    expect((svg.match(/<svg/g) || []).length).toBe(1);
  }
});

test("als Adresse für CSS", () => {
  const url = sceneUrl(2026);
  expect(url.startsWith('url("data:image/svg+xml,%3Csvg')).toBe(true);
  expect(url.endsWith('")')).toBe(true);
  expect(decodeURIComponent(url.slice('url("data:image/svg+xml,'.length, -2))).toBe(sceneSvg(2026));
  expect(url).not.toMatch(/["'] /);
});

test("ein Bergkamm bleibt im Bild und hat seine Gipfel", () => {
  const points = ridgePoints(mulberry32(7), { base: 2860, height: 250, peaks: 5 });
  expect(points.filter((point) => point.peak)).toHaveLength(5);
  expect(points[0].x).toBe(0);
  expect(points[points.length - 1].x).toBe(SCENE.width);
  for (let index = 1; index < points.length; index += 1) expect(points[index].x).toBeGreaterThanOrEqual(points[index - 1].x);
  for (const point of points) {
    expect(point.y).toBeLessThanOrEqual(2860);
    expect(point.y).toBeGreaterThanOrEqual(2860 - 250 * 1.3);
  }
});

test("eine Tatze: ein Ballen und vier Zehen", () => {
  const paw = pawPrint(100, 200, 0.5, 30);
  expect(paw).toContain('transform="translate(100 200) rotate(30) scale(0.5)"');
  expect((paw.match(/<ellipse /g) || []).length).toBe(4);
  expect((paw.match(/<path /g) || []).length).toBe(1);
});
