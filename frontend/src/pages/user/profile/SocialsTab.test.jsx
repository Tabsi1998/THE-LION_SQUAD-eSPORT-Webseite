import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SocialsTab } from "./SocialsTab";

// Konten verknüpfen (#521): je verknüpfbarer Plattform eine Zeile mit dem offiziellen Knopf; verknüpft
// steht der Name mit Häkchen, das Textfeld ist weg, nur „Verknüpfung lösen“ bleibt. Getippt wird nur, was
// sich nicht verknüpfen lässt oder was die Website noch nicht eingerichtet hat.

const LINKS = {
  links: [{ platform: "discord", handle: "paula", display_name: "Paula B.", linked_at: "2026-09-22T20:00:00Z", url: "https://discord.com/users/123" }],
  available: { discord: true, twitch: true, steam: true, riot: false },
  platforms: { discord: { delivers: "Discord-Kennung und Nutzername" }, twitch: { delivers: "Twitch-Kennung, Login und Anzeigename" }, steam: { delivers: "SteamID64" } },
};

function renderTab(overrides = {}) {
  const props = { form: { discord_name: "paula", twitch_handle: "", steam_id: "", riot_id: "Paula#EUW", psn_id: "" }, set: vi.fn(), links: LINKS, onLink: vi.fn(), onUnlink: vi.fn(), ...overrides };
  render(<MemoryRouter><SocialsTab {...props} /></MemoryRouter>);
  return props;
}

test("verknüpft: Name mit Häkchen, kein Textfeld, Verknüpfung lösen; unverknüpft: der offizielle Knopf in Plattformfarbe", async () => {
  const user = userEvent.setup();
  const props = renderTab();
  expect(screen.queryByTestId("profile-discord")).toBeNull();
  expect(screen.getByTestId("profile-discord-verified")).toHaveTextContent("verifiziert");
  expect(screen.getByTestId("profile-discord-linked-since")).toHaveTextContent("verknüpft als Paula B. · seit 22.09.2026");
  expect(screen.getByTestId("profile-discord-official")).toHaveAttribute("href", "https://discord.com/users/123");
  expect(screen.queryByTestId("profile-discord-link")).toBeNull();
  await user.click(screen.getByTestId("profile-discord-unlink"));
  expect(props.onUnlink).toHaveBeenCalledWith("discord");

  const twitch = screen.getByTestId("profile-twitch-link");
  expect(twitch).toHaveTextContent("Mit Twitch verknüpfen");
  expect(twitch.style.backgroundColor).toBe("rgb(145, 70, 255)");
  expect(screen.queryByTestId("profile-twitch")).toBeNull();
  expect(screen.getByTestId("profile-steam-link")).toHaveTextContent("Mit Steam anmelden");
  await user.click(screen.getByTestId("profile-steam-link"));
  expect(props.onLink).toHaveBeenCalledWith("steam");
});

test("nicht eingerichtet: Feld von Hand mit Hinweis; ohne Anmeldung: Textfeld mit Grund; Privatsphäre-Link", async () => {
  const user = userEvent.setup();
  const props = renderTab();
  expect(screen.getByTestId("profile-riot-not-available")).toHaveTextContent("noch nicht eingerichtet");
  expect(screen.getByTestId("profile-riot")).toHaveValue("Paula#EUW");
  expect(screen.queryByTestId("profile-riot-link")).toBeNull();
  expect(screen.getByTestId("profile-psn-not-linkable")).toHaveTextContent("PlayStation bietet keine Anmeldung");
  await user.type(screen.getByTestId("profile-psn"), "p");
  expect(props.set).toHaveBeenCalledWith("psn_id", "p");
  expect(screen.getByTestId("profile-links-hint")).toHaveTextContent("Discord-Kennung und Nutzername; Twitch-Kennung, Login und Anzeigename; SteamID64");
  expect(screen.getByTestId("profile-links-privacy")).toHaveAttribute("href", "/profile?tab=privacy");
});

// „Gerade in Steam“ (#584): der Schalter nur mit verknüpftem Steam-Konto; er meldet den Wert nach oben.
test("Steam-Status-Schalter nur mit verknüpftem Steam-Konto", async () => {
  const user = userEvent.setup();
  expect(renderTab() && screen.queryByTestId("profile-steam-status-row")).toBeNull();
  const links = { ...LINKS, links: [...LINKS.links, { platform: "steam", handle: "76561198000000001", display_name: "76561198000000001", linked_at: "2026-09-22T20:00:00Z" }] };
  const props = renderTab({ links, form: { discord_name: "paula", twitch_handle: "", steam_id: "", riot_id: "", psn_id: "", show_steam_status: false } });
  expect(screen.getByTestId("profile-steam-status-row")).toHaveTextContent("nie im Discord");
  await user.click(screen.getByTestId("profile-steam-status"));
  expect(props.set).toHaveBeenCalledWith("show_steam_status", true);
});

test("ohne geladene Verknüpfungen: alles von Hand, kein Knopf", () => {
  renderTab({ links: null });
  expect(screen.getByTestId("profile-discord")).toHaveValue("paula");
  expect(screen.queryByTestId("profile-discord-verified")).toBeNull();
  expect(screen.queryByTestId("profile-discord-link")).toBeNull();
});

// Abgehakt vom Verein (#558): weder Zeile noch Textfeld - die Plattform erscheint nirgends.
test("abgehakte Plattformen fehlen: keine Zeile, kein Textfeld", () => {
  renderTab({ links: { ...LINKS, disabled: ["twitch", "psn"] }, form: { discord_name: "paula", steam_id: "", psn_id: "Paula998", nintendo_fc: "" } });
  expect(screen.queryByTestId("profile-twitch-row")).toBeNull();
  expect(screen.queryByTestId("profile-twitch-link")).toBeNull();
  expect(screen.queryByTestId("profile-psn")).toBeNull();
  expect(screen.getByTestId("profile-steam-row")).toBeInTheDocument();
  expect(screen.getByTestId("profile-nintendo")).toBeInTheDocument();
});

// Mastodon/Bluesky (#547 Welle 3): erst Instanz bzw. Handle, dann der Knopf - Mastodon ohne Instanz bleibt gesperrt.
test("Plattformen mit Eingabe: Instanz oder Handle vor dem Start, der Wert geht mit", async () => {
  const user = userEvent.setup();
  const links = {
    ...LINKS,
    available: { ...LINKS.available, mastodon: true, bluesky: true },
    platforms: { ...LINKS.platforms, mastodon: { delivers: "Kennung", input: { label: "Instanz", placeholder: "z. B. mastodon.social", required: true } }, bluesky: { delivers: "DID", input: { label: "Handle (optional)", placeholder: "name.bsky.social", required: false } } },
  };
  const props = renderTab({ links, form: { discord_name: "paula", mastodon_handle: "", bluesky_handle: "" } });
  expect(screen.getByTestId("profile-mastodon-link")).toBeDisabled();
  await user.type(screen.getByTestId("profile-mastodon-input"), "mastodon.social");
  await user.click(screen.getByTestId("profile-mastodon-link"));
  expect(props.onLink).toHaveBeenCalledWith("mastodon", "mastodon.social");
  expect(screen.getByTestId("profile-bluesky-link")).toBeEnabled();
  await user.click(screen.getByTestId("profile-bluesky-link"));
  expect(props.onLink).toHaveBeenCalledWith("bluesky", "");
});
