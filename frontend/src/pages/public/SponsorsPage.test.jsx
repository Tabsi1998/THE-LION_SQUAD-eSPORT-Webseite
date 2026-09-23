import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Sponsorenseite (#405): „Seit … dabei“ bei den großen Stufen, ehemalige Unterstützer mit ihren
// Jahren unten - und ohne Ehemalige gibt es den Abschnitt nicht.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/SmartLogo", () => ({ SmartLogo: ({ alt }) => <img alt={alt} /> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const SponsorsPage = (await import("./SponsorsPage")).default;

const ACTIVE = [
  { id: "a", name: "Alpha Energy", tier: "gold", logo_url: "/uploads/a.png", since_year: 2024 },
  { id: "b", name: "Beta", tier: "bronze", logo_url: "/uploads/b.png", since_year: 2025 },
];

function mockApi(former) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/sponsors") return { data: ACTIVE };
    if (url === "/sponsors/former") return { data: former };
    return { data: [] };
  });
}

test("Seit-Jahr nur bei großen Stufen, Ehemalige mit Jahren", async () => {
  mockApi([{ id: "d", name: "Delta Bank", tier: "silver", logo_url: "/uploads/d.png", since_year: 2022, until_year: 2025 }, { id: "e", name: "Epsilon", logo_url: "/uploads/e.png", until_year: 2023 }]);
  render(<MemoryRouter><SponsorsPage /></MemoryRouter>);
  expect(await screen.findByTestId("sponsor-since-a")).toHaveTextContent("Seit 2024 dabei");
  expect(screen.queryByTestId("sponsor-since-b")).toBeNull();
  const former = await screen.findByTestId("sponsors-former");
  expect(former).toHaveTextContent("Ehemalige Unterstützer");
  expect(screen.getByTestId("sponsor-former-d")).toHaveTextContent("2022–2025");
  expect(screen.getByTestId("sponsor-former-e")).toHaveTextContent("2023");
});

test("ohne Ehemalige kein Abschnitt", async () => {
  mockApi([]);
  render(<MemoryRouter><SponsorsPage /></MemoryRouter>);
  await screen.findByTestId("sponsor-a");
  expect(screen.queryByTestId("sponsors-former")).toBeNull();
});
