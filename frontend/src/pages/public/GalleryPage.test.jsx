import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Galerie (#2412): kommt die Liste der Alben nicht, steht ein Ladefehler mit „Nochmal versuchen“ da - nicht „noch
// keine Alben“.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: GalleryPage } = await import("./GalleryPage");

test("Galerie: Ladefehler mit „Nochmal versuchen“, danach die Alben", async () => {
  apiMock.get.mockRejectedValueOnce({ response: { status: 500 } });
  apiMock.get.mockResolvedValue({ data: [{ id: "a1", slug: "lan-2026", title: "LAN 2026", photo_count: 3 }] });
  render(<MemoryRouter><GalleryPage /></MemoryRouter>);
  expect(await screen.findByTestId("public-error-state")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("public-error-retry"));
  expect(await screen.findByText("LAN 2026")).toBeInTheDocument();
  expect(screen.queryByTestId("public-error-state")).toBeNull();
});
