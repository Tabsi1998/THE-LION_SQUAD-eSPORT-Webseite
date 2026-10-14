import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
// TV-Bäume aus dem echten Generator und den echten Routen (scripts/make_tv_bracket_fixture.py).
import TVG from "../../../e2e/fixtures/tvGenerated.json";

// Ergebnis-Karte am Beamer (#1564): die Plätze kommen gestaffelt, die Zahlen zählen hoch; mit „Bewegung reduzieren“
// stehen sie sofort da. Kampflos und korrigiert sagen es vorn.

const apiMock = { get: vi.fn(async () => ({ data: { settings: {} } })) };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));

const { TvScreen } = await import("./TvScreen");
const { TvResultCard } = await import("./TvMoments");

const state = (name) => structuredClone(TVG[name]);

function renderCard(query, props = {}) {
  const bracket = state("ffa16_round1");
  const match = bracket.matches_v2.find((row) => row.match_key === "A");
  render(
    <MemoryRouter initialEntries={[`/display/bracket/t1${query}`]}>
      <TvScreen>
        <TvResultCard match={match} matches={bracket.matches_v2} registrations={bracket.registrations} {...props} />
      </TvScreen>
    </MemoryRouter>,
  );
  return match;
}

test("die Plätze kommen gestaffelt - jede Zeile trägt ihre Nummer für den Versatz", () => {
  const match = renderCard("");
  const rows = [...screen.getByTestId("tv-result-card").querySelectorAll(".tv-result__row")];
  expect(rows).toHaveLength(match.results.length);
  expect(rows.map((row) => row.style.getPropertyValue("--tv-i"))).toEqual(rows.map((_, index) => String(index)));
});

test("die Punkte zählen hoch und stehen am Ende auf dem Ergebnis", async () => {
  const match = renderCard("");
  const best = match.results.find((row) => row.rank === 1);
  const score = screen.getByTestId(`tv-result-score-${best.registration_id}`);
  expect(score).toHaveAttribute("data-count", "up");
  await waitFor(() => expect(score).toHaveTextContent(`${best.score} Pkt.`), { timeout: 3000 });
});

test("„Bewegung reduzieren“: die Punkte stehen sofort da, nichts zählt", async () => {
  const match = renderCard("?reduce_motion=1");
  const best = match.results.find((row) => row.rank === 1);
  const score = screen.getByTestId(`tv-result-score-${best.registration_id}`);
  expect(score).toHaveTextContent(`${best.score} Pkt.`);
  expect(score).not.toHaveAttribute("data-count");
});
