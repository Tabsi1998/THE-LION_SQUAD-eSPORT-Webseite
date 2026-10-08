import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Jahresrückblick auf dem Dashboard (#1195): nur, wenn es einen Rückblick gibt.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { YearReviewBanner } = await import("./YearReviewBanner");

beforeEach(() => {
  apiMock.get.mockReset();
});

test("„Dein Jahr 2026 ist da“ führt zum Rückblick", async () => {
  apiMock.get.mockResolvedValue({ data: { available: true, year: 2026, path: "/dein-jahr" } });
  render(<MemoryRouter><YearReviewBanner /></MemoryRouter>);
  expect(await screen.findByTestId("year-review-banner")).toHaveTextContent("Dein Jahr 2026 ist da");
  expect(apiMock.get).toHaveBeenCalledWith("/year-review/status");
  expect(screen.getByTestId("year-review-banner-open")).toHaveAttribute("href", "/dein-jahr");
});

test("ohne Rückblick oder bei Fehlern steht nichts da", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, year: 2026 } });
  const { container, unmount } = render(<MemoryRouter><YearReviewBanner /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  unmount();
  apiMock.get.mockRejectedValue(new Error("offline"));
  const second = render(<MemoryRouter><YearReviewBanner /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(second.container).toBeEmptyDOMElement();
});
