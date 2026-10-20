import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Heute im Einsatz“ auf der Startseite (#1753): ein schmaler Streifen nur an Renn- und Spieltagen. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (u) => u }));

const { HomeTodayStrip } = await import("./HomeTodayStrip");

const LONG = "Probe Langstrecken-Meisterschaft der virtuellen Rennfahrerinnen und Rennfahrer Tirols";
const running = {
  today: "2026-11-09",
  items: [
    { lineage: { title: LONG, slug: "probe-lang", kind: "racing" }, series: { season: "2026", tier: "Liga 2", season_slug: "2026" }, game: { name: "Probespiel" },
      next: { code: "R5", club_day: "2026-11-09", state: "today", time: "20:00" }, today: true, club_count: 3, progress: { total: 8, scored: 4 } },
    { lineage: { title: "Probe Liga 4vs4", slug: "probe-liga", kind: "team_league" }, series: { season: "2026", season_slug: "2026" },
      next: { code: "ST2", club_day: "2026-11-09", state: "today", time: "19:30" }, today: true, club_count: 0 },
    { lineage: { title: "Probe Später", slug: "probe-spaeter", kind: "series" }, series: { season: "2026", season_slug: "2026" },
      next: { code: "Q3", club_day: "2026-11-16", state: "planned", time: "20:00" }, today: false },
  ],
};

function renderStrip() {
  return render(<MemoryRouter><HomeTodayStrip /></MemoryRouter>);
}

test("zeigt nur heutige Termine nacheinander, mit Runde, Uhrzeit, Vereinsleuten und Link zur Serienseite", async () => {
  apiMock.get.mockResolvedValue({ data: running });
  renderStrip();
  const strip = await screen.findByTestId("home-today");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/public/running");
  expect(strip).toHaveTextContent("Heute im Einsatz");
  const rows = screen.getAllByTestId(/^home-today-item-/);
  expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/references/series/probe-lang/2026", "/references/series/probe-liga/2026"]);
  expect(rows[0]).toHaveTextContent(LONG);
  expect(rows[0]).toHaveTextContent("Rennen R5");
  expect(rows[0]).toHaveTextContent("20:00 Uhr");
  expect(rows[0]).toHaveTextContent("3 Vereinsfahrer");
  expect(rows[1]).toHaveTextContent("Spieltag ST2");
  expect(strip).not.toHaveTextContent("Probe Später");
  // Lange Namen brechen um statt abgeschnitten zu werden.
  const title = screen.getAllByTestId("home-today-title")[0];
  expect(title.className).toMatch(/break-words/);
  expect(title.className).not.toMatch(/truncate|line-clamp/);
  // Der Puls sitzt am „Heute“ und ist Deko.
  expect(strip.querySelector(".tls-run-pulse")).toHaveAttribute("aria-hidden", "true");
});

test("ohne heutigen Termin, ohne Daten oder bei einem Fehler: kein Streifen", async () => {
  apiMock.get.mockResolvedValue({ data: { ...running, items: running.items.filter((item) => !item.today) } });
  const first = renderStrip();
  await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
  expect(screen.queryByTestId("home-today")).toBeNull();
  first.unmount();

  apiMock.get.mockRejectedValue(new Error("weg"));
  renderStrip();
  await new Promise((done) => setTimeout(done, 0));
  expect(screen.queryByTestId("home-today")).toBeNull();
});
