import { render, screen, within } from "@testing-library/react";
import { LoadoutBansView } from "./LoadoutBansView";

// Sperrliste öffentlich (#2218): je Kategorie mit Bild, Modus-Hinweis, dann die Aufsätze an erlaubten Waffen. Erfundene Namen.
vi.mock("@/lib/api", () => ({ resolveMediaUrl: (url) => url || "" }));

const LIST = { entries: [
  { kind: "item", item_id: "w1", name: "Blitz 9", category_label: "Waffen", image_url: "/api/static/uploads/blitz.webp", mode_labels: [], attachments: [] },
  { kind: "item", item_id: "p1", name: "Leise Sohlen", category_label: "Perks", image_url: null, mode_labels: ["Suchen"], attachments: [] },
  { kind: "attachments", item_id: "w2", name: "Donner 4", category_label: "Waffen", image_url: null, mode_labels: [],
    attachments: [{ item_id: "a1", name: "Griff" }, { item_id: "a2", name: "Lauf" }] },
] };

test("ohne Liste kein Block", () => {
  const { container } = render(<LoadoutBansView list={null} />);
  expect(container).toBeEmptyDOMElement();
  render(<LoadoutBansView list={{ entries: [] }} testId="leer" />);
  expect(screen.queryByTestId("leer")).not.toBeInTheDocument();
});

test("Gruppen mit Bild, Modus und Aufsätzen an Waffen", () => {
  render(<LoadoutBansView list={LIST} />);
  const groups = screen.getAllByTestId("loadout-ban-group");
  expect(groups.map((group) => group.querySelector("h3").textContent)).toEqual(["Waffen1 Eintrag", "Perks1 Eintrag"]);
  expect(groups[0].querySelector("img")).toHaveAttribute("sizes");
  expect(within(groups[0]).getByTestId("loadout-ban-modes")).toHaveTextContent("in allen Modi");
  expect(within(groups[1]).getByTestId("loadout-ban-modes")).toHaveTextContent("nur Suchen");
  expect(within(groups[1]).getByTestId("equipment-thumb-empty")).toBeInTheDocument();
  const weapon = screen.getByTestId("loadout-ban-weapon");
  expect(weapon).toHaveTextContent("Donner 4");
  expect(weapon).toHaveTextContent("GriffLauf");
});
