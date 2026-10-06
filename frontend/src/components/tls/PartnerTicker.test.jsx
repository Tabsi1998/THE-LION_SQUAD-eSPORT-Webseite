import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Partner-Laufband auf der Startseite (#968): nur Partner mit Logo, jedes Logo führt auf die Partnerseite,
// ohne Partner-Logos kein Band (keine leere Zeile).

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/SmartLogo", () => ({ SmartLogo: ({ alt }) => <img alt={alt} /> }));

const { PartnerTicker, partnerTickerItems } = await import("./PartnerTicker");

const PARTNERS = [
  { id: "p1", slug: "gamers-heaven", name: "Gamers Heaven", logo_url: "/uploads/gh.png", link: "https://gamersheaven.test" },
  { id: "p2", slug: "ohne-logo", name: "Ohne Logo", logo_url: null, link: "https://ohne.test" },
  { id: "p3", slug: "verein-b", name: "Verein B", logo_url: "/uploads/b.png" },
  { id: "p4", slug: "verein-c", name: "Verein C", logo_url: "/uploads/c.png" },
];

beforeEach(() => apiMock.get.mockReset());

test("zeigt „Partner“ und die Logos mit Link auf die Partnerseite; ohne Logo nicht dabei", async () => {
  apiMock.get.mockResolvedValue({ data: PARTNERS });
  render(<MemoryRouter><PartnerTicker /></MemoryRouter>);
  const band = await screen.findByTestId("partner-ticker");
  expect(band).toHaveTextContent("Partner");
  expect(apiMock.get).toHaveBeenCalledWith("/partners");
  expect(screen.getByTestId("partner-ticker-band")).toHaveAttribute("data-marquee", "1");
  expect(screen.getAllByTitle("Gamers Heaven")[0]).toHaveAttribute("href", "/partners/gamers-heaven");
  expect(screen.queryByTitle("Ohne Logo")).toBeNull();
});

test("ohne Partner mit Logo kein Band", async () => {
  apiMock.get.mockResolvedValue({ data: [PARTNERS[1]] });
  const { container } = render(<MemoryRouter><PartnerTicker /></MemoryRouter>);
  await vi.waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container.querySelector("[data-testid='partner-ticker']")).toBeNull();
});

test("partnerTickerItems: ohne Slug führt der Link auf die Website des Partners", () => {
  expect(partnerTickerItems([{ id: "x", name: "X", logo_url: "/x.png", link: "https://x.test" }])).toEqual([
    { key: "x", name: "X", logo_url: "/x.png", to: undefined, href: "https://x.test" },
  ]);
  expect(partnerTickerItems(null)).toEqual([]);
});
