import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberFileAccounts, accountLine } from "./MemberFileAccounts";

// Konten in der Mitgliederakte (#846) in der App - wie im Web: Schalter nur für geprüfte Konten, der Wunsch des Vereins
// führt zum Verknüpfen im Profil, ohne Fähigkeit der Grund, ohne Verbindung nichts.

const mockGet = jest.fn();
const mockPut = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), put: (...args: unknown[]) => mockPut(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));

const DISCORD = { network: "discord", platform: "discord", label: "Discord", asked: "required", asked_label: "Der Verein wünscht",
  in_file: { handle: "", confirmed: false, client: "", confirmed_at: "" }, website: { linked: true, handle: "paula" }, shared: false, can_share: true };
const STEAM = { network: "steam", platform: "steam", label: "Steam", asked: "optional", asked_label: "Der Verein freut sich über",
  in_file: { handle: "", confirmed: false, client: "", confirmed_at: "" }, website: { linked: false, handle: "" }, shared: false, can_share: false };

beforeEach(() => {
  jest.clearAllMocks();
});

test("Zustand in Worten wie im Web", () => {
  expect(accountLine(DISCORD)).toBe("Auf der Website verknüpft: paula – noch nicht in der Akte");
  expect(accountLine({ ...DISCORD, shared: true, in_file: { ...DISCORD.in_file, handle: "paula", confirmed: true } })).toBe("In der Akte: paula – bestätigt durch die Website");
});

test("Schalter nur für geprüfte Konten; an schickt den Wunsch", async () => {
  mockGet.mockResolvedValue({ data: { available: true, accounts: [DISCORD, STEAM], wishes: [] } });
  mockPut.mockResolvedValue({ data: { available: true, accounts: [{ ...DISCORD, shared: true, in_file: { ...DISCORD.in_file, handle: "paula", confirmed: true } }, STEAM], wishes: [] } });
  await render(<MemberFileAccounts onLink={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("membership-accounts-discord-switch")).toBeTruthy());
  expect(screen.getByTestId("membership-accounts-steam-switch").props.disabled).toBe(true);
  await fireEvent(screen.getByTestId("membership-accounts-discord-switch"), "valueChange", true);
  await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/membership/me/accounts/discord", { share: true }));
  await waitFor(() => expect(screen.getByText("In der Akte: paula – bestätigt durch die Website")).toBeTruthy());
});

test("der Wunsch des Vereins führt zum Verknüpfen; ohne Fähigkeit der Grund; ohne Verbindung nichts", async () => {
  const onLink = jest.fn();
  mockGet.mockResolvedValue({ data: { available: true, accounts: [], wishes: [{ network: "discord", platform: "discord", label: "Discord", asked: "required" }] } });
  const first = await render(<MemberFileAccounts onLink={onLink} />);
  await waitFor(() => expect(screen.getByTestId("membership-accounts-wish-discord")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("membership-accounts-link-discord"));
  expect(onLink).toHaveBeenCalledWith("discord");
  await first.unmount();

  mockGet.mockResolvedValue({ data: { available: false, reason: "no_capability", text: "Der Vorstand schaltet die Fähigkeit „Konten“ ein." } });
  const second = await render(<MemberFileAccounts onLink={onLink} />);
  await waitFor(() => expect(screen.getByTestId("membership-accounts-reason")).toBeTruthy());
  await second.unmount();

  mockGet.mockResolvedValue({ data: { available: false, reason: "not_bound", text: "Erst verbinden." } });
  await render(<MemberFileAccounts onLink={onLink} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
  expect(screen.queryByTestId("membership-accounts")).toBeNull();
});
