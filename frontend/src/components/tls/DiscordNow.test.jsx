import { render, screen, waitFor } from "@testing-library/react";

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { DiscordLiveLine, DiscordVoice, discordSummary, resetDiscordNow, useDiscordNow } = await import("./DiscordNow");

// Discord auf der Website (#581, #854): nur Zahlen - die Zeile im Block „Dabei sein“ und „Discord jetzt“ im
// Mitgliederbereich; ohne Widget nichts.

test("die Summe in Worten", () => {
  expect(discordSummary({ available: true, online: 42, in_voice: 5 })).toBe("42 online · 5 im Voice");
  expect(discordSummary({ available: true, online: 3, in_voice: 0 })).toBe("3 online");
  expect(discordSummary({ available: false })).toBe("");
});

test("Block „Dabei sein“: die Zeile mit den Zahlen - ohne Widget gar nichts", () => {
  const { rerender } = render(<DiscordLiveLine discord={{ available: true, online: 42, in_voice: 5 }} />);
  expect(screen.getByTestId("footer-discord-live")).toHaveTextContent("42 online · 5 im Voice");
  rerender(<DiscordLiveLine discord={{ available: false }} />);
  expect(screen.queryByTestId("footer-discord-live")).toBeNull();
  rerender(<DiscordLiveLine discord={null} />);
  expect(screen.queryByTestId("footer-discord-live")).toBeNull();
});

function Probe() {
  const discord = useDiscordNow();
  return <span data-testid="probe">{discord?.available ? discordSummary(discord) : "nichts"}</span>;
}

test("einmal geholt und gemerkt - zwei Seiten fragen nicht zweimal; ein Fehler lässt den Block leer", async () => {
  resetDiscordNow();
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: { available: true, online: 33, in_voice: 0 } });
  const first = render(<Probe />);
  await waitFor(() => expect(first.getByTestId("probe")).toHaveTextContent("33 online"));
  first.unmount();
  const second = render(<Probe />);
  expect(second.getByTestId("probe")).toHaveTextContent("33 online");
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  expect(apiMock.get).toHaveBeenCalledWith("/home/discord");
  second.unmount();
  resetDiscordNow();
  apiMock.get.mockRejectedValueOnce(new Error("offline"));
  const third = render(<Probe />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(third.getByTestId("probe")).toHaveTextContent("nichts");
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
