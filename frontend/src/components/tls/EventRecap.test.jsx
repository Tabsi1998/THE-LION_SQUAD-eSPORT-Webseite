import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Rückblick (#1187): mit Daten Sieger, Zahlen, „Du warst dabei“ und Bericht; ohne Daten (vorher, Fehler) der Ersatz.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (u) => u }));

const { EventRecap } = await import("./EventRecap");

const RECAP = {
  available: true,
  event_id: "e1",
  winners: [{ kind: "tournament", id: "t-mk", slug: "mk", title: "Mario Kart Cup", team: false, podium: [
    { rank: 1, name: "Gast Eins", team: false, detail: "1 Sieg" }, { rank: 2, name: "Lena", team: false, detail: null },
  ] }],
  fastlaps: [{ kind: "fastlap", id: "f-spa", slug: "spa", title: "Fast Lap Spa", track: "Spa", tracks: 1, podium: [
    { rank: 1, name: "Lena", time_ms: 91234, detail: "1:31.234" },
  ] }],
  numbers: { participants: 5, matches: 2, tournaments: 1, fastlaps: 1, photos: 0 },
  report: { id: "n1", slug: "rueckblick", title: "Rückblick: Sommer-LAN", excerpt: "So war es" },
  mine: { was_there: true, results: [{ kind: "tournament", id: "t-mk", slug: "mk", title: "Mario Kart Cup", rank: 2, of: 2, team_name: null }] },
};

function renderRecap(event = { id: "e1", slug: "sommer-lan" }) {
  return render(
    <MemoryRouter>
      <EventRecap event={event} fallback={<div data-testid="fallback">Das Event ist vorbei.</div>} />
    </MemoryRouter>,
  );
}

test("mit Daten: Du warst dabei, Zahlen, Treppchen je Turnier und Fast Lap, Bericht", async () => {
  apiMock.get.mockResolvedValue({ data: RECAP });
  renderRecap();
  expect(await screen.findByTestId("event-recap")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledWith("/events/sommer-lan/recap", { params: undefined });
  expect(screen.queryByTestId("fallback")).toBeNull();
  const mine = screen.getByTestId("event-recap-mine");
  expect(mine).toHaveTextContent("Du warst dabei");
  expect(mine).toHaveTextContent("Mario Kart CupPlatz 2 von 2");
  expect(screen.getByTestId("event-recap-number-participants")).toHaveTextContent("Teilnehmer5");
  expect(screen.queryByTestId("event-recap-number-photos")).toBeNull();
  const podium = screen.getByTestId("event-recap-podium-t-mk");
  expect(within(podium).getByTestId("event-recap-podium-t-mk-1")).toHaveAttribute("aria-label", "Platz 1: Gast Eins, 1 Sieg");
  // Treppchen: Platz 2 steht links.
  expect(within(podium).getAllByRole("listitem")[0]).toHaveTextContent("Lena");
  expect(screen.getByTestId("event-recap-podium-f-spa-1")).toHaveTextContent("1:31.234");
  expect(screen.getByTestId("event-recap-report")).toHaveAttribute("href", "/news/rueckblick");
});

test("ohne Teilnahme kein „Du warst dabei“", async () => {
  apiMock.get.mockResolvedValue({ data: { ...RECAP, mine: null } });
  renderRecap();
  expect(await screen.findByTestId("event-recap")).toBeInTheDocument();
  expect(screen.queryByTestId("event-recap-mine")).toBeNull();
});

test("vor dem Ende steht der Ersatz", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "not_over" } });
  renderRecap();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.getByTestId("fallback")).toBeInTheDocument();
  expect(screen.queryByTestId("event-recap")).toBeNull();
});

test("bei einem Fehler steht der Ersatz", async () => {
  apiMock.get.mockImplementation(async () => { throw new Error("offline"); });
  renderRecap();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.getByTestId("fallback")).toBeInTheDocument();
});
