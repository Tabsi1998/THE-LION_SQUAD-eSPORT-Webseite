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
  // Ohne Unterkategorien kein Abschnittskopf.
  expect(screen.queryByTestId("loadout-ban-section-head")).not.toBeInTheDocument();
});

// #2287: je Unterkategorie ein Abschnitt; eine ganz gesperrte Klasse zeigt ihre Einträge und sagt es einmal im Kopf.
const GROUPED = { entries: [
  { kind: "class", subcategory: "schrot", subcategory_label: "Schrotflinte", category_label: "Waffen", image_url: "/api/static/uploads/klasse.png",
    mode_labels: [], items: [{ item_id: "s1", name: "Hagel", image_url: null }, { item_id: "s2", name: "Bö", image_url: null }] },
  { kind: "item", item_id: "w1", name: "Blitz 9", subcategory: "sturm", subcategory_label: "Sturmgewehr", category_label: "Waffen",
    image_url: null, mode_labels: ["Suchen"], attachments: [] },
  { kind: "class", subcategory: "leer", subcategory_label: "Raketenwerfer", category_label: "Waffen", mode_labels: [], items: [] },
] };

test("gruppiert nach Unterkategorie, ganze Klasse einmal im Kopf, leere Klasse entfällt", () => {
  render(<LoadoutBansView list={GROUPED} />);
  const sections = screen.getAllByTestId("loadout-ban-section");
  expect(sections.map((section) => section.querySelector("h4").textContent)).toEqual(["Schrotflinte", "Sturmgewehr"]);
  expect(within(sections[0]).getByTestId("loadout-ban-class")).toHaveTextContent("Ganze Klasse gesperrt · in allen Modi");
  expect(within(sections[0]).getAllByTestId("loadout-ban-entry").map((row) => row.textContent)).toEqual(["Bö", "Hagel"]);
  expect(within(sections[0]).queryByTestId("loadout-ban-modes")).not.toBeInTheDocument();
  expect(sections[0].querySelector("h4 img")).toHaveAttribute("sizes", "24px");
  expect(within(sections[1]).getByTestId("loadout-ban-modes")).toHaveTextContent("nur Suchen");
  expect(screen.getByTestId("loadout-ban-group").querySelector("h3")).toHaveTextContent("Waffen3 Einträge");
});
