import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Vorstandsseite: Porträts aus einem Guss (#1332), offene Funktionen als Einladung (#1252) und die Statuten - aus Dolibarr
// (#326 Teil 3, nur freigegeben) oder aus den Dokumenten; mit dem Schalter aus bleibt der Hinweis auf den Mitgliederbereich.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ API: "https://api.test/api", api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { BoardPage, boardSections, statuteLine, formatDay } = await import("./ClubPages");

const STATUTES = {
  available: true, source: "dolibarr", state: "in_force", fetched_at: "2026-09-24T10:00:00+00:00", pdf_url: "/api/board/statutes/3/pdf",
  current: { id: 3, version: 2, decided_on: "2026-03-14", valid_from: "2026-04-20", valid_to: "2026-12-31", state: "in_force", size: 48211 },
  versions: [
    { id: 5, version: 3, decided_on: "2026-09-01", valid_from: "2027-01-01", valid_to: "", state: "future", size: 1 },
    { id: 3, version: 2, decided_on: "2026-03-14", valid_from: "2026-04-20", valid_to: "2026-12-31", state: "in_force", size: 48211 },
    { id: 1, version: 1, decided_on: "2019-02-10", valid_from: "2019-03-01", valid_to: "2026-04-19", state: "repealed", size: 1 },
  ],
};

const BOARD = [
  { id: "p1", slug: "obmann", title_male: "Obmann", title_female: "Obfrau", display_title: "Obmann", neutral_title: "Obmann/Obfrau", allow_deputy: true, is_active: true,
    user: { gamertag: "LeoLöwe", real_name: "Leo Beispiel", photo_url: "/leo.png", photo_cutout: true, profile_url: "/members/leo" }, deputy_user: null, deputy_vacancy_text: "Einmal im Monat Sitzung." },
  { id: "p2", slug: "kassier", title_male: "Kassier", title_female: "Kassierin", display_title: "Kassierin", deputy_title: "Kassierin", neutral_title: "Kassier/Kassierin", allow_deputy: true, is_active: true,
    user: { gamertag: "MiraMaus", real_name: "Mira Muster", photo_url: "/mira.png", photo_cutout: false }, deputy_user: { gamertag: "SternNebel", real_name: "Sina Muster", photo_url: "/sina.png", photo_cutout: true } },
  { id: "p3", slug: "schriftfuehrer", title_male: "Schriftführer", title_female: "Schriftführerin", display_title: "Schriftführer", neutral_title: "Schriftführer/Schriftführerin", allow_deputy: false, is_active: true,
    user: null, vacancy_text: "Zwei Stunden im Monat." },
  { id: "dolibarr-jugend-0", slug: "jugend", display_title: "Jugendreferent:in", neutral_title: "Jugendreferent:in", is_active: true, user: null, name_withheld: true },
];

function mockApi(statutes, board = []) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/board/statutes") return { data: statutes };
    if (url.startsWith("/board")) return { data: board };
    return { data: [] };
  });
}

beforeEach(() => vi.clearAllMocks());

// Rollen dürfen nach „/“ und „:“ umbrechen (unsichtbares Leerzeichen) - für den Vergleich fällt es weg.
const plain = (node) => node.textContent.replace(/\u200B/g, "");

test("Vorsitz groß, Stellvertretungen klein, offene Funktionen als Einladung, nicht freigegebene ohne Namen", async () => {
  mockApi({ available: false, reason: "members_only" }, BOARD);
  render(<MemoryRouter><BoardPage /></MemoryRouter>);
  const core = await screen.findByTestId("board-core");
  expect(within(core).getByTestId("board-position-obmann")).toHaveTextContent("ObmannLeo Beispiel LeoLöwe");
  expect(within(core).getByTestId("board-position-kassier")).toHaveTextContent("KassierinMira Muster MiraMaus");
  expect(plain(within(core).getByTestId("board-vacancy-schriftfuehrer"))).toBe("Wir suchenSchriftführer/SchriftführerinZwei Stunden im Monat.Interesse melden");
  const deputies = screen.getByTestId("board-deputies");
  expect(plain(within(deputies).getByTestId("board-vacancy-obmann-stv"))).toContain("Stellvertretung Obmann/ObfrauEinmal im Monat Sitzung.");
  expect(within(deputies).getByTestId("board-position-kassier-stv")).toHaveTextContent("StellvertretungKassierinSina Muster SternNebel");
  expect(plain(screen.getByTestId("board-special"))).toContain("Jugendreferent:inName nicht freigegeben");
  expect(screen.queryByTestId("board-vacancy-jugend")).not.toBeInTheDocument();
});

