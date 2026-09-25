import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Gerade in Steam“ (#584): Zähler in Worten, wer spielt was, der Weg zum eigenen Opt-in; ohne Schlüssel nichts.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));

const { SteamPresence, steamSummary } = await import("./SteamPresence");

const DATA = {
  available: true, stale: false, online_count: 3, me: { linked: true, opted_in: false },
  players: [
    { user_id: "u1", username: "paula", display_name: "Paula", state: "playing", state_text: "spielt gerade Rocket League", game: "Rocket League", avatar_url: "/a.webp" },
    { user_id: "u2", username: "leon", display_name: "Leon", state: "online", state_text: "abwesend" },
  ],
};

test("Zähler in Worten", () => {
  expect(steamSummary({ online_count: 0 })).toBe("Gerade niemand in Steam.");
  expect(steamSummary({ online_count: 1 })).toBe("Ein Mitglied gerade in Steam");
  expect(steamSummary({ online_count: 3 })).toBe("3 Mitglieder gerade in Steam");
  expect(steamSummary({ stale: true, online_count: 3 })).toContain("veraltet");
});

test("Personen mit Spiel und Profil-Link; ohne eigenes Opt-in der Weg dorthin; ohne Schlüssel nichts", () => {
  const { container } = render(<MemoryRouter><SteamPresence data={DATA} /></MemoryRouter>);
  expect(screen.getByTestId("steam-presence-summary")).toHaveTextContent("3 Mitglieder gerade in Steam");
  expect(screen.getByTestId("steam-presence-u1")).toHaveAttribute("href", "/u/paula");
  expect(screen.getByTestId("steam-presence-u1")).toHaveTextContent("spielt gerade Rocket League");
  expect(screen.getByTestId("steam-presence-u2")).toHaveTextContent("abwesend");
  expect(screen.getByTestId("steam-presence-join")).toHaveTextContent("Profil → Socials");
  expect(container.querySelector("img")).toHaveAttribute("src", "/a.webp");

  render(<MemoryRouter><SteamPresence data={{ ...DATA, me: { linked: true, opted_in: true } }} /></MemoryRouter>);
  expect(screen.getAllByTestId("steam-presence-join")).toHaveLength(1);

  const none = render(<MemoryRouter><SteamPresence data={{ available: false }} /></MemoryRouter>);
  expect(none.container.querySelector("[data-testid='steam-presence']")).toBeNull();
});
