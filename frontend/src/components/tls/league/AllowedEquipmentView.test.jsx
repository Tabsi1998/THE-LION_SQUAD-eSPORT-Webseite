import { render, screen, within } from "@testing-library/react";
import { AllowedEquipmentView } from "./AllowedEquipmentView";

// Erlaubte Ausrüstung (#2287, Fabian Nr. 99): dieselbe Sicht wie das Regelwerk - erlaubt mit Hinweis, ganze Klasse „Nicht erlaubt“ als
// kurze Zeile, Aufsatz „nicht an …“. Erfundene Namen.
vi.mock("@/lib/api", () => ({ resolveMediaUrl: (url) => url || "" }));

const DATA = { list: true, layout: 3, categories: [
  { label: "Waffen", sections: [
    { label: null, state: "all", not_in: [], banned: [], entries: [{ name: "Ohne Klasse", image_url: null, not_in: [], not_at: [] }] },
    { label: "Sturmgewehr", icon_url: "/api/static/uploads/klasse.png", state: "some", not_in: [], banned: [], entries: [
      { name: "Blitz 9", image_url: "/api/static/uploads/blitz.png", not_in: ["Suchen"], not_at: [] }] },
    { label: "Schrotflinte", state: "banned", not_in: [], banned: ["Bö", "Hagel"], entries: [] },
    { label: "Pistole", state: "some", not_in: ["Suchen"], banned: [], entries: [
      { name: "Funke", image_url: null, not_in: ["Suchen"], not_at: [] }, { name: "Zunder", image_url: null, not_in: ["Suchen", "Stellung"], not_at: [] }] },
  ] },
  { label: "Aufsätze", sections: [{ label: "Optik", state: "some", not_in: [], banned: [], entries: [
    { name: "Rotpunkt", image_url: null, not_in: [], not_at: [{ name: "Blitz 9", modes: [] }, { name: "Donner 4", modes: ["Suchen"] }] }] }] },
] };

test("ohne Bibliothek kein Block", () => {
  const { container } = render(<AllowedEquipmentView data={null} />);
  expect(container).toBeEmptyDOMElement();
  render(<AllowedEquipmentView data={{ list: false, groups: [], weapons: [] }} testId="alt" />);
  expect(screen.queryByTestId("alt")).not.toBeInTheDocument();
});

test("erlaubt mit Hinweisen, ganze Klasse nicht erlaubt als kurze Zeile", () => {
  render(<AllowedEquipmentView data={DATA} />);
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Erlaubte Ausrüstung");
  expect(screen.getByTestId("allowed-equipment-intro")).toHaveTextContent("Erlaubt ist die Ausrüstung, die hier steht");
  const groups = screen.getAllByTestId("allowed-group");
  expect(groups[0].querySelector("h3")).toHaveTextContent("Waffen4 erlaubt");
  const sections = within(groups[0]).getAllByTestId("allowed-section");
  expect(sections[0].querySelector("h4")).toBeNull();
  expect(within(sections[1]).getByTestId("allowed-note")).toHaveTextContent("nicht in Suchen");
  expect(within(sections[2]).getByTestId("allowed-banned")).toHaveTextContent("Nicht erlaubt");
  expect(within(sections[2]).getByTestId("allowed-banned-names")).toHaveTextContent("Bö, Hagel");
  expect(within(sections[2]).queryAllByTestId("allowed-entry")).toHaveLength(0);
  // Die Klasse nur in „Suchen“ gesperrt: steht im Kopf, die Karte nennt nur, was dazukommt.
  expect(within(sections[3]).getByTestId("allowed-section-note")).toHaveTextContent("nicht in Suchen");
  const tiles = within(sections[3]).getAllByTestId("allowed-entry");
  expect(within(tiles[0]).queryByTestId("allowed-note")).toBeNull();
  expect(within(tiles[1]).getByTestId("allowed-note")).toHaveTextContent("nicht in Suchen, Stellung");
  expect(within(groups[1]).getByTestId("allowed-note")).toHaveTextContent("nicht an Blitz 9, Donner 4 (in Suchen)");
});

test("ohne Sperrliste: alles erlaubt, „Alle erlaubt“ an der Klasse", () => {
  render(<AllowedEquipmentView data={{ list: false, layout: 3, categories: [{ label: "Waffen", sections: [
    { label: "Schrotflinte", state: "all", not_in: [], banned: [], entries: [{ name: "Hagel", image_url: null, not_in: [], not_at: [] }] }] }] }} />);
  expect(screen.getByTestId("allowed-equipment-intro")).toHaveTextContent("nichts gesperrt");
  expect(screen.getByTestId("allowed-all")).toHaveTextContent("Alle erlaubt");
});
