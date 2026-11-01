import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

// Bildauswahl seitenweise (#2122): „Mehr laden“ holt die nächste Seite, die Suche rechnet der Server.

const { apiMock } = vi.hoisted(() => ({ apiMock: { get: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { mediaPageFrom, mediaPageUrl, useMediaLibrary } = await import("./useMediaLibrary");
const { MediaLibraryMore, MediaLibrarySearch } = await import("@/components/tls/MediaLibraryControls");

function Picker({ open = true }) {
  const library = useMediaLibrary("/admin/media?type=images", open);
  return (
    <div>
      <MediaLibrarySearch library={library} testId="picker" />
      <ul>{library.items.map((item) => <li key={item.filename}>{item.filename}</li>)}</ul>
      <MediaLibraryMore library={library} testId="picker" />
    </div>
  );
}

const page = (names, total) => ({ data: { items: names.map((filename) => ({ filename })), total } });

beforeEach(() => {
  apiMock.get.mockReset();
});

test("die Adresse hängt Seite und Suche an die Filter des Felds an", () => {
  expect(mediaPageUrl("/media?type=images", { offset: 60, q: " löwe " })).toBe("/media?type=images&paged=true&limit=60&offset=60&q=l%C3%B6we");
  expect(mediaPageUrl("/admin/media")).toBe("/admin/media?paged=true&limit=60&offset=0");
});

test("eine Liste ohne Rahmen gilt als vollständig", () => {
  expect(mediaPageFrom([{ filename: "a" }])).toEqual({ items: [{ filename: "a" }], total: 1, totalSize: null });
  expect(mediaPageFrom({ items: [], total: 7, total_size: 9 })).toEqual({ items: [], total: 7, totalSize: 9 });
  expect(mediaPageFrom(null)).toEqual({ items: [], total: 0, totalSize: null });
});

test("Mehr laden hängt die nächste Seite an und verschwindet, wenn alles da ist", async () => {
  apiMock.get.mockImplementation(async (url) => (url.includes("offset=0") ? page(["neu.webp"], 2) : page(["alt.webp"], 2)));
  render(<Picker />);
  expect(await screen.findByText("neu.webp")).toBeInTheDocument();
  expect(screen.getByTestId("picker-count")).toHaveTextContent("1 von 2");

  fireEvent.click(screen.getByTestId("picker-more"));

  expect(await screen.findByText("alt.webp")).toBeInTheDocument();
  expect(screen.getByText("neu.webp")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenLastCalledWith("/admin/media?type=images&paged=true&limit=60&offset=1");
  expect(screen.queryByTestId("picker-more")).toBeNull();
});

test("die Suche fragt den Server und beginnt wieder bei der ersten Seite", async () => {
  apiMock.get.mockImplementation(async (url) => (url.includes("q=uralt") ? page(["uralt.webp"], 1) : page(["neu.webp"], 700)));
  render(<Picker />);
  expect(await screen.findByText("neu.webp")).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("picker-search"), { target: { value: "uralt" } });

  expect(await screen.findByText("uralt.webp")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenLastCalledWith("/admin/media?type=images&paged=true&limit=60&offset=0&q=uralt");
  await waitFor(() => expect(screen.queryByText("neu.webp")).toBeNull());
});

test("geschlossen wird nichts geladen", async () => {
  await act(async () => { render(<Picker open={false} />); });
  expect(apiMock.get).not.toHaveBeenCalled();
});
