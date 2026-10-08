import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Spiele-Regal (#1333): Wettkampf-Spiele als hohe Karten mit vollem Namen und „3 Turniere“ (Einzahl bei einem), Spaß-Spiele
// als Chips; ein Klick öffnet die Turniere des Spiels; der Discord des Spiels steht unter der Karte, nie darin.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));

const { GamesShelf, gameCode, gameCountLine, splitGames } = await import("./GamesShelf");

const GAMES = [
  { id: "mk", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8-deluxe", short_name: "MK8", cover_url: "/mk.jpg", tournaments: 3, references: 0 },
  { id: "ssb", name: "Super Smash Bros. Ultimate", slug: "super-smash-bros-ultimate", tournaments: 1, references: 0,
    discord: { available: true, guild_id: "g-ssb", name: "Smash", invite_url: "https://discord.example/smash" } },
  { id: "cod", name: "Call of Duty", slug: "call-of-duty", short_name: "COD", tournaments: 0, references: 16 },
  { id: "pal", name: "Palworld", slug: "palworld", tournaments: 0, references: 0 },
];

test("Wettkampf als Regal mit vollem Namen und Einzahl/Mehrzahl, Spaß als Chips", () => {
  render(<MemoryRouter><GamesShelf games={GAMES} testIdPrefix="g" /></MemoryRouter>);
  expect(screen.getByTestId("g-mk")).toHaveTextContent("MK8Mario Kart 8 Deluxe3 Turniere");
  expect(screen.getByTestId("g-ssb")).toHaveTextContent("SSBSuper Smash Bros. Ultimate1 Turnier");
  expect(screen.getByTestId("g-cod")).toHaveTextContent("16 Teilnahmen");
  expect(screen.getByTestId("g-fun")).toHaveTextContent("Nur zum Spaß");
  expect(screen.getByTestId("g-fun")).toContainElement(screen.getByTestId("g-pal"));
  expect(screen.getByTestId("g-competitive").textContent).not.toContain("…");
});

test("ein Klick öffnet die Turniere des Spiels; der Discord steht unter der Karte, kein Knopf darin", () => {
  render(<MemoryRouter><GamesShelf games={GAMES} testIdPrefix="g" joined={{}} /></MemoryRouter>);
  expect(screen.getByTestId("g-mk")).toHaveAttribute("href", "/tournaments?game=mario-kart-8-deluxe");
  const card = screen.getByTestId("g-ssb");
  const discord = screen.getByTestId("g-ssb-discord-join");
  expect(discord).toHaveAttribute("href", "https://discord.example/smash");
  expect(discord).toHaveTextContent("Discord des Spiels");
  expect(card.contains(discord)).toBe(false);
  expect(card.querySelector("a, button")).toBeNull();
});

test("„Du bist dabei“ für den eigenen Server; Hilfsfunktionen", () => {
  render(<MemoryRouter><GamesShelf games={GAMES} testIdPrefix="g" joined={{ "g-ssb": true }} /></MemoryRouter>);
  expect(screen.getByTestId("g-ssb-discord-joined")).toHaveTextContent("Du bist dabei");
  expect(gameCountLine({ tournaments: 1, references: 2 })).toBe("1 Turnier · 2 Teilnahmen");
  expect(gameCode({ name: "Rocket League" })).toBe("RL");
  expect(splitGames(null)).toEqual({ competitive: [], fun: [] });
});
