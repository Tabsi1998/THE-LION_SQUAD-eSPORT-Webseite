import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Konten einmal sauber (#527): ein Kasten, zwei Gruppen (Socials, Spielkonten), jedes Konto genau einmal.
// Ein bestätigtes Konto ersetzt den getippten Namen derselben Plattform; Haken, Farbe und Link je Zeile.

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() }, formatRequestError: (e, f) => f, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ consent: {}, allow: () => {} }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AccountsCard, accountGroups } = await import("./PublicProfilePage");

const PROFILE = {
  discord_name: "paula#0001", youtube_handle: "@paula", psn_id: "paula_psn", steam_id: "76561198000000001", website: "https://paula.example/",
  verified_platforms: ["discord", "steam"],
  linked_accounts: [
    { platform: "discord", label: "Discord", handle: "paula", display_name: "Paula B.", linked_at: "2026-09-22T20:00:00Z", url: "https://discord.com/users/123" },
    { platform: "steam", label: "Steam", handle: "76561198000000001", display_name: "76561198000000001", linked_at: "2026-09-23T20:00:00Z", url: "https://steamcommunity.com/profiles/76561198000000001" },
  ],
  socials: [{ platform: "Discord", value: "paula#0001" }, { platform: "Mastodon", value: "https://mastodon.example/@paula" }],
};

test("accountGroups: verknüpft schlägt getippt, Socials und Spielkonten getrennt, Zähler nur für bestätigte", () => {
  const groups = accountGroups(PROFILE);
  // Mastodon ist seit Welle 3 (#547) eine bekannte Plattform - der eigene Eintrag bekommt ihren Schlüssel statt „website“.
  expect(groups.socials.map((e) => e.key)).toEqual(["discord", "youtube", "website", "mastodon"]);
  expect(groups.socials[0]).toMatchObject({ title: "Paula B.", detail: "Discord · paula · seit 22.09.2026", verified: true, url: "https://discord.com/users/123" });
  expect(groups.socials[1]).toMatchObject({ title: "paula", detail: "YouTube", verified: false, url: "https://www.youtube.com/@paula" });
  expect(groups.socials[2]).toMatchObject({ title: "paula.example", url: "https://paula.example/" });
  expect(groups.socials[3]).toMatchObject({ label: "Mastodon", url: "https://mastodon.example/@paula" });
  expect(groups.games.map((e) => e.key)).toEqual(["steam", "psn"]);
  expect(groups.games[0]).toMatchObject({ title: "Steam-Profil", detail: "Steam · 76561198000000001 · seit 23.09.2026", verified: true });
  expect(groups.games[1]).toMatchObject({ title: "paula_psn", label: "PlayStation", url: "", verified: false });
  expect(groups.verifiedCount).toBe(2);
  expect(accountGroups(null)).toEqual({ socials: [], games: [], verifiedCount: 0 });
});

test("Konten-Kasten: eine Zeile je Konto mit Farbe, Haken, Link oder Kopieren", () => {
  render(<MemoryRouter><AccountsCard groups={accountGroups(PROFILE)} /></MemoryRouter>);
  const box = screen.getByTestId("public-profile-accounts");
  expect(box).toHaveTextContent("Konten");
  expect(screen.getByTestId("public-profile-socials")).toHaveTextContent("Socials");
  expect(screen.getByTestId("public-profile-gaming-ids")).toHaveTextContent("Spielkonten");
  const discord = screen.getByTestId("profile-account-discord");
  expect(discord).toHaveAttribute("href", "https://discord.com/users/123");
  expect(discord).toHaveTextContent("Paula B.");
  expect(discord).toHaveTextContent("Discord · paula · seit 22.09.2026");
  expect(discord.style.getPropertyValue("--social-color")).toBe("#5865F2");
  expect(screen.getByTestId("profile-account-discord-verified")).toBeInTheDocument();
  expect(box).not.toHaveTextContent("paula#0001"); // der getippte Discord-Name weicht dem bestätigten Konto
  const steam = screen.getByTestId("profile-account-steam");
  expect(steam).toHaveTextContent("Steam-Profil");
  expect(steam).not.toHaveTextContent("76561198000000001 · 76561198000000001");
  expect(steam.style.getPropertyValue("--social-color")).toBe("#66C0F4");
  const psn = screen.getByTestId("profile-account-psn");
  expect(psn.tagName).toBe("BUTTON");
  expect(psn).toHaveTextContent("paula_psn");
  expect(screen.queryByTestId("profile-account-psn-verified")).toBeNull();
});
