import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// Profil in der App (#1193): Turnierweg zum Aufklappen (eigenes Profil mit „Bild teilen“) und die Bilanz gegen Gegner.

const mockGet = jest.fn();
const mockShareImage = jest.fn();
jest.mock("../../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) }, resolveMediaUrl: (v?: string | null) => v || "" }));
jest.mock("../../../lib/resultShare", () => ({
  ...jest.requireActual("../../../lib/resultShare"),
  shareResultImage: (...args: unknown[]) => mockShareImage(...args),
  shareResultLink: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RecordCard, ReferenceWithPath, recordLabel, stepLine } = require("./TournamentPath");

const ITEM = { id: "tournament:t-old", kind: "tournament", title: "FC 26 Cup", target_id: "fc-26-cup", rank: 2, date: "2026-10-17T13:00:00Z", status: "results_published" };
const PATH = {
  steps: [
    { kind: "duel", label: "Viertelfinale", result: "2:0", outcome: "win", opponent: "Blitzbirne" },
    { kind: "duel", label: "Halbfinale", result: "2:1", outcome: "win", opponent: null },
    { kind: "duel", label: "Finale", result: "1:2", outcome: "loss", opponent: "TurboTina" },
  ],
  final: { rank: 2, participant_count: 8 }, team_name: null, date: "2026-10-17T13:00:00Z",
  share: { shareable: true, path: "/tournaments/fc-26-cup/ergebnis/neonfalke", image_paths: { story: "/s.png", wide: "/w.png" }, headline: "Platz 2 im FC 26 Cup" },
};

beforeEach(() => {
  mockGet.mockReset();
  mockShareImage.mockReset();
});

test("eigenes Profil: aufklappen lädt den Weg, zeigt Runden und Endplatz und teilt das Bild", async () => {
  mockGet.mockResolvedValue({ data: PATH });
  await render(<ReferenceWithPath item={ITEM} username="neonfalke" own />);
  expect(mockGet).not.toHaveBeenCalled();
  expect(screen.getByTestId("reference-path-toggle-tournament:t-old")).toHaveTextContent("Dein Weg");
  await fireEvent.press(screen.getByTestId("reference-path-toggle-tournament:t-old"));
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/profile/neonfalke/tournaments/fc-26-cup/path", undefined));
  expect(await screen.findAllByTestId("tournament-path-step")).toHaveLength(3);
  expect(screen.getByText("Viertelfinale")).toBeTruthy();
  expect(screen.getByTestId("tournament-path-final")).toHaveTextContent("2. Platz von 8", { exact: false });
  mockShareImage.mockResolvedValue("shared");
  await fireEvent.press(screen.getByTestId("reference-share-image-tournament:t-old"));
  await waitFor(() => expect(mockShareImage).toHaveBeenCalledWith(PATH.share));
  // Zuklappen und wieder auf: kein zweites Laden.
  await fireEvent.press(screen.getByTestId("reference-path-toggle-tournament:t-old"));
  expect(screen.queryByTestId("tournament-path-tournament:t-old")).toBeNull();
  await fireEvent.press(screen.getByTestId("reference-path-toggle-tournament:t-old"));
  expect(mockGet).toHaveBeenCalledTimes(1);
});

test("fremdes Profil: öffentliche Sicht ohne Teilen; Fast Laps klappen nicht auf", async () => {
  mockGet.mockResolvedValue({ data: { ...PATH, share: null } });
  const first = await render(<ReferenceWithPath item={ITEM} username="neonfalke" publicView />);
  await fireEvent.press(screen.getByTestId("reference-path-toggle-tournament:t-old"));
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/profile/neonfalke/tournaments/fc-26-cup/path", { params: { view_as: "public" } }));
  await screen.findAllByTestId("tournament-path-step");
  expect(screen.queryByTestId("reference-share-image-tournament:t-old")).toBeNull();
  await first.unmount();
  await render(<ReferenceWithPath item={{ ...ITEM, kind: "fastlap" }} username="neonfalke" />);
  expect(screen.queryByTestId("reference-path-toggle-tournament:t-old")).toBeNull();
});

test("Bilanz gegen: Siege in Cyan, Niederlagen grau, Tippen öffnet Profil bzw. Team", async () => {
  mockGet.mockResolvedValue({ data: { opponents: [
    { key: "user:u-pp", kind: "user", name: "PixelPanther", username: "pixelpanther", wins: 3, losses: 1, draws: 0, games: 4 },
    { key: "user:u-tt", kind: "user", name: "TurboTina", username: null, wins: 1, losses: 2, draws: 1, games: 4 },
    { key: "team:t-pxp", kind: "team", name: "Pixelpiraten", tag: "PXP", team_id: "t-pxp", wins: 2, losses: 0, draws: 0, games: 2 },
  ] } });
  const onOpenUser = jest.fn();
  const onOpenTeam = jest.fn();
  await render(<RecordCard username="neonfalke" onOpenUser={onOpenUser} onOpenTeam={onOpenTeam} />);
  expect(await screen.findByTestId("profile-record")).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith("/profile/neonfalke/record", undefined);
  expect(screen.getByTestId("profile-record-user:u-pp").props.accessibilityLabel).toBe("gegen PixelPanther: 3 Siege, 1 Niederlage");
  await fireEvent.press(screen.getByTestId("profile-record-user:u-pp"));
  expect(onOpenUser).toHaveBeenCalledWith("pixelpanther");
  await fireEvent.press(screen.getByTestId("profile-record-team:t-pxp"));
  expect(onOpenTeam).toHaveBeenCalledWith("t-pxp");
  await fireEvent.press(screen.getByTestId("profile-record-user:u-tt"));
  expect(onOpenUser).toHaveBeenCalledTimes(1);
});

test("ohne Gegner keine Karte; Sätze für Freilos und Bilanz", async () => {
  mockGet.mockResolvedValue({ data: { opponents: [] } });
  await render(<RecordCard username="neonfalke" publicView />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/profile/neonfalke/record", { params: { view_as: "public" } }));
  expect(screen.queryByTestId("profile-record")).toBeNull();
  expect(stepLine({ kind: "duel", label: "Runde 1", result: "", opponent: "Freilos" })).toBe("weiter · Freilos");
  expect(recordLabel({ key: "x", kind: "user", name: "X", wins: 1, losses: 0, draws: 2 })).toBe("gegen X: 1 Sieg, 2 Unentschieden, 0 Niederlagen");
});
