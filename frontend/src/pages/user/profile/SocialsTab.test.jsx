import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SocialsTab } from "./SocialsTab";

// Konten verknüpfen (#260): ein verknüpftes Feld ist gesperrt und trägt „verifiziert“, „Trennen“
// ruft die Plattform; ein unverknüpftes bietet „Verknüpfen“ - gesperrt, wenn die Website die
// Plattform nicht eingerichtet hat. Der Hinweis nennt, was die Plattform liefert.

const LINKS = {
  links: [{ platform: "discord", handle: "paula", display_name: "Paula B.", linked_at: "2026-09-22T20:00:00Z" }],
  available: { discord: true, twitch: false, steam: true },
  platforms: { discord: { delivers: "Discord-Kennung und Nutzername" }, twitch: { delivers: "Twitch-Kennung, Login und Anzeigename" }, steam: { delivers: "SteamID64" } },
};

function renderTab(overrides = {}) {
  const props = { form: { discord_name: "paula", twitch_handle: "", steam_id: "" }, set: vi.fn(), links: LINKS, onLink: vi.fn(), onUnlink: vi.fn(), ...overrides };
  render(<SocialsTab {...props} />);
  return props;
}

test("verknüpft: Feld gesperrt, verifiziert, Trennen; unverknüpft: Verknüpfen je nach Einrichtung", async () => {
  const user = userEvent.setup();
  const props = renderTab();
  expect(screen.getByTestId("profile-discord")).toBeDisabled();
  expect(screen.getByTestId("profile-discord-verified")).toHaveTextContent("verifiziert");
  await user.click(screen.getByTestId("profile-discord-unlink"));
  expect(props.onUnlink).toHaveBeenCalledWith("discord");

  expect(screen.getByTestId("profile-twitch")).toBeEnabled();
  expect(screen.getByTestId("profile-twitch-link")).toBeDisabled();
  expect(screen.getByTestId("profile-steam-link")).toBeEnabled();
  await user.click(screen.getByTestId("profile-steam-link"));
  expect(props.onLink).toHaveBeenCalledWith("steam");
  expect(screen.queryByTestId("profile-epic-link")).not.toBeInTheDocument();
  expect(screen.getByTestId("profile-links-hint")).toHaveTextContent("Discord-Kennung und Nutzername; Twitch-Kennung, Login und Anzeigename; SteamID64");
});

test("ohne geladene Verknüpfungen bleibt alles wie bisher tippbar", () => {
  renderTab({ links: null });
  expect(screen.getByTestId("profile-discord")).toBeEnabled();
  expect(screen.queryByTestId("profile-discord-verified")).not.toBeInTheDocument();
  expect(screen.getByTestId("profile-discord-link")).toBeDisabled();
});
