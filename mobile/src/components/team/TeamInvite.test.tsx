import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TeamInviteCard, TeamJoinInvite } from "./TeamInvite";

// Einladungs-Link (#1191) mit Kennungen aus Adressen (#1512): die Team-Kennung geht nur als ein geprüfter Pfadteil in
// die API. Eine Kennung mit Pfadzeichen fragt nicht und zeigt „gilt nicht mehr“.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("../QrCode", () => ({ QrCode: () => null }));

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

test("Beitreten über den Link: Prüfung und Beitritt mit kodierter Kennung", async () => {
  mockGet.mockResolvedValue({ data: { valid: true, already_member: false, team: { name: "Löwen" } } });
  mockPost.mockResolvedValue({ data: {} });
  const onJoined = jest.fn();
  await render(<TeamJoinInvite teamId="löwen team" token="AbC" signedIn onSignIn={jest.fn()} onJoined={onJoined} />);
  await waitFor(() => expect(screen.getByTestId("team-join-invite-submit")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/teams/l%C3%B6wen%20team/invite-link/check", { params: { token: "AbC" } });
  await fireEvent.press(screen.getByTestId("team-join-invite-submit"));
  await waitFor(() => expect(onJoined).toHaveBeenCalled());
  expect(mockPost).toHaveBeenCalledWith("/teams/l%C3%B6wen%20team/join-link", { token: "AbC" });
});

test("Kennung mit Pfadzeichen: keine Anfrage, der Link gilt nicht", async () => {
  await render(<TeamJoinInvite teamId="..%2Fadmin" token="AbC" signedIn onSignIn={jest.fn()} onJoined={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("team-join-invalid")).toBeTruthy());
  expect(mockGet).not.toHaveBeenCalled();
});

test("Einladungs-Karte: Link mit kodierter Kennung, eine kaputte Kennung fragt nicht", async () => {
  mockGet.mockResolvedValue({ data: { url: "https://lionsquad.at/teams/x?einladung=AbC", token: "AbC" } });
  const view = await render(<TeamInviteCard teamId="löwen team" teamName="Löwen" />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/teams/l%C3%B6wen%20team/invite-link"));
  await view.unmount();

  mockGet.mockClear();
  await render(<TeamInviteCard teamId="a/b" teamName="Löwen" />);
  await waitFor(() => expect(screen.getByText("Der Einladungs-Link konnte nicht geladen werden.")).toBeTruthy());
  expect(mockGet).not.toHaveBeenCalled();
});
