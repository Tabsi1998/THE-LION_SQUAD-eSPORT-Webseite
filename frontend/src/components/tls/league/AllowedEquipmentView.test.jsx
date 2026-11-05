import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// #2299/#2298 (layout 4): Aufsätze an der Waffe, aufklappbar; „nur in …“.
const BY_WEAPON = { list: true, layout: 4, categories: [
  { label: "Waffen", role: "weapon", sections: [
    { label: "Sturmgewehr", state: "some", not_in: [], banned: [], entries: [
      { name: "Blitz 9", image_url: null, not_in: ["Stellung", "Kapern"], only_in: ["Suchen"], attachments: { count: 4, banned: ["Laser", "Griff"], groups: [
        { label: "Optik", icon_url: "/api/static/uploads/optik.png", not_in: [], entries: [
          { name: "Rotpunkt", image_url: "/api/static/uploads/rotpunkt.png", not_in: [] },
          { name: "Holo", image_url: null, not_in: ["Stellung", "Kapern"], only_in: ["Suchen"] }] }] } },
      { name: "Donner 4", image_url: null, not_in: [] },
      { name: "Sturm 12", image_url: null, not_in: [], attachments: { count: 1, banned: ["Rotpunkt"], groups: [] } },
    ] },
  ] },
  { label: "Perks", role: "item", sections: [{ label: null, state: "some", not_in: [], banned: [], entries: [
    { name: "Leise Sohlen", image_url: null, not_in: ["Suchen"] }] }] },
] };

test("je Waffe „N Aufsätze · K gesperrt“, aufgeklappt die erlaubten je Slot - per Tastatur", async () => {
  const user = userEvent.setup();
  render(<AllowedEquipmentView data={BY_WEAPON} />);
  expect(screen.queryByText("Aufsätze")).toBeNull();
  const [blitz, sturm] = screen.getAllByTestId("allowed-weapon-toggle");
  expect(blitz).toHaveAttribute("aria-expanded", "false");
  expect(within(blitz).getByTestId("allowed-weapon-summary")).toHaveTextContent("4 Aufsätze · 2 gesperrt");
  expect(within(blitz).getByTestId("allowed-note")).toHaveTextContent("nur in Suchen");
  expect(screen.getAllByTestId("allowed-entry")).toHaveLength(4);
  expect(screen.queryByTestId("allowed-attachments")).toBeNull();

  blitz.focus();
  await user.keyboard("{Enter}");
  expect(blitz).toHaveAttribute("aria-expanded", "true");
  const panel = screen.getByTestId("allowed-attachments");
  expect(blitz).toHaveAttribute("aria-controls", panel.id);
  expect(within(panel).getByTestId("allowed-slot")).toHaveTextContent("Optik");
  expect(within(panel).getAllByTestId("allowed-attachment").map((tile) => tile.textContent)).toEqual(["Rotpunkt", "Holonur in Suchen"]);
  expect(within(panel).getByTestId("allowed-attachments-banned")).toHaveTextContent("Gesperrt: Laser, Griff");
  await user.keyboard(" ");
  expect(screen.queryByTestId("allowed-attachments")).toBeNull();

  await user.click(sturm);
  expect(within(screen.getByTestId("allowed-attachments")).getByText("Keine Aufsätze erlaubt.")).toBeInTheDocument();
  expect(within(sturm).getByTestId("allowed-weapon-summary")).toHaveTextContent("1 Aufsatz · 1 gesperrt");
});

