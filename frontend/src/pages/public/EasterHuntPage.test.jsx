import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Die Seite der Ostereiersuche (#646, #758): Zeitraum, Korb mit echten Mustern und leeren Mulden, Hinweise erst ab
// Tag zwei, Gäste werden eingeladen, Preise, die Schnellsten, Regeln - und ohne Suche der nächste Start.

const pageMock = vi.fn();
vi.mock("@/seasons/easterHunt/api", () => ({ fetchHuntPage: (...args) => pageMock(...args), onHuntProgress: () => () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useLiveChanges", () => ({ useReducedMotion: () => true }));
const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const { default: EasterHuntPage, durationLabel, phaseText } = await import("./EasterHuntPage");

const RUNNING = {
  phase: "running", year: 2027, starts_at: "2027-03-26T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00", egg_count: 4,
  prizes: [{ kind: "raffle_all", label: "TLS-Hoodie", value: "50 €", title: "Verlosung unter allen mit vollem Korb" }],
  completed: 1, fastest: [{ rank: 1, display_name: "Paula", username: "paula", duration_seconds: 3720 }],
  terms: ["Die Suche läuft von Karfreitag bis Ostermontag."], me: null,
};

function renderPage() {
  return render(<MemoryRouter><EasterHuntPage /></MemoryRouter>);
}

beforeEach(() => {
  pageMock.mockReset();
  authState.user = null;
});

test("Zeiten in Worten", () => {
  expect(durationLabel(3720)).toBe("1 Std. 2 Min.");
  expect(durationLabel(90061)).toBe("1 Tag 1 Std. 1 Min.");
  expect(durationLabel(0)).toBe("0 Min.");
  expect(phaseText({ phase: "ended" })).toBe("Die Suche ist vorbei – ausgewertet wird in Kürze.");
  expect(phaseText({ phase: "none", next_start: null })).toBe("Gerade ist keine Eiersuche geplant.");
});

test("ohne Suche: nur der nächste Start", async () => {
  pageMock.mockResolvedValue({ phase: "none", next_start: "2027-03-26T00:00:00+01:00" });
  renderPage();
  await waitFor(() => expect(screen.getByTestId("easter-phase")).toHaveTextContent("Die nächste Eiersuche beginnt am Freitag, 26. März."));
  expect(screen.queryByTestId("easter-prizes")).toBeNull();
});

test("als Gast: Einladung zum Anmelden, Preise, Schnellste und Regeln - kein Korb", async () => {
  pageMock.mockResolvedValue(RUNNING);
  renderPage();
  await waitFor(() => expect(screen.getByTestId("easter-guest")).toBeInTheDocument());
  expect(screen.getByTestId("easter-guest").querySelector("a")).toHaveAttribute("href", "/login?next=%2Fostern");
  expect(screen.getByTestId("easter-prizes")).toHaveTextContent("TLS-Hoodie");
  expect(screen.getByTestId("easter-fastest-1")).toHaveTextContent("Paula");
  expect(screen.getByTestId("easter-fastest-1")).toHaveTextContent("1 Std. 2 Min.");
  expect(screen.getByTestId("easter-terms")).toHaveTextContent("Die Suche läuft von Karfreitag bis Ostermontag.");
  expect(screen.queryByTestId("easter-basket")).toBeNull();
});

test("angemeldet: Korb mit echten Mustern und leeren Mulden; Hinweise erst ab Tag zwei", async () => {
  authState.user = { id: "u1" };
  pageMock.mockResolvedValue({ ...RUNNING, me: { active: true, found: 1, total: 4, eggs: [{ egg_no: 3, pattern: "lion", found_at: "2027-03-26T09:00:00+01:00" }], hints_open: false, hints_open_at: "2027-03-27T00:00:00+01:00", hints: [], missing: 3, completed_at: null } });
  renderPage();
  await waitFor(() => expect(screen.getByTestId("easter-basket-count")).toHaveTextContent("1 von 4"));
  expect(screen.getByTestId("easter-basket-egg-3").querySelector("svg")).toHaveAttribute("data-pattern", "lion");
  expect(screen.getAllByTestId("easter-basket-hole")).toHaveLength(3);
  expect(screen.getByTestId("easter-hints")).toHaveTextContent("Ab Samstag, 27. März gibt es zu jedem fehlenden Ei einen Hinweis.");
  expect(screen.queryByTestId("easter-guest")).toBeNull();
});

test("voller Korb: Platz und keine Hinweise mehr", async () => {
  authState.user = { id: "u1" };
  pageMock.mockResolvedValue({ ...RUNNING, me: { active: true, found: 2, total: 2, eggs: [{ egg_no: 1, pattern: "dots", found_at: "x" }, { egg_no: 2, pattern: "waves", found_at: "y" }], hints_open: true, hints: [], completed_at: "2027-03-26T10:00:00+01:00", rank: 2 }, egg_count: 2 });
  renderPage();
  await waitFor(() => expect(screen.getByTestId("easter-basket-done")).toHaveTextContent("Korb voll – Platz 2!"));
  expect(screen.queryByTestId("easter-hints")).toBeNull();
});
