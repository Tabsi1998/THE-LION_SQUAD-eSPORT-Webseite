import { render, screen } from "@testing-library/react";
import { DiscordPulse, DiscordVoice, discordSummary } from "./DiscordNow";

// Discord auf der Website (#581): nur Zahlen - die Leiste auf der Startseite und „Discord jetzt“ im
// Mitgliederbereich; ohne Widget nichts.

test("die Summe in Worten", () => {
  expect(discordSummary({ available: true, online: 42, in_voice: 5 })).toBe("42 online · 5 im Voice");
  expect(discordSummary({ available: true, online: 3, in_voice: 0 })).toBe("3 online");
  expect(discordSummary({ available: false })).toBe("");
});

test("Startseite: Leiste mit Zahlen und „Beitreten“ - ohne Widget gar nichts", () => {
  const { rerender } = render(<DiscordPulse discord={{ available: true, online: 42, in_voice: 5, invite: "https://discord.gg/lions" }} />);
  expect(screen.getByTestId("home-discord-summary")).toHaveTextContent("42 online · 5 im Voice");
  expect(screen.getByTestId("home-discord-join")).toHaveAttribute("href", "https://discord.gg/lions");
  rerender(<DiscordPulse discord={{ available: false }} />);
  expect(screen.queryByTestId("home-discord")).toBeNull();
  rerender(<DiscordPulse discord={undefined} />);
  expect(screen.queryByTestId("home-discord")).toBeNull();
});

test("Mitgliederbereich: je belegtem Sprachkanal Name und Zahl, leer ein ruhiger Satz", () => {
  const { rerender } = render(<DiscordVoice data={{ available: true, online: 42, in_voice: 3, voice: [{ name: "Chillen", count: 1 }, { name: "Turnier-Lobby", count: 2 }] }} />);
  const box = screen.getByTestId("member-area-discord-voice");
  expect(screen.getByTestId("member-area-discord-summary")).toHaveTextContent("42 online · 3 im Voice");
  expect(box).toHaveTextContent("Chillen");
  expect(box).toHaveTextContent("Turnier-Lobby2");
  rerender(<DiscordVoice data={{ available: true, online: 7, in_voice: 0, voice: [] }} />);
  expect(screen.getByTestId("member-area-discord-voice")).toHaveTextContent("Gerade ist niemand in einem Sprachkanal.");
});
