import { act, render, screen, waitFor, within } from "@testing-library/react";

// Saison-Fundstücke im Profil (#678): je Saison eine Karte - die laufende zuerst, mit dem Stand von heute und dem
// Tagesdeckel; leere Fundstücke sind blass; ohne alles ein erklärender Satz; nach einem neuen Fundstück lädt die Karte
// von selbst nach; ein Fehler beim Laden steht in Worten da.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { REFRESH_AFTER_SIGNAL_MS, SeasonFindsPanel, dayText, orderSeasons, seasonHint } = await import("./SeasonFindsPanel");
const { FIND_ICONS, FindIcon } = await import("./SeasonFindIcons");

function item(signal, icon, label, overrides = {}) {
  return { signal, icon, label, count: 0, season_count: 0, today: 0, per_day: 30, first_at: null, last_at: null, ...overrides };
}

const VIEW = {
  total: 95,
  now: "2026-10-30T20:00:00+01:00",
  seasons: [
    { key: "halloween", label: "Halloween", active: true, count: 35, next_start: null, ends_at: "2026-11-01T23:59:59+01:00", items: [
      item("halloween_bats_scared", "bat", "Fledermäuse verscheucht", { count: 32, season_count: 12, today: 4 }),
      item("halloween_ghosts_freed", "ghost", "Geister befreit", { count: 2, season_count: 2, today: 2, per_day: 20 }),
      item("halloween_cat_petted", "cat", "Katze angestupst", { per_day: 10 }),
      item("halloween_pumpkin", "pumpkin", "Gruselnächte erlebt", { count: 1, season_count: 1, today: 1, per_day: 1 }),
    ] },
    { key: "snow", label: "Winter", active: false, count: 1260, next_start: "2026-11-29T00:00:00+01:00", ends_at: null, items: [item("snowflakes_clicked", "snowflake", "Schneeflocken gefangen", { count: 1260, season_count: 60, per_day: 200 })] },
    { key: "advent_calendar", label: "Adventkalender", active: false, count: 0, next_start: "2026-12-01T00:00:00+01:00", ends_at: null, items: [item("advent_door", "door", "Türchen geöffnet", { per_day: 24 })] },
    { key: "new_year", label: "Silvester", active: false, count: 0, next_start: "2026-12-29T18:00:00+01:00", ends_at: null, items: [item("online_at_new_year", "rocket", "Silvester um Mitternacht dabei", { per_day: 1 })] },
    { key: "easter_hunt", label: "Ostern", active: false, count: 0, next_start: "2027-03-26T00:00:00+01:00", ends_at: null, items: [item("easter_egg", "egg", "Ostereier gefunden", { per_day: 50 })] },
  ],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: VIEW });
});

afterEach(() => {
  vi.useRealTimers();
});

test("Tag, Hinweis und Reihenfolge: laufende Saison zuerst, dann die mit Fundstücken, dann der Rest", () => {
  expect(dayText("2026-11-01T23:59:59+01:00")).toBe("01.11.");
  expect(dayText("2026-12-31T23:30:00Z")).toBe("01.01.");
  expect(dayText("")).toBe("");
  expect(dayText("kaputt")).toBe("");
  expect(seasonHint({ active: true, ends_at: "2026-11-01T23:59:59+01:00" })).toBe("läuft bis 01.11.");
  expect(seasonHint({ active: true })).toBe("läuft gerade");
  expect(seasonHint({ active: false, next_start: "2026-11-29T00:00:00+01:00" })).toBe("ab 29.11.");
  expect(seasonHint({ active: false })).toBe("");
  const mixed = [{ key: "a", count: 0 }, { key: "b", count: 5 }, { key: "c", count: 0, active: true }, { key: "d", count: 9 }];
  expect(orderSeasons(mixed).map((season) => season.key)).toEqual(["c", "b", "d", "a"]);
  expect(orderSeasons()).toEqual([]);
});

test("jedes Fundstück hat seine Figur; ein unbekanntes bekommt die Schneeflocke", () => {
  expect(FIND_ICONS).toEqual(["bat", "ghost", "cat", "pumpkin", "snowflake", "door", "rocket", "egg"]);
  FIND_ICONS.forEach((icon) => {
    const { container, unmount } = render(<FindIcon icon={icon} />);
    expect(container.querySelector(`.tls-find__figure--${icon} svg`), icon).not.toBeNull();
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    unmount();
  });
  const { container } = render(<FindIcon icon="einhorn" />);
  expect(container.querySelector(".tls-find__figure--snowflake svg")).not.toBeNull();
});

