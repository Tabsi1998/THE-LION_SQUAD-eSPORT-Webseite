import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Discord-Server je Spiel (#626): Kachel mit Name, Symbol, Mitgliedern und Einladung; „Du bist dabei“ nur mit
// bestätigtem Status; ohne Verknüpfung nur die Einladung und ein Hinweis; ausgeschaltete Server gibt es hier nie.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { DiscordServerList, DiscordServerTile, GameDiscordTile, memberCountText, tileTitle } = await import("./DiscordServerTile");

const RL = { available: true, guild_id: "2", name: "Rocket League", icon_url: null, member_count: 1234, invite_url: "https://discord.gg/rocket", main: false, for_game: true };
const MAIN = { available: true, guild_id: "1", name: "LION", icon_url: "https://cdn.discordapp.com/icons/1/a.png", member_count: 1, invite_url: "https://discord.gg/lion", main: true, for_game: false };

test("Texte", () => {
  expect(memberCountText(0)).toBe("");
  expect(memberCountText(1)).toBe("1 Mitglied");
  expect(memberCountText(1234)).toMatch(/^1.234 Mitglieder$/);
  expect(tileTitle(RL, "Rocket League")).toBe("Discord-Server für Rocket League");
  expect(tileTitle(MAIN, "Schach")).toBe("Unser Discord-Server");
});

test("Kachel: Einladung für alle, „Du bist dabei“ nur mit bestätigtem Status", () => {
  const { rerender, container } = render(<DiscordServerTile server={{ available: false }} title="x" />);
  expect(container).toBeEmptyDOMElement();

  rerender(<DiscordServerTile server={RL} title="Discord-Server für Rocket League" />);
  expect(screen.getByTestId("discord-server-tile")).toHaveTextContent("Discord-Server für Rocket League");
  expect(screen.getByTestId("discord-server-tile")).toHaveTextContent("Mitglieder");
  const join = screen.getByTestId("discord-server-tile-join");
  expect(join).toHaveAttribute("href", "https://discord.gg/rocket");
  expect(join).toHaveAttribute("target", "_blank");
  expect(join.getAttribute("rel")).toContain("noopener");

  rerender(<DiscordServerTile server={{ ...RL, member: null }} title="t" />);
  expect(screen.getByTestId("discord-server-tile-join")).toBeInTheDocument();
  rerender(<DiscordServerTile server={{ ...RL, member: true }} title="t" />);
  expect(screen.getByTestId("discord-server-tile-joined")).toHaveTextContent("Du bist dabei");
  expect(screen.queryByTestId("discord-server-tile-join")).toBeNull();
});

test("Turnierseite: die Kachel holt den Server des Spiels", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { ...RL, linked: true, member: false } });
  render(<GameDiscordTile gameId="g1" gameName="Rocket League" />);
  expect(await screen.findByTestId("game-discord-tile")).toHaveTextContent("Discord-Server für Rocket League");
  expect(apiMock.get).toHaveBeenCalledWith("/games/g1/discord");
  expect(screen.getByTestId("game-discord-tile-join")).toBeInTheDocument();
});

test("Turnierseite ohne Server oder bei Fehler: keine Kachel", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { available: false } });
  const { container } = render(<GameDiscordTile gameId="g2" gameName="Schach" />);
  await Promise.resolve();
  expect(container).toBeEmptyDOMElement();
  apiMock.get.mockRejectedValueOnce(new Error("offline"));
  const second = render(<GameDiscordTile gameId="g3" gameName="Tetris" />);
  await Promise.resolve();
  expect(second.container).toBeEmptyDOMElement();
});

test("Mitgliederbereich: alle Server mit eigenem Status; ohne Verknüpfung nur Einladungen und der Hinweis", () => {
  const { rerender } = render(
    <MemoryRouter><DiscordServerList data={{ linked: true, servers: [{ ...MAIN, member: true }, { ...RL, member: false }] }} /></MemoryRouter>,
  );
  expect(screen.getByTestId("discord-servers-1")).toHaveTextContent("Hauptserver");
  expect(screen.getByTestId("discord-servers-1-joined")).toHaveTextContent("Du bist dabei");
  expect(screen.getByTestId("discord-servers-2-join")).toHaveAttribute("href", "https://discord.gg/rocket");
  expect(screen.queryByTestId("discord-servers-link-hint")).toBeNull();

  rerender(<MemoryRouter><DiscordServerList data={{ linked: false, servers: [{ ...MAIN, member: null }, { ...RL, member: null }] }} /></MemoryRouter>);
  expect(screen.queryByTestId("discord-servers-1-joined")).toBeNull();
  expect(screen.getByTestId("discord-servers-1-join")).toBeInTheDocument();
  expect(screen.getByTestId("discord-servers-link-hint").querySelector("a")).toHaveAttribute("href", "/profile?tab=socials");

  rerender(<MemoryRouter><DiscordServerList data={{ linked: true, servers: [] }} /></MemoryRouter>);
  expect(screen.queryByTestId("discord-servers")).toBeNull();
});
