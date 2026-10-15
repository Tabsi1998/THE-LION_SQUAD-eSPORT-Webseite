import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Aushang zum Vor-Ort-Zugang (#1592): hell, zum Drucken, mit großem QR-Code - der Code steht nur im QR, nie als Text.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (u) => u }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <div data-testid="poster-qr-value" data-value={value} /> }));

const AdminOnsitePosterPage = (await import("./AdminOnsitePosterPage")).default;

const TOURNAMENT = { id: "t1", slug: "lan-cup", title: "LAN Cup Herbst", start_date: "2026-10-31T13:00:00+00:00", location: "Vereinsheim", game: { name: "Mario Kart 8", display_name: "Mario Kart 8" } };
const ACCESS = { enabled: true, default: true, explicit: null, open_now: false, window: { from: "2026-10-31T08:00:00+00:00", until: "2026-10-31T20:00:00+00:00" }, path: "/vor-ort#geheimer-code-123" };

function mock(access = ACCESS) {
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/t1") return Promise.resolve({ data: TOURNAMENT });
    if (path === "/tournaments/t1/onsite-access") return Promise.resolve({ data: access });
    return Promise.reject(new Error(path));
  });
}

const renderPage = () => render(
  <MemoryRouter initialEntries={["/admin/tournaments/t1/aushang"]}>
    <Routes><Route path="/admin/tournaments/:id/aushang" element={<AdminOnsitePosterPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => vi.clearAllMocks());

test("Aushang: Titel, Termin, Spiel, Ort und der QR-Code mit dem Vor-Ort-Zugang", async () => {
  mock();
  renderPage();
  const sheet = await screen.findByTestId("onsite-poster-sheet");
  expect(sheet).toHaveTextContent("LAN Cup Herbst");
  expect(sheet).toHaveTextContent("Mario Kart 8");
  expect(sheet).toHaveTextContent("Vereinsheim");
  expect(screen.getByTestId("poster-qr-value")).toHaveAttribute("data-value", `${window.location.origin}/vor-ort#geheimer-code-123`);
  expect(sheet).not.toHaveTextContent("geheimer-code");
});

test("Drucken öffnet den Druckdialog", async () => {
  const user = userEvent.setup();
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  mock();
  renderPage();
  await user.click(await screen.findByTestId("onsite-poster-print"));
  expect(print).toHaveBeenCalled();
});

test("abgeschaltet: Warnung statt Aushang", async () => {
  mock({ ...ACCESS, enabled: false });
  renderPage();
  expect(await screen.findByTestId("onsite-poster-off")).toHaveTextContent("abgeschaltet");
  expect(screen.queryByTestId("poster-qr-value")).toBeNull();
});
