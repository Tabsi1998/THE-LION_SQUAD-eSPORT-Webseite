import { render, screen, within } from "@testing-library/react";
import { MapCard, MapPoolView } from "./MapPoolView";

// Map-Pool öffentlich (#1616): je Modus die Maps als Karten mit Bild - nur erfundene Map-Namen.
const POOL = {
  id: "p1", version: 2, origin: "reference_series",
  modes: [
    { mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafenkante", image_url: "/api/static/uploads/hafen.webp" }] },
    { mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "nebel", name: "Nebelwerk", image_url: null }, { map_id: "hafen", name: "Hafenkante", image_url: "/api/static/uploads/hafen.webp" }] },
  ],
};

test("zeigt je Modus die Maps als Karten mit Bild, ohne Bild einen ruhigen Platzhalter", () => {
  render(<MapPoolView pool={POOL} />);
  const section = screen.getByTestId("map-pool");
  expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Map-Pool");
  const groups = screen.getAllByTestId("map-pool-mode");
  expect(groups.map((group) => within(group).getByRole("heading", { level: 3 }).textContent)).toEqual(["Stellung1 Map", "Suchen & Zerstören2 Maps"]);
  const cards = within(groups[1]).getAllByTestId("map-card");
  expect(cards.map((card) => card.textContent)).toEqual(["Nebelwerk", "Hafenkante"]);
  expect(within(cards[0]).queryByRole("img")).toBeNull();
  expect(within(cards[0]).getByTestId("map-card-placeholder")).toBeInTheDocument();
  // Bild mit Breitenangabe (Wächter imageSizes) und leerem Alt - der Name steht als Text daneben.
  const img = cards[1].querySelector("img");
  expect(img.getAttribute("sizes")).toBeTruthy();
  expect(img.getAttribute("alt")).toBe("");
});

test("staffelt die Karten beim Erscheinen – höchstens acht Stufen", () => {
  const many = { ...POOL, modes: [{ mode: null, label: "Alle Maps", maps: Array.from({ length: 10 }, (_, index) => ({ map_id: `m${index}`, name: `Karte ${index}` })) }] };
  render(<MapPoolView pool={many} />);
  const steps = screen.getAllByTestId("map-card").map((card) => card.style.getPropertyValue("--tls-i"));
  expect(steps).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "8"]);
  // Ein Pool ohne Modi zeigt keine Modus-Überschrift.
  expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
});

test("ohne Pool erscheint nichts – kein leerer Abschnitt", () => {
  const { container } = render(<MapPoolView pool={null} />);
  expect(container).toBeEmptyDOMElement();
  const { container: empty } = render(<MapPoolView pool={{ modes: [] }} />);
  expect(empty).toBeEmptyDOMElement();
});

test("eine Karte nennt auf Wunsch ihre Position im Pool", () => {
  render(<MapCard item={{ name: "Glutsenke" }} position={3} />);
  expect(screen.getByTestId("map-card-position")).toHaveTextContent("3");
});
