import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

// Logos als SVG (#1952): Favicon, Symbol auf dem Home-Bildschirm und Teilen-Bild sind Rasterbilder - aus einem
// SVG-Logo wird dort die PNG-Fassung daneben.

const { apiMock } = vi.hoisted(() => ({ apiMock: { get: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { BrandingHead } = await import("./BrandingHead");

test("ein SVG-Favicon und -Logo stehen im Kopf als PNG", async () => {
  apiMock.get.mockResolvedValue({ data: {
    favicon_url: "/api/static/uploads/fav.svg",
    favicon_dark_url: "/api/static/uploads/fav-dunkel.svg",
    logo_url: "/api/static/uploads/logo.svg",
  } });
  render(<BrandingHead />);
  await waitFor(() => expect(document.head.querySelector('link[rel="apple-touch-icon"]')).not.toBeNull());
  const icons = [...document.head.querySelectorAll('link[rel="icon"]')].map((node) => node.getAttribute("href"));
  expect(icons).toContain("/api/static/uploads/fav.png");
  expect(icons).toContain("/api/static/uploads/fav-dunkel.png");
  expect(icons.some((href) => href.endsWith(".svg"))).toBe(false);
  expect(document.head.querySelector('link[rel="apple-touch-icon"]').getAttribute("href")).toBe("/api/static/uploads/fav.png");
  expect(document.head.querySelector('meta[property="og:image"]').getAttribute("content")).toBe("/api/static/uploads/logo.png");
  expect(document.head.querySelector('meta[property="og:image:type"]').getAttribute("content")).toBe("image/png");
});