test("„An keiner Waffe erlaubt“ einmal unter den Waffen, „K gesperrt“ zählt sie weiter (Fabian, 04.11.)", async () => {
  const user = userEvent.setup();
  render(<AllowedEquipmentView data={{ ...BY_WEAPON, attachments_everywhere: [{ name: "Kompensator", not_in: [] },
    { name: "Holo", not_in: ["Stellung", "Kapern"], only_in: ["Suchen"] }],
  categories: [{ ...BY_WEAPON.categories[0], sections: [{ ...BY_WEAPON.categories[0].sections[0], entries: [
    { name: "Blitz 9", image_url: null, not_in: [], attachments: { count: 3, banned: ["Laser"], banned_everywhere: 1, groups: [] } }] }] },
  BY_WEAPON.categories[1]] }} />);
  const groups = screen.getAllByTestId("allowed-group");
  expect(within(groups[0]).getByTestId("allowed-nowhere")).toHaveTextContent("An keiner Waffe erlaubtKompensator, Holo (nur in Suchen)");
  expect(within(groups[1]).queryByTestId("allowed-nowhere")).toBeNull();
  const blitz = screen.getByTestId("allowed-weapon-toggle");
  expect(within(blitz).getByTestId("allowed-weapon-summary")).toHaveTextContent("3 Aufsätze · 2 gesperrt");
  await user.click(blitz);
  expect(screen.getByTestId("allowed-attachments-banned")).toHaveTextContent("Gesperrt: Laser · dazu 1 Aufsatz, der an keiner Waffe erlaubt ist");
});

// #2305 (layout 5): Die Slots tragen auch ihre ganz gesperrten (fürs Regelwerk) - ein Slot ohne erlaubten fällt im Kasten weg.
const TABLE = { list: true, layout: 5, categories: [
  { label: "Waffen", role: "weapon", sections: [{ label: "Scharfschützengewehr", state: "some", not_in: [], banned: [], entries: [
    { name: "Falke 50", image_url: null, not_in: [], attachments: { count: 5, banned: ["Optik A", "Optik B", "Lauf A"], only_allowed: true, groups: [
      { label: "Optik", not_in: [], banned: ["Optik A", "Optik B"], entries: [{ name: "Optik C", image_url: null, not_in: [] }] },
      { label: "Lauf", not_in: [], banned: ["Lauf A"], entries: [] },
      { label: "Mündung", not_in: [], banned: [], entries: [{ name: "Mündung A", image_url: null, not_in: ["Suchen"] }] }] } },
    { name: "Habicht 7", image_url: null, not_in: [], attachments: { count: 1, banned: ["Lauf A"], only_allowed: true, groups: [
      { label: "Lauf", not_in: [], banned: ["Lauf A"], entries: [] }] } },
  ] }] },
] };

test("layout 5: Slots ohne erlaubten Aufsatz fallen im Kasten weg, ohne erlaubten „Keine Aufsätze erlaubt“", async () => {
  const user = userEvent.setup();
  render(<AllowedEquipmentView data={TABLE} />);
  const [falke, habicht] = screen.getAllByTestId("allowed-weapon-toggle");
  expect(within(falke).getByTestId("allowed-weapon-summary")).toHaveTextContent("5 Aufsätze · 3 gesperrt");
  await user.click(falke);
  const panel = screen.getByTestId("allowed-attachments");
  expect(within(panel).getAllByTestId("allowed-slot").map((slot) => slot.querySelector("p").textContent)).toEqual(["Optik", "Mündung"]);
  expect(within(panel).getByTestId("allowed-attachments-banned")).toHaveTextContent("Gesperrt: Optik A, Optik B, Lauf A");
  expect(within(panel).queryByText("nur erlaubt", { exact: false })).toBeNull();
  await user.click(falke);
  await user.click(habicht);
  expect(within(screen.getByTestId("allowed-attachments")).getByText("Keine Aufsätze erlaubt.")).toBeInTheDocument();
  expect(within(screen.getByTestId("allowed-attachments")).queryAllByTestId("allowed-slot")).toHaveLength(0);
});

test("ohne Sperrliste: alles erlaubt, „Alle erlaubt“ an der Klasse", () => {
  render(<AllowedEquipmentView data={{ list: false, layout: 3, categories: [{ label: "Waffen", sections: [
    { label: "Schrotflinte", state: "all", not_in: [], banned: [], entries: [{ name: "Hagel", image_url: null, not_in: [], not_at: [] }] }] }] }} />);
  expect(screen.getByTestId("allowed-equipment-intro")).toHaveTextContent("nichts gesperrt");
  expect(screen.getByTestId("allowed-all")).toHaveTextContent("Alle erlaubt");
});
