import { render, screen } from "@testing-library/react";

// Hauptsponsor-Banner (#880): auf der Startseite (Spotlight) groß über dem Laufband - nur beim Hauptsponsor mit
// Banner aus dem Vereinsmodul; das Laufband im Footer bleibt ohne.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/SmartLogo", () => ({ SmartLogo: ({ alt }) => <img alt={alt} /> }));

const { SponsorTicker } = await import("./SponsorTicker");

const MAIN = { id: "m", name: "Alpha Energy", tier: "main", link: "https://alpha.test", logo_url: "/api/static/uploads/a-logo.png",
  banner_url: "/api/static/uploads/dolibarr-partner-7-banner-dark-abc.jpg" };
const GOLD = { id: "g", name: "Beta", tier: "gold", logo_url: "/uploads/b.png", banner_url: "/api/static/uploads/b-banner.jpg" };

beforeEach(() => apiMock.get.mockReset());

test("Spotlight: der Banner des Hauptsponsors steht über dem Laufband, mit Link", async () => {
  apiMock.get.mockResolvedValue({ data: [GOLD, MAIN] });
  render(<SponsorTicker placement="home" spotlight />);
  const block = await screen.findByTestId("sponsor-main-banner");
  expect(block).toHaveTextContent("Hauptsponsor");
  expect(block.querySelector("a")).toHaveAttribute("href", "https://alpha.test");
  expect(block.querySelector("img")).toHaveAttribute("src", MAIN.banner_url);
  expect(apiMock.get).toHaveBeenCalledWith("/sponsors?placement=home");
  // Darunter das Band mit der Überschrift „Sponsoren“ (#968) - beide Logos, nahtlos ab zwei.
  expect(screen.getByTestId("sponsor-ticker-title")).toHaveTextContent("Sponsoren");
  expect(screen.getByTestId("sponsor-ticker-band")).toHaveAttribute("data-marquee", "1");
  expect(screen.getAllByTitle("Beta")[0]).not.toHaveAttribute("href");
});

test("ohne Hauptsponsor-Banner und im Footer-Laufband kein Banner", async () => {
  apiMock.get.mockResolvedValue({ data: [GOLD] });
  const { unmount } = render(<SponsorTicker placement="home" spotlight />);
  await screen.findByTestId("sponsor-ticker");
  expect(screen.queryByTestId("sponsor-main-banner")).toBeNull();
  unmount();

  apiMock.get.mockResolvedValue({ data: [MAIN, GOLD] });
  render(<SponsorTicker placement="footer" compact />);
  await screen.findByTestId("sponsor-ticker");
  expect(screen.queryByTestId("sponsor-main-banner")).toBeNull();
  expect(screen.queryByTestId("sponsor-ticker-title")).toBeNull();
});
