import { render } from "@testing-library/react";
import { SmartLogo } from "./SmartLogo";

// Logos als SVG (#1952): ein SVG-Logo steht als <img> da und ist in jeder Größe scharf - nie auf eine Leinwand mit fester
// Pixelzahl gezeichnet und nie in die Seite geschrieben. Raster-Logos bleiben beim Zuschneiden auf der Leinwand.

test("ein SVG-Logo kommt als Bild, scharf in jeder Größe", () => {
  const { container } = render(<SmartLogo src="https://lionsquad.example/api/static/uploads/kiwi.svg" alt="Kiwi" className="max-h-full w-auto" />);
  const img = container.querySelector("img");
  expect(img).toHaveAttribute("src", "https://lionsquad.example/api/static/uploads/kiwi.svg");
  expect(img).toHaveAttribute("alt", "Kiwi");
  expect(img.className).toContain("max-h-full w-auto");
  expect(container.querySelector("canvas")).toBeNull();
  expect(container.querySelector("svg")).toBeNull();
});

test("ein Raster-Logo bleibt auf der Leinwand", () => {
  const { container } = render(<SmartLogo src="/api/static/uploads/kiwi.png" alt="Kiwi" className="max-h-full" />);
  expect(container.querySelector("canvas")).not.toBeNull();
});
