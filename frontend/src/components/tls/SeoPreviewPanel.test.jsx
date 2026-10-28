import { render, screen } from "@testing-library/react";

// So erscheint der Beitrag (#2122 NW5): Vorschau für Google und Teilen in Alltagssprache - ohne „Canonical“, „Robots“
// oder „noindex“.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));

const { SeoPreviewPanel } = await import("./SeoPreviewPanel");

test("Entwurf: Suchmaschinen finden ihn nicht, ohne Fachbegriffe", () => {
  render(<SeoPreviewPanel path="" fallback={{ title: "Herbst-LAN", description: "Alles dazu.", robots: "noindex, follow", published: false }} />);
  expect(screen.getByText("So erscheint der Beitrag")).toBeInTheDocument();
  expect(screen.getByTestId("seo-preview-robots")).toHaveTextContent("finden ihn nicht");
  expect(screen.getByText("Der Link steht nach dem ersten Speichern fest.")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/Canonical|Robots|noindex|Social Preview|SEO/);
});

test("öffentlich: Suchmaschinen dürfen ihn finden", () => {
  render(<SeoPreviewPanel path="" fallback={{ title: "Herbst-LAN", robots: "index, follow", published: true }} />);
  expect(screen.getByTestId("seo-preview-robots")).toHaveTextContent("dürfen ihn finden");
});
