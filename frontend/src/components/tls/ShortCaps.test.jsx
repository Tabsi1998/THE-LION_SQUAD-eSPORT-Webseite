import { render } from "@testing-library/react";
import { ShortCaps } from "./ShortCaps";

// Seitentitel bis 18 Zeichen GROSS (#1303) - über die Schreibweise im Browser, der Text selbst bleibt, wie er eingetippt
// wurde (Vorlesen, Suchen, Kopieren). Länger: normal, ohne zusätzliches Element.

test("kurzer Titel: GROSS über eine Klasse, der Text bleibt unverändert", () => {
  const { container } = render(<h1><ShortCaps>Turniere</ShortCaps></h1>);
  const span = container.querySelector("h1 > span");
  expect(span).toHaveClass("uppercase");
  expect(span.textContent).toBe("Turniere");
});

test("weiche Trennstellen zählen nicht mit", () => {
  const { container } = render(<h1><ShortCaps>{"Vereins­mitglieder"}</ShortCaps></h1>);
  expect(container.querySelector("h1 > span")).toHaveClass("uppercase");
});

test("langer Titel bleibt normal - ohne zusätzliches Element", () => {
  const title = "Online Cup FC 26: Anmeldung offen für alle Mitglieder";
  const { container } = render(<h1><ShortCaps>{title}</ShortCaps></h1>);
  expect(container.querySelector("h1").innerHTML).toBe(title);
});

test("ohne Text oder mit Bausteinen darin: nichts GROSS", () => {
  const { container } = render(<h1><ShortCaps>{null}</ShortCaps><ShortCaps><b>Kurz</b></ShortCaps></h1>);
  expect(container.querySelector(".uppercase")).toBeNull();
  expect(container.querySelector("h1").textContent).toBe("Kurz");
});
