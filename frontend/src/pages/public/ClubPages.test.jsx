import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Vorstandsseite: die Statuten aus Dolibarr (#326 Teil 3) - geltende Fassung mit PDF, frühere und
// künftige Fassungen als Liste; ohne Schalter oder Freigabe bleibt der Hinweis auf den Mitgliederbereich.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ API: "https://api.test/api", api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { BoardPage, statuteLine, formatDay } = await import("./ClubPages");

const STATUTES = {
  available: true, state: "in_force", fetched_at: "2026-09-24T10:00:00+00:00",
  current: { id: 3, version: 2, decided_on: "2026-03-14", valid_from: "2026-04-20", valid_to: "2026-12-31", state: "in_force", size: 48211 },
  versions: [
    { id: 5, version: 3, decided_on: "2026-09-01", valid_from: "2027-01-01", valid_to: "", state: "future", size: 1 },
    { id: 3, version: 2, decided_on: "2026-03-14", valid_from: "2026-04-20", valid_to: "2026-12-31", state: "in_force", size: 48211 },
    { id: 1, version: 1, decided_on: "2019-02-10", valid_from: "2019-03-01", valid_to: "2026-04-19", state: "repealed", size: 1 },
  ],
};

function mockApi(statutes) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/board/statutes") return { data: statutes };
    return { data: [] };
  });
}

beforeEach(() => vi.clearAllMocks());

test("mit Freigabe: geltende Fassung mit PDF, frühere und künftige Fassungen darunter", async () => {
  mockApi(STATUTES);
  render(<MemoryRouter><BoardPage /></MemoryRouter>);
  const current = await screen.findByTestId("board-statutes-current");
  expect(current).toHaveTextContent("Geltende Fassung: Fassung 2");
  expect(current).toHaveTextContent("beschlossen am 14.03.2026 · gültig seit 20.04.2026");
  expect(screen.getByTestId("board-statutes-pdf-3")).toHaveAttribute("href", "https://api.test/api/board/statutes/3/pdf");
  const archive = screen.getByTestId("board-statutes-archive");
  expect(archive).toHaveTextContent("Fassung 3 gilt ab 01.01.2027");
  expect(archive).toHaveTextContent("Fassung 1: 01.03.2019 bis 19.04.2026");
  expect(archive).not.toHaveTextContent("Fassung 2");
  expect(screen.getByTestId("board-statutes-pdf-1")).toHaveAttribute("href", "https://api.test/api/board/statutes/1/pdf");
});

test("ohne Schalter oder Freigabe: der Hinweis auf den Mitgliederbereich, keine Fassungen", async () => {
  mockApi({ available: false, reason: "not_published" });
  render(<MemoryRouter><BoardPage /></MemoryRouter>);
  const box = await screen.findByTestId("board-statutes");
  expect(box).toHaveTextContent("Statuten und ZVR-Nummer werden im Mitgliederbereich nach Login angezeigt.");
  expect(screen.queryByTestId("board-statutes-current")).not.toBeInTheDocument();
  expect(screen.queryByTestId("board-statutes-archive")).not.toBeInTheDocument();
});

test("noch keine Fassung in Kraft: ehrlicher Satz statt leerem Kasten", async () => {
  mockApi({ ...STATUTES, state: "none", current: null, versions: [STATUTES.versions[0]] });
  render(<MemoryRouter><BoardPage /></MemoryRouter>);
  expect(await screen.findByTestId("board-statutes-none")).toHaveTextContent("Derzeit ist noch keine Fassung in Kraft.");
  expect(screen.getByTestId("board-statutes-archive")).toHaveTextContent("Fassung 3 gilt ab 01.01.2027");
});

test("statuteLine und formatDay", () => {
  expect(formatDay("2026-04-20")).toBe("20.04.2026");
  expect(formatDay("")).toBe("");
  expect(statuteLine({ version: 2, state: "in_force", valid_from: "2026-04-20" })).toBe("Fassung 2 seit 20.04.2026");
  expect(statuteLine(null)).toBe("");
});
