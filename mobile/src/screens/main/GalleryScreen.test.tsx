import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { GalleryScreen } from "./GalleryScreen";
import { GalleryAlbumScreen } from "./GalleryAlbumScreen";

// Galerie (#236): Alben mit Datum und Anzahl, Mitglieder-Alben gekennzeichnet; das Raster öffnet
// die Großansicht an der angetippten Stelle - in Albumreihenfolge über Abschnitte hinweg.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  resolveMediaUrl: (url?: string | null) => (url ? `https://lionsquad.at${url}` : ""),
  responseFromCache: () => false,
}));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => {} }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn(), setOptions: jest.fn() } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test("Alben: Titel, Datum, Anzahl und Kennzeichen; Antippen öffnet das Album", async () => {
  mockGet.mockResolvedValue({ data: [
    { id: "a1", slug: "lan-2026", title: "LAN 2026", cover_url: "/api/static/uploads/lan.webp", taken_at: "2026-09-12T10:00:00Z", visibility: "public", photo_count: 12, video_count: 2 },
    { id: "a2", slug: "intern", title: "Vorstandsklausur", visibility: "members", photo_count: 3, video_count: 0 },
  ] });
  await render(<GalleryScreen navigation={navigation} route={{ key: "g", name: "Gallery" } as never} />);
  await waitFor(() => expect(screen.getByTestId("gallery-album-lan-2026")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/gallery", { params: { compact: true, limit: 80 } });
  expect(screen.getByText(/12 Bilder · 2 Videos/)).toBeTruthy();
  expect(screen.getByText("Nur für Mitglieder")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("gallery-album-lan-2026"));
  expect(navigation.navigate).toHaveBeenCalledWith("GalleryAlbum", { id: "lan-2026" });
});

test("Album: Kacheln je Abschnitt, Antippen öffnet die Großansicht mit dem richtigen Index", async () => {
  mockGet.mockResolvedValue({ data: {
    id: "a1", slug: "lan-2026", title: "LAN 2026", photo_count: 2, video_count: 1,
    sections: [{ id: "s1", title: "Samstag" }],
    photos: [
      { id: "p1", order_index: 1, image_url: "/api/static/uploads/p1.webp" },
      { id: "p2", order_index: 2, section_id: "s1", image_url: "/api/static/uploads/p2.webp" },
      { id: "v1", order_index: 3, section_id: "s1", media_type: "video", video_url: "/api/static/uploads/v1.mp4", thumbnail_url: "/api/static/uploads/v1.jpg" },
    ],
  } });
  await render(<GalleryAlbumScreen navigation={navigation} route={{ key: "al", name: "GalleryAlbum", params: { id: "lan-2026" } } as never} />);
  await waitFor(() => expect(screen.getByTestId("gallery-item-v1")).toBeTruthy());
  expect(screen.getByText("Samstag")).toBeTruthy();
  expect(navigation.setOptions).toHaveBeenCalledWith({ title: "LAN 2026" });
  await fireEvent.press(screen.getByTestId("gallery-item-v1"));
  expect(navigation.navigate).toHaveBeenCalledWith("GalleryViewer", { albumId: "lan-2026", index: 2 });
});
