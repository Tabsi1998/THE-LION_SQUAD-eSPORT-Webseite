import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Ehrungen im eigenen Profil (#848): alle eigenen mit dem Hinweis, welche der Verein freigibt; der Schalter bringt sie
// aufs öffentliche Profil; ohne Verbindung oder Fähigkeit steht der Grund da.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { HonoursPanel, HonourCard, honourDay, participationLine, participationsByYear } = await import("./HonoursPanel");

const HONORARY = { kind: "honorary", kind_label: "Ehrenmitgliedschaft", title: "Ehrenmitglied", years: 0, label: "Aufbau der Jugendarbeit", given_on: "2026-05-01", publishable: true };
const MERIT = { kind: "merit", kind_label: "Verdienstnadel", title: "Verdienstnadel in Silber", years: 0, label: "", given_on: "2026-03-14", publishable: false };

beforeEach(() => {
  vi.clearAllMocks();
});

test("Tag und Karte in Worten", () => {
  expect(honourDay("2026-05-01")).toBe("01.05.2026");
  render(<ul><HonourCard honour={{ ...HONORARY, kind: "jubilee", kind_label: "Jubiläum", title: "10 Jahre Mitgliedschaft", years: 10, label: "" }} /></ul>);
  expect(screen.getByTestId("honour-card")).toHaveTextContent("Jubiläum10 Jahre MitgliedschaftVerliehen am 01.05.2026 · 10 Jahre im Verein");
});

test("alle eigenen mit Hinweis; der Schalter bringt sie aufs Profil", async () => {
  apiMock.get.mockResolvedValue({ data: { available: true, public: false, shown: 0, honours: [HONORARY, MERIT] } });
  apiMock.put.mockResolvedValue({ data: { available: true, public: true, shown: 1, honours: [HONORARY, MERIT] } });
  render(<HonoursPanel />);
  const cards = await screen.findAllByTestId("honour-card");
  expect(cards[0]).toHaveTextContent("Darf aufs Profil");
  expect(cards[1]).toHaveTextContent("Nur für dich – der Verein gibt sie nicht frei");
  const toggle = screen.getByTestId("honours-public");
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(toggle);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/me/honours/public", { on: true }));
  await waitFor(() => expect(screen.getByTestId("honours-public")).toHaveAttribute("aria-checked", "true"));
  expect(screen.getByTestId("honours-panel")).toHaveTextContent("Gerade öffentlich: 1");
  expect(toastMock.success).toHaveBeenCalledWith("Deine Ehrungen stehen jetzt auf deinem Profil.");
});

test("ohne Fähigkeit der Grund, ohne Ehrung ein klarer Satz", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "no_capability", text: "Deine Verbindung erlaubt die Mitgliederakte noch nicht.", public: false, honours: [] } });
  const { unmount } = render(<HonoursPanel />);
  expect(await screen.findByTestId("honours-reason")).toHaveTextContent("Mitgliederakte noch nicht");
  expect(screen.queryByTestId("honours-public")).toBeNull();
  unmount();

  apiMock.get.mockResolvedValue({ data: { available: true, public: false, honours: [] } });
  render(<HonoursPanel />);
  expect(await screen.findByTestId("honours-empty")).toHaveTextContent("noch keine Ehrung");
});

// Eigene Teilnahmen (#906): unter den Ehrungen, nach Jahr, mit Herkunft in Worten - nur für die Person selbst.
const CUP = { kind: "competition", kind_label: "Wettbewerb", title: "Sommer-Cup", day: "2026-07-12", hours: null, source: "api", source_label: "von der Website gemeldet" };
const SHIFT = { kind: "shift", kind_label: "Helferdienst", title: "Sommerfest – Ausschank", day: "2026-07-04", hours: 3.5, source: "shift", source_label: "Helferdienst" };
const XMAS = { kind: "event", kind_label: "Veranstaltung", title: "Weihnachtsfeier", day: "2025-12-19", hours: 2.5, source: "dolibarr", source_label: "vom Verein eingetragen" };

test("Teilnahme in einer Zeile, Gruppen je Jahr", () => {
  expect(participationLine(SHIFT)).toBe("04.07.2026 · Helferdienst · 3,5 Std. · Helferdienst");
  expect(participationLine(CUP)).toBe("12.07.2026 · Wettbewerb · von der Website gemeldet");
  expect(participationsByYear([CUP, SHIFT, XMAS]).map((group) => [group.year, group.rows.length])).toEqual([["2026", 2], ["2025", 1]]);
  expect(participationsByYear(undefined)).toEqual([]);
});

test("Meine Teilnahmen unter den Ehrungen; scheitert nur dieser Teil, steht der Grund da", async () => {
  apiMock.get.mockResolvedValue({ data: { available: true, public: false, honours: [HONORARY], participations: [CUP, SHIFT, XMAS], participations_text: "" } });
  const { unmount } = render(<HonoursPanel />);
  expect(await screen.findByTestId("participations-2026")).toHaveTextContent("2026 · 2 Teilnahmen");
  expect(screen.getByTestId("participations-2025")).toHaveTextContent("2025 · 1 TeilnahmeWeihnachtsfeier19.12.2025 · Veranstaltung · 2,5 Std. · vom Verein eingetragen");
  expect(screen.getAllByTestId("participation-row")).toHaveLength(3);
  expect(screen.getByTestId("honours-panel")).toHaveTextContent("Ehrenmitglied");
  unmount();

  apiMock.get.mockResolvedValue({ data: { available: true, public: false, honours: [HONORARY], participations: [], participations_text: "Deine Teilnahmen sind gerade nicht lesbar (Zeitüberschreitung)." } });
  const second = render(<HonoursPanel />);
  expect(await screen.findByTestId("participations-reason")).toHaveTextContent("gerade nicht lesbar");
  expect(screen.getAllByTestId("honour-card")).toHaveLength(1);
  second.unmount();

  apiMock.get.mockResolvedValue({ data: { available: true, public: false, honours: [], participations: [] } });
  const third = render(<HonoursPanel />);
  expect(await screen.findByTestId("participations-empty")).toHaveTextContent("noch keine Teilnahme");
  third.unmount();

  // Ohne Verbindung zur Akte: nur der Grund, keine leere Teilnahmen-Liste.
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "not_bound", text: "Dafür muss dein Konto verbunden sein.", public: false, honours: [], participations: [] } });
  render(<HonoursPanel />);
  expect(await screen.findByTestId("honours-reason")).toBeInTheDocument();
  expect(screen.queryByTestId("participations-panel")).toBeNull();
});
