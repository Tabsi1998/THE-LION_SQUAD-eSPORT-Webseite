import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// „Ergebnis teilen“ in der App (#1194): Vorschau, Bild teilen, Link teilen; privates Profil sagt, wo die Privatsphäre liegt;
// ohne Teilnahme bleibt die Karte weg.

const mockGet = jest.fn();
const mockShareImage = jest.fn();
const mockShareLink = jest.fn();
jest.mock("../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) }, resolveMediaUrl: (value?: string | null) => (value ? `https://verein.example${value}` : "") }));
jest.mock("../lib/resultShare", () => ({
  ...jest.requireActual("../lib/resultShare"),
  shareResultImage: (...args: unknown[]) => mockShareImage(...args),
  shareResultLink: (...args: unknown[]) => mockShareLink(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ResultShareCard } = require("./ResultShareCard");

const OPTIONS = {
  shareable: true, path: "/tournaments/fc26-cup/ergebnis/neonfalke",
  image_paths: { story: "/api/share/result/fc26-cup/neonfalke/story.png", wide: "/api/share/result/fc26-cup/neonfalke/wide.png" },
  headline: "Platz 2 im FC 26 Herbst-Cup", share_text: "Ich habe Platz 2 im FC 26 Herbst-Cup geholt – bei THE LION SQUAD.",
};

beforeEach(() => {
  mockGet.mockReset();
  mockShareImage.mockReset();
  mockShareLink.mockReset();
});

test("zeigt das Bild und teilt Bild oder Link", async () => {
  mockGet.mockResolvedValue({ data: OPTIONS });
  mockShareImage.mockResolvedValue("shared");
  mockShareLink.mockResolvedValue("failed");
  await render(<ResultShareCard tournamentId="t1" />);
  expect(await screen.findByTestId("result-share-card")).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith("/share/result-options/t1");
  expect(screen.getByTestId("result-share-preview").props.source).toEqual({ uri: "https://verein.example/api/share/result/fc26-cup/neonfalke/story.png" });
  expect(screen.getByText("Platz 2 im FC 26 Herbst-Cup")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("result-share-image"));
  await waitFor(() => expect(mockShareImage).toHaveBeenCalledWith(OPTIONS));
  await fireEvent.press(screen.getByTestId("result-share-link"));
  await waitFor(() => expect(mockShareLink).toHaveBeenCalledWith(OPTIONS));
  expect(await screen.findByText("Teilen ging gerade nicht – versuch es gleich noch einmal.")).toBeTruthy();
});

test("privates Profil: Satz und wo die Privatsphäre liegt", async () => {
  mockGet.mockResolvedValue({ data: { shareable: false, reason: "private_profile", text: "Dein Profil ist privat." } });
  await render(<ResultShareCard tournamentId="t1" />);
  expect(await screen.findByText("Dein Profil ist privat.")).toBeTruthy();
  expect(screen.getByText("In der App: Profil → Zahnrad → Privatsphäre.")).toBeTruthy();
});

test("ohne Teilnahme oder bei Fehlern bleibt die Karte weg", async () => {
  mockGet.mockResolvedValue({ data: { shareable: false, reason: "not_participant", text: "Du hast nicht mitgespielt." } });
  const first = await render(<ResultShareCard tournamentId="t1" />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("result-share-card")).toBeNull();
  expect(screen.queryByTestId("result-share-hint")).toBeNull();
  await first.unmount();
  mockGet.mockRejectedValue(new Error("offline"));
  await render(<ResultShareCard tournamentId="t2" />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("result-share-card")).toBeNull();
});
