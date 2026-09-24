import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Partnerliste: jede Karte führt auf die Partnerseite (#469), die Kanäle stehen als Symbole an der
// Karte, die Website bleibt ein kleiner Link.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const PartnersPage = (await import("./PartnersPage")).default;

test("Karten führen zur Partnerseite und zeigen die Kanäle", async () => {
  apiMock.get.mockResolvedValue({ data: [
    { id: "p1", slug: "pineapps-tft", name: "PineApps TFT", kind: "Community", since: "2025", link: "https://pineapps.at", description: "TFT-Community.", channels: [{ key: "website", label: "Website", url: "https://pineapps.at" }, { key: "twitch", label: "Twitch", url: "https://www.twitch.tv/pineapps", handle: "pineapps" }] },
    { id: "p2", name: "Ohne Slug", kind: "Verein", channels: [] },
  ] });
  render(<MemoryRouter><PartnersPage /></MemoryRouter>);
  expect(await screen.findByTestId("partner-open-pineapps-tft")).toHaveAttribute("href", "/partners/pineapps-tft");
  expect(screen.getByTestId("partner-card-pineapps-tft")).toHaveTextContent("Community · seit 2025");
  expect(screen.getByTestId("partner-icon-twitch")).toHaveAttribute("href", "https://www.twitch.tv/pineapps");
  expect(screen.getByTestId("partner-card-pineapps-tft")).toHaveTextContent("Website");
  // Ohne Slug (alter Eintrag, noch nicht gelesen) trägt die ID.
  expect(screen.getByTestId("partner-open-p2")).toHaveAttribute("href", "/partners/p2");
});
