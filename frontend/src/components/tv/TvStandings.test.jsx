import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Folie „Tabelle“ (#2121): 64 Spieler in acht Gruppen passen mit normaler Schrift auf ein Bild; mit großer Schrift
// blättert die Folie je Durchgang weiter, statt Zeilen abzuschneiden. Erfundene Namen.

const apiMock = { get: vi.fn(async () => ({ data: { settings: {} } })) };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));

const { TvScreen } = await import("./TvScreen");
const { TvStandingsSlide } = await import("./TvStandings");

const groups = "abcdefgh".split("").map((key, group) => ({
  group: { id: `g-${key}`, group_key: key },
  standings: Array.from({ length: 8 }, (_, index) => ({
    registration_id: `r-${group}-${index}`, display_name: `Spieler ${group * 8 + index + 1}`, rank: index + 1,
    played: 1, won: 1, drawn: 0, lost: 0, score_diff: 1, points: 3,
  })),
}));

function renderSlide(query, turn = 0) {
  return render(
    <MemoryRouter initialEntries={[`/display/bracket/t1${query}`]}>
      <TvScreen><TvStandingsSlide standings={groups} turn={turn} /></TvScreen>
    </MemoryRouter>,
  );
}

test("acht Gruppen mit normaler Schrift: alle auf einem Bild, ohne S/U/N", async () => {
  renderSlide("");
  const slide = await screen.findByTestId("tv-standings-slide");
  expect(slide.querySelectorAll("[data-testid^='tv-standings-group-']")).toHaveLength(8);
  expect(slide).not.toHaveAttribute("data-page");
  expect(slide).toHaveAttribute("data-compact", "1");
});

test("große Schrift: weniger Gruppen je Bild, der nächste Durchgang zeigt die nächsten", async () => {
  const { unmount } = renderSlide("?text_size=large");
  const slide = await screen.findByTestId("tv-standings-slide");
  expect(slide).toHaveAttribute("data-page", "1/4");
  expect(screen.getByTestId("tv-standings-group-g-a")).toBeInTheDocument();
  expect(screen.queryByTestId("tv-standings-group-g-c")).toBeNull();
  unmount();
  renderSlide("?text_size=large", 1);
  expect((await screen.findByTestId("tv-standings-slide"))).toHaveAttribute("data-page", "2/4");
  expect(screen.getByTestId("tv-standings-group-g-c")).toBeInTheDocument();
});
