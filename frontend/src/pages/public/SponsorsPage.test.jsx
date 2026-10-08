import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Sponsorenseite (#405): „Seit … dabei“ bei den großen Stufen, ehemalige Unterstützer mit ihren
// Jahren unten - und ohne Ehemalige gibt es den Abschnitt nicht.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ API: "https://api.test/api", api: apiMock, resolveMediaUrl: (value) => value || "" }));
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

test("Banner aus dem Vereinsmodul oben in der Karte, das Logo darunter - nur wo es einen gibt (#880)", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/sponsors") return { data: [{ ...ACTIVE[0], banner_url: "/api/static/uploads/dolibarr-partner-7-banner-dark-abc.jpg" }, ACTIVE[1]] };
    return { data: [] };
  });
  render(<MemoryRouter><SponsorsPage /></MemoryRouter>);
  const banner = await screen.findByTestId("sponsor-banner-a");
  expect(banner.querySelector("img")).toHaveAttribute("src", "/api/static/uploads/dolibarr-partner-7-banner-dark-abc.jpg");
  expect(screen.getByTestId("sponsor-a")).toContainElement(banner);
  expect(screen.queryByTestId("sponsor-banner-b")).toBeNull();
});

// Sponsor werden (#1254): mit gepflegten Inhalten Zahlen, Leistungen je Stufe und „Unterlagen anfordern“; ohne bleibt
// die kleine Karte, die aufs Kontaktformular führt.
const OFFER = {
  available: true, intro: "Mit eurer Hilfe bleiben Startgelder niedrig.", tiers: ["gold", "silver", "bronze"], pdf_url: "/api/sponsoring/offer/pdf",
  numbers: [{ value: "2.400", label: "Besuche im Monat" }, { value: "214", label: "im Discord", counted: true }],
  benefits: [{ label: "Logo auf TV und Beamer", tiers: ["gold"] }, { label: "Logo im Laufband", tiers: ["gold", "silver", "bronze"] }],
};

test("mit Inhalten: Zahlen, Leistungen je Stufe (Karten und Tabelle), Unterlagen und Mappe", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/sponsors") return { data: ACTIVE };
    if (url === "/sponsoring/offer") return { data: OFFER };
    return { data: [] };
  });
  render(<MemoryRouter><SponsorsPage /></MemoryRouter>);
  const section = await screen.findByTestId("sponsors-offer");
  expect(section).toHaveAttribute("id", "sponsor-werden");
  expect(screen.getByTestId("sponsors-offer-numbers")).toHaveTextContent("2.400Besuche im Monat");
  expect(screen.getByTestId("sponsors-offer-tier-gold")).toHaveTextContent("Logo auf TV und Beamer");
  expect(screen.getByTestId("sponsors-offer-tier-bronze")).not.toHaveTextContent("Logo auf TV und Beamer");
  const rows = screen.getByTestId("sponsors-offer-table").querySelectorAll("tbody tr");
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelectorAll('[aria-label="ja"]')).toHaveLength(1);
  expect(rows[1].querySelectorAll('[aria-label="ja"]')).toHaveLength(3);
  expect(screen.getByTestId("sponsors-offer-contact")).toHaveAttribute("href", `/contact?topic=sponsorship&subject=${encodeURIComponent("Sponsoring: Unterlagen anfordern")}`);
  expect(screen.getByTestId("sponsors-offer-pdf")).toHaveAttribute("href", "https://api.test/api/sponsoring/offer/pdf");
  expect(screen.getByTestId("sponsors-become-card")).toHaveAttribute("href", "/sponsors#sponsor-werden");
});

test("ohne Inhalte bleibt die kleine Karte zum Kontaktformular", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/sponsors") return { data: ACTIVE };
    if (url === "/sponsoring/offer") return { data: { available: false } };
    return { data: [] };
  });
  render(<MemoryRouter><SponsorsPage /></MemoryRouter>);
  await screen.findByTestId("sponsor-a");
  expect(screen.queryByTestId("sponsors-offer")).toBeNull();
  expect(screen.getByTestId("sponsors-become-card")).toHaveAttribute("href", "/contact");
});
