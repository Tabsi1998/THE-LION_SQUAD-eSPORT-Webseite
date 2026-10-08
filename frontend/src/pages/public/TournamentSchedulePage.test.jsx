import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Spielplan (#225): Ein frisch eingetragenes Ergebnis trägt kurz „gerade eingetragen“, und
// unten steht ein Hinweis mit dem Ergebnis - auch für Zuschauer. Beim ersten Laden nichts davon.

const apiMock = { get: vi.fn() };
const toastMock = vi.fn();
let refresh = null;
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: (...args) => toastMock(...args) }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback) => { refresh = callback; } }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));

const TournamentSchedulePage = (await import("./TournamentSchedulePage")).default;

const tournament = { id: "t1", slug: "cup", title: "Herbst-Cup", status: "live" };
const registrations = [{ id: "r1", display_name: "Team A" }, { id: "r2", display_name: "Team B" }];

function bracket(m1) {
  return {
    tournament,
    registrations,
    matches_v2: [
      { id: "m1", match_key: "A1", round: 1, match_type: "duel", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }], ...m1 },
      { id: "m2", match_key: "A2", round: 1, match_type: "duel", status: "scheduled", slots: [{ slot: 1, registration_id: "r2" }, { slot: 2, registration_id: "r1" }], results: [] },
    ],
    matches: [],
  };
}

function mockApi(data) {
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: tournament });
    if (path === "/tournaments/t1/bracket") return Promise.resolve({ data });
    if (path === "/tournaments/t1/matchdays") return Promise.resolve({ data: { applies: false, matchdays: [] } });
    return Promise.reject(new Error(path));
  });
}

beforeEach(() => { toastMock.mockClear(); });

test("frisches Ergebnis: Kennzeichen an der Karte und Hinweis mit dem Ergebnis", async () => {
  mockApi(bracket({ status: "running", results: [] }));
  render(
    <MemoryRouter initialEntries={["/tournaments/cup/matches"]}>
      <Routes><Route path="/tournaments/:slug/matches" element={<TournamentSchedulePage />} /></Routes>
    </MemoryRouter>,
  );
  const card = await screen.findByTestId("schedule-match-m1");
  expect(card).not.toHaveAttribute("data-changed");
  expect(toastMock).not.toHaveBeenCalled();

  mockApi(bracket({ status: "completed", results: [{ registration_id: "r1", score: 2, rank: 1 }, { registration_id: "r2", score: 1, rank: 2 }] }));
  await act(async () => { await refresh(); });
  await waitFor(() => expect(screen.getByTestId("schedule-fresh-m1")).toHaveTextContent("gerade eingetragen"));
  expect(screen.getByTestId("schedule-match-m2")).not.toHaveAttribute("data-changed");
  expect(toastMock).toHaveBeenCalledWith("Ergebnis eingetragen: Team A 2 : Team B 1", expect.objectContaining({ id: "result-m1" }));
});

// Klartext im Spielplan (#1220): Freilos heißt Freilos, leere Plätze „noch offen“, Station einmal, Datum kurz und ganz.
test("Spielplan: Freilos, noch offene Plätze, Station im Klartext und Datum", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));
  try {
    mockApi({
      tournament, registrations, matches: [],
      matches_v2: [
        { id: "m1", match_key: "A1", round: 1, match_type: "duel", status: "completed", winner_id: "r1", scheduled_at: "2026-05-23T16:00:00Z",
          station_label: "Station A - switch2", station_text: "Station A · Switch 2",
          slots: [{ slot: 1, registration_id: "r1", status: "filled" }, { slot: 2, status: "bye" }], results: [{ registration_id: "r1", rank: 1 }] },
        { id: "m2", match_key: "B1", round: 2, match_type: "duel", status: "scheduled", slots: [{ slot: 1, status: "pending" }, { slot: 2, status: "pending" }], results: [] },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/tournaments/cup/matches"]}>
        <Routes><Route path="/tournaments/:slug/matches" element={<TournamentSchedulePage />} /></Routes>
      </MemoryRouter>,
    );
    const bye = await screen.findByTestId("schedule-match-m1");
    expect(bye).toHaveTextContent("Team A vs. Freilos");
    expect(screen.getByTestId("schedule-station-m1")).toHaveTextContent("Station A · Switch 2");
    expect(bye).not.toHaveTextContent("Station Station");
    expect(screen.getByTestId("schedule-when-m1")).toHaveTextContent("Sa 23. Mai · 18:00");
    expect(screen.getByTestId("schedule-match-m2")).toHaveTextContent("noch offen vs. noch offen");
    expect(screen.getByTestId("schedule-when-m2")).toHaveTextContent("Termin offen");
  } finally {
    vi.useRealTimers();
  }
});
