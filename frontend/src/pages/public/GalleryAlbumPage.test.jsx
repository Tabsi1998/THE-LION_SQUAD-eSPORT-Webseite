import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Galerie (#1079): Öffnen, Weiterblättern, Schließen. Beim Schließen fliegt die Bühne zurück in die Kachel des Bildes,
// das gerade offen ist; danach liegt der Fokus wieder auf dieser Kachel.

const apiMock = { get: vi.fn(), post: vi.fn() };
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

// Fotos gehören zum Event (#1185) und Fotos einsenden (#1186).
function renderWith(data) {
  apiMock.get.mockResolvedValue({ data });
  return render(
    <MemoryRouter initialEntries={["/galerie/lan-2026"]}>
      <Routes><Route path="/galerie/:slug" element={<GalleryAlbumPage />} /></Routes>
    </MemoryRouter>,
  );
}

const openWindow = { open: true, until: "2026-10-22", max: 20, used: 0, pending: 0, remaining: 20, can_submit: true };

test("das Album nennt sein Event und führt zurück; „Foto: Name“ in der Großansicht", async () => {
  renderWith({ ...album, event: { id: "e1", slug: "herbst-lan", name: "Herbst-LAN" }, photos: [{ id: "p9", image_url: "/p9.jpg", credit: "Anna" }] });
  const link = await screen.findByTestId("album-event-link");
  expect(link).toHaveTextContent("Vom Event: Herbst-LAN");
  expect(link).toHaveAttribute("href", "/events/herbst-lan");
  fireEvent.click(screen.getByTestId("gallery-photo-0"));
  expect(screen.getByTestId("gallery-lightbox-credit")).toHaveTextContent("Foto: Anna");
});

test("ohne Einsende-Angaben (Gäste, Nicht-Mitglieder, Alben ohne Event) kein Knopf", async () => {
  renderWith({ ...album, photo_submission: null });
  await screen.findByTestId("gallery-photo-0");
  expect(screen.queryByTestId("photo-submit")).toBeNull();
  expect(screen.queryByText("Fotos einsenden")).toBeNull();
});

test("nach der Frist nur ein Satz, kein Knopf", async () => {
  renderWith({ ...album, photo_submission: { ...openWindow, open: false, can_submit: false } });
  expect(await screen.findByTestId("photo-submit-closed")).toHaveTextContent("Einsenden war bis Do., 22. Oktober möglich.");
  expect(screen.queryByTestId("photo-submit-open")).toBeNull();
});

test("Fotos einsenden: ohne Haken kein Senden, danach je Foto ein Upload mit Einverständnis", async () => {
  globalThis.URL.createObjectURL = vi.fn((file) => `blob:${file.name}`);
  globalThis.URL.revokeObjectURL = vi.fn();
  apiMock.post.mockResolvedValue({ data: { id: "s1", status: "pending" } });
  renderWith({ ...album, photo_submission: openWindow });
  expect(await screen.findByTestId("photo-submit-hint")).toHaveTextContent("Bis Do., 22. Oktober · noch 20 Fotos");
  fireEvent.click(screen.getByTestId("photo-submit-open"));
  const files = [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.png", { type: "image/png" })];
  fireEvent.change(screen.getByTestId("photo-submit-input"), { target: { files } });
  expect(screen.getByTestId("photo-submit-files").querySelectorAll("li")).toHaveLength(2);

  const send = screen.getByTestId("photo-submit-send");
  expect(send).toBeDisabled();
  fireEvent.click(send);
  expect(apiMock.post).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("photo-submit-credit"));
  fireEvent.click(screen.getByTestId("photo-submit-consent"));
  expect(send).toBeEnabled();
  await act(async () => { fireEvent.click(send); });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
  const [url, form] = apiMock.post.mock.calls[0];
  expect(url).toBe("/gallery/lan-2026/submissions");
  expect(form.get("consent")).toBe("true");
  expect(form.get("credit")).toBe("false");
  expect(form.get("file").name).toBe("a.jpg");
  expect(await screen.findByTestId("photo-submit-done")).toHaveTextContent("Danke! 2 Fotos warten auf Freigabe durch den Vorstand.");
});