test("Karte: Summe, laufende Saison mit Stand von heute und Deckel, leere Fundstücke blass, kommende Saison mit Termin", async () => {
  render(<SeasonFindsPanel />);
  const panel = await screen.findByTestId("season-finds");
  expect(apiMock.get).toHaveBeenCalledWith("/achievements/collectibles");
  expect(screen.getByTestId("season-finds-total")).toHaveTextContent("95");
  expect(screen.queryByTestId("season-finds-empty")).toBeNull();
  const order = [...panel.querySelectorAll("section")].map((section) => section.getAttribute("data-testid"));
  expect(order).toEqual(["season-finds-halloween", "season-finds-snow", "season-finds-advent_calendar", "season-finds-new_year", "season-finds-easter_hunt"]);
  const halloween = screen.getByTestId("season-finds-halloween");
  expect(halloween.className).toContain("tls-finds__season--active");
  expect(within(halloween).getByText("läuft")).toBeInTheDocument();
  expect(screen.getByTestId("season-finds-halloween-hint")).toHaveTextContent("läuft bis 01.11.");
  const bats = screen.getByTestId("season-find-halloween_bats_scared");
  expect(bats).toHaveTextContent("32");
  expect(bats).toHaveTextContent("Fledermäuse verscheucht");
  expect(screen.getByTestId("season-find-halloween_bats_scared-today")).toHaveTextContent("heute 4 von 30");
  expect(bats.className).not.toContain("tls-find--empty");
  expect(bats.querySelector(".tls-find__today > span").style.width).toBe(`${(4 / 30) * 100}%`);
  // Ein Fundstück, das es nur einmal am Tag gibt, zeigt keinen Balken.
  expect(screen.queryByTestId("season-find-halloween_pumpkin-today")).toBeNull();
  expect(screen.getByTestId("season-find-halloween_cat_petted").className).toContain("tls-find--empty");
  // Winter läuft nicht: kein Balken, dafür der Stand der letzten Saison und der nächste Termin; große Zahlen mit Punkt.
  const flakes = screen.getByTestId("season-find-snowflakes_clicked");
  expect(flakes).toHaveTextContent("1.260");
  expect(flakes).toHaveTextContent("zuletzt 60");
  expect(screen.queryByTestId("season-find-snowflakes_clicked-today")).toBeNull();
  expect(screen.getByTestId("season-finds-snow-hint")).toHaveTextContent("ab 29.11.");
  expect(screen.getByTestId("season-finds-snow").className).not.toContain("tls-finds__season--active");
  expect(panel).toHaveTextContent("Nur du siehst diese Karte");
});

test("voller Tag: der Balken ist voll und sagt es; noch nichts gesammelt: ein erklärender Satz", async () => {
  const full = { ...VIEW, seasons: [{ ...VIEW.seasons[0], items: [item("halloween_bats_scared", "bat", "Fledermäuse verscheucht", { count: 30, season_count: 30, today: 30 })] }] };
  apiMock.get.mockResolvedValue({ data: full });
  const view = render(<SeasonFindsPanel />);
  const bats = await screen.findByTestId("season-find-halloween_bats_scared");
  expect(bats.querySelector(".tls-find__today").className).toContain("tls-find__today--full");
  expect(bats.querySelector("[title]").getAttribute("title")).toContain("morgen geht es weiter");
  view.unmount();
  apiMock.get.mockResolvedValue({ data: { total: 0, seasons: VIEW.seasons.map((season) => ({ ...season, active: false, count: 0, items: season.items.map((entry) => ({ ...entry, count: 0, season_count: 0, today: 0 })) })) } });
  render(<SeasonFindsPanel />);
  expect(await screen.findByTestId("season-finds-empty")).toHaveTextContent("Noch nichts gesammelt");
  expect(screen.getByTestId("season-finds-total")).toHaveTextContent("0");
});

test("nach einem neuen Fundstück lädt die Karte von selbst nach - gebündelt; ein Fehler beim Laden steht in Worten da", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const view = render(<SeasonFindsPanel />);
  await screen.findByTestId("season-finds");
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 5; i += 1) window.dispatchEvent(new CustomEvent("tls:season-signal", { detail: { name: "halloween_bats_scared", count: i + 1 } }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(REFRESH_AFTER_SIGNAL_MS - 200);
  });
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  view.unmount();
  window.dispatchEvent(new CustomEvent("tls:season-signal", { detail: { name: "halloween_bats_scared", count: 9 } }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(REFRESH_AFTER_SIGNAL_MS + 200);
  });
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
  apiMock.get.mockRejectedValue(new Error("Netz weg"));
  render(<SeasonFindsPanel />);
  await waitFor(() => expect(screen.getByTestId("season-finds-error")).toHaveTextContent("konnten gerade nicht geladen werden"));
});
