import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Turnierleitung (#1156, #1160): erster Reiter „Braucht Aufmerksamkeit“ mit dem passenden Knopf je Fall, zweiter
// „Ergebnisse“. Namen sind erfunden.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "s1" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const TournamentLeadPage = (await import("./TournamentLeadPage")).default;

const ENTRY = {
  id: "m8", label: "Halbfinale B", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, has_result: false, result: [], advance: {},
  participants: [{ registration_id: "r3", name: "TurboTina" }, { registration_id: "r4", name: "Frostbiss" }], station_text: "PC 4",
  timing: { missing: true, overdue_minutes: 12 }, can_enter: true, status: "scheduled",
};

function renderLead(view) {
  apiMock.get.mockResolvedValue({ data: view });
  return render(
    <MemoryRouter initialEntries={["/tournaments/fc-cup/leitung"]}>
      <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("Braucht Aufmerksamkeit: jeder Fall mit seinem Knopf, „Eintragen“ öffnet das Ergebnis-Fenster", async () => {
  renderLead({
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [ENTRY], recent: [], counts: { open: 1 },
    attention: [
      { id: "rm-m8", kind: "result_missing", title: "Ergebnis fehlt", action: "enter", match_id: "m8", station_text: "PC 4", label: "Halbfinale B", names: "TurboTina gegen Frostbiss", detail: "12 Min. über der Zeit" },
      { id: "st-sw2", kind: "station_broken", title: "Station defekt", action: "move", station_text: "Switch 2", label: "Durchgang 3", names: "4 Teilnehmer", detail: "1 Spiel wartet darauf", match_ids: ["m7"] },
    ],
    stations: [{ id: "sw3", name: "Switch 3", status: "free", busy: false }],
  });
  expect(await screen.findByTestId("lead-tab-attention")).toHaveTextContent("Braucht Aufmerksamkeit (2)");
  expect(screen.getByTestId("lead-case-rm-m8")).toHaveTextContent("12 Min. über der Zeit");
  expect(screen.getByTestId("lead-case-move-st-sw2")).toHaveTextContent("Umlegen");
  fireEvent.click(screen.getByTestId("lead-case-enter-rm-m8"));
  expect(await screen.findByTestId("result-window")).toBeInTheDocument();
});

test("ohne Fälle startet die Ansicht bei „Ergebnisse“", async () => {
  renderLead({ tournament: { id: "t1", title: "FC 26 Herbst-Cup" }, matches: [ENTRY], recent: [], attention: [], stations: [], counts: { open: 1, missing: 1 } });
  await waitFor(() => expect(screen.getByTestId("lead-row-m8")).toBeInTheDocument());
  expect(screen.getByTestId("lead-tab-results")).toHaveAttribute("aria-selected", "true");
});

test("„Nicht erschienen?“ (#1551): die Turnierleitung wählt die fehlende Seite oder verlängert", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const longName = "Aleksandra Wiśniewska-Kowalczyk 🦁 [LÖWEN-ESPORTS-AKADEMIE]";
  renderLead({
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [ENTRY], recent: [], counts: { open: 1 }, stations: [],
    attention: [{
      id: "ns-m8", kind: "no_show", title: "Nicht erschienen?", action: "no_show", match_id: "m8", station_text: "PC 4",
      label: "Halbfinale B", names: `${longName} gegen Jo`, detail: "10 Min. ab Aufruf um – kampflos werten oder verlängern.",
      participants: [{ registration_id: "r3", name: longName }, { registration_id: "r4", name: "Jo" }],
    }],
  });
  const card = await screen.findByTestId("lead-case-ns-m8");
  expect(card).toHaveTextContent("10 Min. ab Aufruf um");
  expect(screen.getByTestId("lead-no-show-r3")).toHaveTextContent(`${longName} nicht erschienen`);
  fireEvent.click(screen.getByTestId("lead-no-show-r4"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/lead/no-show/m8", { action: "confirm", registration_id: "r4" }));
  fireEvent.click(screen.getByTestId("lead-no-show-extend-ns-m8"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/lead/no-show/m8", { action: "extend", minutes: 5 }));
});

// Show-Auslosung (#1590): „Auslosung bereit · N Namen“ mit Topf, Restzeit bis zum automatischen Los und „Jetzt auslosen“.
test("Auslosung bereit: Topf mit Namen, Restzeit, „Jetzt auslosen“ nur mit Aufbau-Recht", async () => {
  // Die Browser-Uhr steht drei Minuten nach der Server-Uhr der Antwort - die Restzeit zählt von dort weiter.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T10:06:30+00:00"));
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const card = {
    id: "draw-WB:2", stage_id: "s1", stage_name: "K.-o.", group: "WB:2", label: "Runde 1", match_ids: ["m5", "m6"], match_keys: ["E", "F"],
    pot: ["NeonFalke", "Aleksandra Wiśniewska-Kowalczyk 🦁 [LÖWEN-ESPORTS-AKADEMIE]", "TurboTina", "Jo"], pot_size: 4,
    since: "2026-10-14T10:00:00+00:00", remind_minutes: 10, remind_at: "2026-10-14T10:10:00+00:00", due_at: "2026-10-14T10:20:00+00:00", can_draw: true,
  };
  renderLead({
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, now: "2026-10-14T10:03:30+00:00", matches: [ENTRY], recent: [], counts: { open: 1 },
    attention: [], stations: [], draws: [card],
  });
  expect(await screen.findByTestId("lead-tab-attention")).toHaveTextContent("Braucht Aufmerksamkeit (1)");
  const shown = screen.getByTestId("lead-draw-WB:2");
  expect(shown).toHaveTextContent("Auslosung bereit · 4 Namen");
  expect(shown).toHaveTextContent("nach Runde 1 → E, F");
  expect(screen.getByTestId("lead-draw-pot-WB:2").querySelectorAll("li")).toHaveLength(4);
  expect(screen.getByTestId("lead-draw-countdown-WB:2")).toHaveTextContent("automatisch in 14 Min.");
  fireEvent.click(screen.getByTestId("lead-draw-now-WB:2"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/stages/s1/draw", { group: "WB:2" }));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  vi.useRealTimers();
});

test("Auslosung bereit ohne Aufbau-Recht: Karte ohne Knopf; nach der Frist steht „jeden Moment“", async () => {
  const { drawCountdown } = await import("./TournamentLeadPage");
  const card = { id: "draw-LB:3", stage_id: "s1", group: "LB:3", label: "Loser Runde 2", match_keys: ["LC"], pot: ["Jo"], pot_size: 1, due_at: "2026-10-14T10:20:00+00:00", can_draw: false };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T10:25:00+00:00"));
  renderLead({ tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, now: "2026-10-14T10:25:00+00:00", matches: [], recent: [], counts: {}, attention: [], stations: [], draws: [card] });
  expect(await screen.findByTestId("lead-draw-LB:3")).toHaveTextContent("Auslosung bereit · 1 Name");
  expect(screen.queryByTestId("lead-draw-now-LB:3")).toBeNull();
  expect(screen.getByTestId("lead-draw-countdown-LB:3")).toHaveTextContent("jeden Moment");
  expect(drawCountdown(card, "2026-10-14T10:09:30+00:00", new Date("2026-10-14T10:09:30+00:00").getTime())).toBe("automatisch in 11 Min.");
  expect(drawCountdown({ due_at: null }, "2026-10-14T10:09:30+00:00")).toBe("");
  vi.useRealTimers();
});
