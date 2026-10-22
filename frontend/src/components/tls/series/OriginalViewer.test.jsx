import { act, fireEvent, render, screen } from "@testing-library/react";
import { OriginalsButton } from "./OriginalViewer";

// „Original ansehen“ (#1933): Vollbild, Pfeiltasten, Wischen, Escape, Fokus zurück, Quelle nur als https.

const URL = "/api/reference-series/public/probe-liga/2026/originals";
const ITEMS = [
  { id: "a", kind: "qualifying", url: `${URL}/a`, width: 1920, height: 1080, source_url: "https://veranstalter.example/q" },
  { id: "b", kind: "race", url: `${URL}/b`, width: 1280, height: 720, source_url: "http://veranstalter.example/r" },
  { id: "c", kind: "scoreboard", map: 2, url: `${URL}/c`, width: 800, height: 600 },
];

function open(items = ITEMS) {
  render(<OriginalsButton items={items} title="R3 · Probering" />);
  const button = screen.getByTestId("originals-open");
  button.focus();
  fireEvent.click(button);
  return button;
}

function key(name) {
  act(() => { window.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true })); });
}

test("ohne öffentliche Bilder gibt es keinen Knopf", () => {
  const { container } = render(<OriginalsButton items={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test("Vollbild mit allen Bildern: Zähler, Pfeiltasten blättern rundum, Escape schließt, Fokus zurück", () => {
  const button = open();
  expect(button).toHaveTextContent("Original ansehen");
  expect(button).toHaveAccessibleName("Original ansehen, 3 Bilder");
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAccessibleName("Original-Bilder: R3 · Probering");
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Qualifying");
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("1 / 3");
  // Großes Bild: höchstens die 1600er Fassung, die kleineren als srcset.
  const image = screen.getByTestId("original-viewer-image");
  expect(image).toHaveAttribute("src", `${URL}/a?w=1600`);
  expect(image.getAttribute("srcset")).toContain(`${URL}/a?w=800 800w`);
  expect(image).toHaveAttribute("width", "1920");

  key("ArrowRight");
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("2 / 3");
  expect(screen.getByTestId("original-viewer-status")).toHaveTextContent("Bild 2 von 3: Rennen");
  key("ArrowLeft");
  key("ArrowLeft");
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Scoreboard · Map 2");
  expect(screen.getAllByTestId("original-viewer-thumb")[2]).toHaveAttribute("aria-current", "true");

  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByTestId("original-viewer")).toBeNull();
  expect(button).toHaveFocus();
});

test("wischen blättert, ein senkrechter Zug nicht", () => {
  open();
  const stage = screen.getByTestId("original-viewer-stage");
  fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 200, pointerType: "touch" });
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 180, clientY: 210, pointerType: "touch" });
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("2 / 3");
  fireEvent.pointerDown(stage, { pointerId: 2, clientX: 100, clientY: 200, pointerType: "touch" });
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 230, clientY: 190, pointerType: "touch" });
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("1 / 3");
  fireEvent.pointerDown(stage, { pointerId: 3, clientX: 100, clientY: 100, pointerType: "touch" });
  fireEvent.pointerUp(stage, { pointerId: 3, clientX: 130, clientY: 400, pointerType: "touch" });
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("1 / 3");
});

test("Knöpfe und Vorschau blättern; die Quelle steht nur als https-Link da", () => {
  open();
  expect(screen.getByTestId("original-viewer-source")).toHaveAttribute("href", "https://veranstalter.example/q");
  fireEvent.click(screen.getByTestId("original-viewer-next"));
  expect(screen.queryByTestId("original-viewer-source")).toBeNull();
  fireEvent.click(screen.getAllByTestId("original-viewer-thumb")[2]);
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("3 / 3");
  fireEvent.click(screen.getByTestId("original-viewer-prev"));
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("2 / 3");
  fireEvent.click(screen.getByTestId("original-viewer-close"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("ein einzelnes Bild: ohne Zähler, Pfeile und Vorschauleiste", () => {
  open([ITEMS[1]]);
  expect(screen.getByTestId("originals-open")).toHaveAccessibleName("Original ansehen");
  expect(screen.queryByTestId("original-viewer-count")).toBeNull();
  expect(screen.queryByTestId("original-viewer-next")).toBeNull();
  expect(screen.queryByTestId("original-viewer-thumbs")).toBeNull();
  expect(screen.getByTestId("original-viewer-image")).toHaveAttribute("src", `${URL}/b`);
});
