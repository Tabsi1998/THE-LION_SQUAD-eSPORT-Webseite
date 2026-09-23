import { MAX_LOGO_RATIO, isFinderCell, qrFileName, qrMatrix, qrModel, qrSvgMarkup } from "./qrDesign";

// QR-Code mit Löwe (#400): Fehlerkorrektur H, Suchmuster getrennt gezeichnet, die Mitte für das
// Logo frei, und die Druckdatei hat dieselbe Geometrie.

test("die Matrix ist ein QR-Code mit Fehlerkorrektur H", () => {
  const matrix = qrMatrix("https://lionsquad.at/tournaments/autumn-cup");
  expect(matrix.size % 4).toBe(1);
  expect(matrix.size).toBeGreaterThanOrEqual(25);
  expect(matrix.dark(0, 0)).toBe(true); // Ecke des Suchmusters
  expect(isFinderCell(0, 0, matrix.size)).toBe(true);
  expect(isFinderCell(10, 10, matrix.size)).toBe(false);
});

test("Module lassen Suchmuster und Logo-Platte frei; die Platte bleibt unter 24 % der Kante", () => {
  const model = qrModel({ value: "https://lionsquad.at", size: 232, logoRatio: 0.5 });
  const unit = model.unit;
  const offset = model.quietZone * unit;
  // Kein Modul liegt in einem Suchmuster.
  expect(model.modules.some((m) => m.x < offset + 7 * unit - 0.01 && m.y < offset + 7 * unit - 0.01)).toBe(false);
  expect(model.finders).toHaveLength(3);
  // Platte höchstens MAX_LOGO_RATIO der Kante, mittig, und kein Modul darunter.
  expect(model.plate.size).toBeLessThanOrEqual(232 * MAX_LOGO_RATIO + unit);
  const center = 232 / 2;
  expect(Math.abs(model.plate.x + model.plate.size / 2 - center)).toBeLessThan(unit);
  const inside = model.modules.filter((m) => m.x >= model.plate.x && m.x + model.moduleSize <= model.plate.x + model.plate.size && m.y >= model.plate.y && m.y + model.moduleSize <= model.plate.y + model.plate.size);
  expect(inside).toHaveLength(0);

  const plain = qrModel({ value: "https://lionsquad.at", size: 116, withLogo: false });
  expect(plain.plate).toBeNull();
  expect(plain.modules.length).toBeGreaterThan(model.modules.length * 116 / 232 / 2);
});

test("die Druckdatei trägt Rahmen, drei Suchmuster, die Platte und das Logo", () => {
  const model = qrModel({ value: "https://lionsquad.at", size: 1024, accent: "#29B6E8" });
  const svg = qrSvgMarkup(model, { logoHref: "data:image/png;base64,AAAA", title: "Herbst-Cup" });
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('width="1024" height="1024"');
  expect(svg).toContain("<title>Herbst-Cup</title>");
  expect((svg.match(/fill="#29B6E8"/g) || []).length).toBe(6); // 3 Suchmuster × Rahmen + Kern
  expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
  expect(qrSvgMarkup(model)).not.toContain("<image");
  expect(qrFileName("Herbst-Cup: Anmeldung & Check-in", "png")).toBe("herbst-cup-anmeldung-check-in.png");
});