test("mit Freigabe aus Dolibarr: geltende Fassung mit PDF für alle, frühere und künftige darunter", async () => {
  mockApi(STATUTES);
  render(<MemoryRouter><BoardPage /></MemoryRouter>);
  const current = await screen.findByTestId("board-statutes-current");
  expect(screen.getByTestId("board-statutes")).toHaveTextContent("Die Statuten sind die Regeln unseres Vereins – wer Mitglied wird, stimmt ihnen zu.");
  expect(current).toHaveTextContent("Geltende Fassung: Fassung 2");
  expect(current).toHaveTextContent("beschlossen am 14.03.2026 · gültig seit 20.04.2026");
  expect(screen.getByTestId("board-statutes-pdf-3")).toHaveAttribute("href", "https://api.test/api/board/statutes/3/pdf");
  const archive = screen.getByTestId("board-statutes-archive");
  expect(archive).toHaveTextContent("Fassung 3 gilt ab 01.01.2027");
  expect(archive).toHaveTextContent("Fassung 1: 01.03.2019 bis 19.04.2026");
  expect(archive).not.toHaveTextContent("Fassung 2");
  expect(screen.getByTestId("board-statutes-pdf-1")).toHaveAttribute("href", "https://api.test/api/board/statutes/1/pdf");
});

test("ohne Dolibarr: das Statuten-Dokument aus der Verwaltung als PDF", async () => {
  mockApi({ available: true, source: "documents", state: "in_force", versions: [], pdf_url: "/api/board/statutes/document", current: { id: "d1", title: "Statuten 2026", updated_at: "2026-01-10T10:00:00+00:00" } });
  render(<MemoryRouter><BoardPage /></MemoryRouter>);
  const current = await screen.findByTestId("board-statutes-current");
  expect(current).toHaveTextContent("Statuten 2026");
  expect(current).toHaveTextContent("Stand 10.01.2026");
  expect(screen.getByTestId("board-statutes-pdf-d1")).toHaveAttribute("href", "https://api.test/api/board/statutes/document");
  expect(screen.getByTestId("board-statutes")).not.toHaveTextContent("Prüfsumme");
});

test("Schalter aus oder keine Freigabe: der Hinweis auf den Mitgliederbereich, keine Fassungen", async () => {
  mockApi({ available: false, reason: "members_only" });
  render(<MemoryRouter><BoardPage /></MemoryRouter>);
  const box = await screen.findByTestId("board-statutes");
  expect(box).toHaveTextContent("Statuten und ZVR-Nummer werden im Mitgliederbereich nach Login angezeigt.");
  expect(box).toHaveAttribute("id", "statuten");
  expect(screen.queryByTestId("board-statutes-current")).not.toBeInTheDocument();
  expect(screen.queryByTestId("board-statutes-archive")).not.toBeInTheDocument();
});

test("noch keine Fassung in Kraft: ehrlicher Satz statt leerem Kasten", async () => {
  mockApi({ ...STATUTES, state: "none", current: null, versions: [STATUTES.versions[0]] });
  render(<MemoryRouter><BoardPage /></MemoryRouter>);
  expect(await screen.findByTestId("board-statutes-none")).toHaveTextContent("Derzeit ist noch keine Fassung in Kraft.");
  expect(screen.getByTestId("board-statutes-archive")).toHaveTextContent("Fassung 3 gilt ab 01.01.2027");
});

test("statuteLine, formatDay und die Abschnitte", () => {
  expect(formatDay("2026-04-20")).toBe("20.04.2026");
  expect(formatDay("")).toBe("");
  expect(statuteLine({ version: 2, state: "in_force", valid_from: "2026-04-20" })).toBe("Fassung 2 seit 20.04.2026");
  expect(statuteLine(null)).toBe("");
  const sections = boardSections(BOARD);
  expect(sections.core.map((seat) => [seat.slug, seat.vacant])).toEqual([["obmann", false], ["kassier", false], ["schriftfuehrer", true]]);
  expect(sections.deputies.map((seat) => [seat.slug, seat.vacant])).toEqual([["obmann-stv", true], ["kassier-stv", false]]);
  expect(sections.rest.map((seat) => [seat.slug, seat.vacant, seat.withheld])).toEqual([["jugend", false, true]]);
  expect(boardSections("kaputt")).toEqual({ core: [], deputies: [], rest: [] });
});
