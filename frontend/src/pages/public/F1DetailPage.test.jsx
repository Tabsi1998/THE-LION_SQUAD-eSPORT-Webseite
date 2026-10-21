import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Knöpfe nur, wo sie gebraucht werden (#1277): TV/Beamer und alle Urkunden nur für die Leitung, für alle ein kleines
// „Downloads“ erst mit Ergebnissen - angemeldet mit der eigenen Urkunde; der Referenzzeiten-Kasten ist ein Satz.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ API: "/api", api: apiMock, formatRequestError: () => "", resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ShareButton", () => ({ ShareButton: () => null }));
vi.mock("@/components/tls/FriendsAtEvent", () => ({ FriendsAtEvent: () => null }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock("@/components/tls/StreamEmbed", () => ({ StreamEmbed: () => null }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/hooks/useLapBoardMotion", () => ({ useLapBoardMotion: () => ({ best: null, chips: new Map(), fresh: new Set(), fromMs: new Map() }) }));
let authState = { user: null, isTournamentLead: false };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const { default: F1DetailPage } = await import("./F1DetailPage");

const BOARD = {
  track: { id: "t-1", name: "Monza" },
  max_attempts: 3,
  entries: [
    { rank: 1, participant_id: "u-1", user_id: "u-1", display_name: "Eins", time_str: "1:21,000", attempts: 1 },
    { rank: 2, participant_id: "u-me", user_id: "u-me", display_name: "Ich", time_str: "1:22,000", attempts: 1 },
    { rank: 5, participant_id: "u-5", user_id: "u-5", display_name: "Fünf", time_str: "1:25,000", attempts: 1 },
  ],
};

function challengeWith(extra = {}) {
  return { id: "c-1", slug: "monza", title: "Monza Cup", status: "results_published", tracks: [{ id: "t-1", name: "Monza" }], ...extra };
}

function mockApi(challenge, board = BOARD) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/f1/challenges/monza") return { data: challenge };
    if (url === "/f1/challenges/c-1/leaderboard") return { data: board };
    if (url === "/f1/challenges/c-1/championship") return { data: { standings: [{ rank: 3, user_id: "u-me", display_name: "Ich", wins: 0, races: 1, points: 10 }] } };
    return { data: {} };
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/fastlap/monza"]}>
      <Routes><Route path="/fastlap/:slug" element={<F1DetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState = { user: null, isTournamentLead: false };
  apiMock.get.mockReset();
});

test("Gast: kein TV-Knopf, keine Urkunden-Spalte, Downloads mit Ergebnis-PDF ohne Urkunde", async () => {
  mockApi(challengeWith());
  renderPage();
  expect(await screen.findByTestId("f1-row-1")).toBeInTheDocument();
  expect(screen.queryByTestId("f1-tv-link")).toBeNull();
  expect(screen.queryByTestId("f1-certificates")).toBeNull();
  expect(screen.queryByTestId("f1-certificate-1")).toBeNull();
  expect(screen.getByTestId("f1-result-pdf")).toHaveAttribute("href", "/api/exports/f1/monza/leaderboard.pdf?track_id=t-1");
  expect(screen.queryByTestId("f1-own-certificate")).toBeNull();
});

test("Ohne Ergebnisse gibt es keine Downloads", async () => {
  mockApi(challengeWith({ status: "active" }));
  renderPage();
  expect(await screen.findByTestId("f1-row-1")).toBeInTheDocument();
  expect(screen.queryByTestId("f1-downloads")).toBeNull();
  expect(screen.queryByTestId("f1-result-pdf")).toBeNull();
});

test("Angemeldet unter den ersten vier: die eigene Urkunde statt aller Urkunden", async () => {
  authState = { user: { id: "u-me" }, isTournamentLead: false };
  mockApi(challengeWith());
  renderPage();
  expect(await screen.findByTestId("f1-own-certificate")).toHaveAttribute("href", "/api/exports/f1/monza/certificates/u-me.pdf?track_id=t-1");
  expect(screen.queryByTestId("f1-certificates")).toBeNull();
  expect(screen.queryByTestId("f1-tv-link")).toBeNull();
});

test("Angemeldet auf Platz 5: keine Urkunde", async () => {
  authState = { user: { id: "u-5" }, isTournamentLead: false };
  mockApi(challengeWith());
  renderPage();
  expect(await screen.findByTestId("f1-result-pdf")).toBeInTheDocument();
  expect(screen.queryByTestId("f1-own-certificate")).toBeNull();
});

test("Championship: Gesamtwertung-PDF für alle, eigene Gesamtwertungs-Urkunde", async () => {
  authState = { user: { id: "u-me" }, isTournamentLead: false };
  mockApi(challengeWith({ is_championship: true }));
  renderPage();
  expect(await screen.findByTestId("f1-championship-pdf")).toHaveAttribute("href", "/api/exports/f1/monza/championship.pdf");
  expect(await screen.findByTestId("f1-own-championship-certificate")).toHaveAttribute("href", "/api/exports/f1/monza/championship-certificates/u-me.pdf");
  expect(screen.queryByTestId("f1-championship-certificates")).toBeNull();
});

test("Leitung der Fast Lap behält TV und alle Urkunden", async () => {
  authState = { user: { id: "u-lead" }, isTournamentLead: false };
  mockApi(challengeWith({ can_manage_times: true }));
  renderPage();
  expect(await screen.findByTestId("f1-tv-link")).toHaveAttribute("href", "/display/f1/c-1?track=t-1");
  expect(screen.getByTestId("f1-certificates")).toHaveTextContent("Urkunden");
  expect(await screen.findByTestId("f1-certificate-1")).toBeInTheDocument();
});

test("Bereich Turniere: TV und Urkunden jetzt drucken, auch während es läuft", async () => {
  authState = { user: { id: "u-admin" }, isTournamentLead: true };
  mockApi(challengeWith({ status: "active" }));
  renderPage();
  expect(await screen.findByTestId("f1-tv-link")).toBeInTheDocument();
  expect(screen.getByTestId("f1-certificates")).toHaveTextContent("Urkunden jetzt drucken");
});

test("Downloads am Handy: aufklappbare Zeile", async () => {
  mockApi(challengeWith());
  renderPage();
  const toggle = await screen.findByTestId("f1-downloads-toggle");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("Referenzzeiten: ein Satz statt Kasten, nur wenn Mitglieder außer Wertung fahren", async () => {
  mockApi(challengeWith({ block_club_member_results: true }));
  const { unmount } = renderPage();
  expect(await screen.findByTestId("f1-reference-note")).toHaveTextContent(/^Vereinsmitglieder fahren außer Wertung mit\.$/);
  expect(screen.queryByText("Vereins-Referenzzeiten")).toBeNull();
  unmount();

  mockApi(challengeWith({ allow_club_reference_times: true }));
  renderPage();
  expect(await screen.findByTestId("f1-row-1")).toBeInTheDocument();
  expect(screen.queryByTestId("f1-reference-note")).toBeNull();
  expect(screen.queryByText(/Referenzzeiten sind separat/)).toBeNull();
});
