import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Galerie (#1079): Öffnen, Weiterblättern, Schließen. Beim Schließen fliegt die Bühne zurück in die Kachel des Bildes,
// das gerade offen ist; danach liegt der Fokus wieder auf dieser Kachel.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/LazyImg", () => ({ LazyImg: ({ src, alt, className }) => <img src={src} alt={alt} className={className} /> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const GalleryAlbumPage = (await import("./GalleryAlbumPage")).default;

const album = {
  id: "al1",
  slug: "lan-2026",
  title: "LAN 2026",
  sections: [],
  photos: [
    { id: "p0", image_url: "/p0.jpg", caption: "Aufbau" },
    { id: "p1", image_url: "/p1.jpg", caption: "Siegerehrung" },
    { id: "p2", image_url: "/p2.jpg", caption: "Abbau" },
  ],
};

function renderAlbum() {
  apiMock.get.mockResolvedValue({ data: album });
  return render(
    <MemoryRouter initialEntries={["/galerie/lan-2026"]}>
      <Routes><Route path="/galerie/:slug" element={<GalleryAlbumPage />} /></Routes>
    </MemoryRouter>,
  );
}

const realAnimate = HTMLElement.prototype.animate;
const realRect = HTMLElement.prototype.getBoundingClientRect;
afterEach(() => {
  HTMLElement.prototype.animate = realAnimate;
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

test("öffnen, weiterblättern, schließen: der Fokus landet auf der Kachel des zuletzt gezeigten Bildes", async () => {
  renderAlbum();
  fireEvent.click(await screen.findByTestId("gallery-photo-1"));
  expect(screen.getByRole("dialog", { name: "Siegerehrung" })).toBeInTheDocument();
  // Der Fokus geht in die Ansicht (Tastatur): auf „Schließen“.
  expect(screen.getByTestId("gallery-lightbox-close")).toHaveFocus();

  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(screen.getByRole("dialog", { name: "Abbau" })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByTestId("gallery-lightbox")).not.toBeInTheDocument();
  expect(screen.getByTestId("gallery-photo-2")).toHaveFocus();
});

test("die Bühne fliegt zurück in die Kachel und schließt erst danach", async () => {
  // Jede Box 100 × 100 an derselben Stelle - es zählt, dass der Rückflug läuft und erst danach geschlossen wird.
  HTMLElement.prototype.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 100, right: 110, bottom: 110 });
  let land;
  const flights = [];
  HTMLElement.prototype.animate = vi.fn(function animate(keyframes, options) {
    const finished = new Promise((resolve) => { land = resolve; });
    const flight = { keyframes, options, finished, cancel: vi.fn() };
    flights.push(flight);
    return flight;
  });
  renderAlbum();
  fireEvent.click(await screen.findByTestId("gallery-photo-0"));
  // Öffnen: aus der Kachel an den Platz.
  expect(flights).toHaveLength(1);
  expect(flights[0].keyframes[1]).toEqual({ transform: "none", opacity: 1 });

  fireEvent.click(screen.getByTestId("gallery-lightbox-close"));
  expect(flights).toHaveLength(2);
  expect(flights[1].keyframes[1].transform).toBe("translate(0px, 0px) scale(1)");
  expect(flights[1].options.fill).toBe("forwards");
  // Während des Rückflugs ist die Ansicht noch da, Hintergrund und Knöpfe blenden aus.
  expect(screen.getByTestId("gallery-lightbox")).toHaveClass("is-leaving");
  // Ein zweiter Klick startet keinen zweiten Flug.
  fireEvent.click(screen.getByTestId("gallery-lightbox-backdrop"));
  expect(flights).toHaveLength(2);

  await act(async () => { land(); await flights[1].finished; });
  expect(screen.queryByTestId("gallery-lightbox")).not.toBeInTheDocument();
  expect(screen.getByTestId("gallery-photo-0")).toHaveFocus();
});

// Leeres Album (#1224): ein direkter Link zeigt „Hier kommen bald Fotos“ statt „0 Medien – Noch keine Medien“.
test("leeres Album: ein freundlicher Satz statt „0 Medien“", async () => {
  apiMock.get.mockResolvedValue({ data: { ...album, photos: [] } });
  render(
    <MemoryRouter initialEntries={["/galerie/lan-2026"]}>
      <Routes><Route path="/galerie/:slug" element={<GalleryAlbumPage />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("album-empty")).toHaveTextContent("Hier kommen bald Fotos.");
  expect(screen.queryByText(/0 Medien/)).toBeNull();
  expect(screen.queryByText("Noch keine Medien.")).toBeNull();
});
