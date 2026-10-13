import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { GalleryAlbumScreen } from "./GalleryAlbumScreen";

// Album je Kennung (#1000): ein anderes Album zeigt nie das vorige, ein gescheitertes Nachladen lässt die Bilder stehen und
// sagt, dass es der letzte Stand ist.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  resolveMediaUrl: (value: string) => value,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/PhotoSubmitCard", () => ({ PhotoSubmitCard: () => null }));

const setOptions = jest.fn();
const navigation = { navigate: jest.fn(), setOptions } as never;
const routeFor = (id: string) => ({ key: "album", name: "GalleryAlbum", params: { id } }) as never;
const album = (id: string, title: string) => ({ id, slug: id, title, photos: [{ id: `${id}-1`, url: "/x.jpg", media_type: "image" }] });
const notFound = () => Object.assign(new Error("Nicht sichtbar."), { isAxiosError: true, response: { status: 404, data: {} } });

beforeEach(() => jest.clearAllMocks());

test("Album A → Album B mit 404: kein Bild und kein Titel von A unter B", async () => {
  mockGet.mockImplementation((path: string) => (path === "/gallery/b" ? Promise.reject(notFound()) : Promise.resolve({ data: album("a", "Sommerfest") })));
  const view = await render(<GalleryAlbumScreen navigation={navigation} route={routeFor("a")} />);
  await waitFor(() => expect(screen.getByText("Sommerfest")).toBeTruthy());
  expect(screen.getByTestId("gallery-item-a-1")).toBeTruthy();
  expect(setOptions).toHaveBeenLastCalledWith({ title: "Sommerfest" });
  await view.rerender(<GalleryAlbumScreen navigation={navigation} route={routeFor("b")} />);
  await waitFor(() => expect(screen.getByText("Album nicht gefunden")).toBeTruthy());
  expect(screen.queryByText("Sommerfest")).toBeNull();
  expect(screen.queryByTestId("gallery-item-a-1")).toBeNull();
});

test("Nachladen ohne Netz: die Bilder bleiben, als letzter Stand gekennzeichnet", async () => {
  mockGet.mockResolvedValue({ data: album("a", "Sommerfest") });
  await render(<GalleryAlbumScreen navigation={navigation} route={routeFor("a")} />);
  await waitFor(() => expect(screen.getByTestId("gallery-item-a-1")).toBeTruthy());
  mockGet.mockRejectedValue(Object.assign(new Error("Network Error"), { isAxiosError: true }));
  const [scroll] = screen.container.queryAll((node) => Boolean(node.props.refreshControl));
  await act(async () => {
    await scroll.props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(screen.getByTestId("album-stale")).toBeTruthy());
  expect(screen.getByTestId("gallery-item-a-1")).toBeTruthy();
});
