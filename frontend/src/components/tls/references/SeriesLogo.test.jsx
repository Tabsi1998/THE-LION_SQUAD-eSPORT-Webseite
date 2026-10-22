import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(() => Promise.resolve({ data: {} })) }, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/SmartLogo", () => ({ SmartLogo: ({ src, className }) => <img data-smart-logo="true" src={src} alt="" className={className} /> }));

import { RunningSeries } from "@/components/tls/references/RunningSeries";
import { SeriesPaths } from "@/components/tls/references/SeriesPaths";
import { Chronicle } from "@/components/tls/references/Chronicle";
import { PartnerSeries } from "@/components/tls/PartnerSeries";
import { RoundHead } from "@/components/tls/series/RoundResults";
import { linkedSeasons } from "@/lib/referencesOverview";
import { SeriesLogoField } from "@/pages/admin/referenceSeries/SeriesLogoField";

// Logo je Spur und Saison (#2014) an allen Stellen der Website - nur erfundene Daten. Gezeigt wie hochgeladen: keine
// Klasse, die einfärbt (#1321); ohne Logo bleibt der bisherige Rückfall.

const SPUR = "/api/static/uploads/spur.png";
const SAISON = "/api/static/uploads/saison.png";
const GAME = { name: "Probe Spiel", short_name: "PS", logo_url: "/api/static/uploads/spiel.png" };
const TINT = /grayscale|invert|brightness|opacity|sepia|hue-rotate/;

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

function runningItem(lineageLogo, seasonLogo) {
  return {
    lineage: { title: "Probe Kiwi Liga", slug: "kiwi", kind: "series", logo_url: lineageLogo },
    series: { season: "2026", season_slug: "2026", logo_url: seasonLogo },
    game: GAME, progress: { total: 4, scored: 1 }, next: null, club: null, today: false, organizers: [],
  };
}

describe("Läuft gerade", () => {
  it("zeigt das Logo der Saison statt des Spiel-Logos", () => {
    wrap(<RunningSeries items={[runningItem(SPUR, SAISON)]} />);
    const mark = screen.getByTestId("reference-game-logo");
    expect(mark.querySelector("img")).toHaveAttribute("src", SAISON);
  });

  it("ohne Logo bleibt das Spiel-Logo", () => {
    wrap(<RunningSeries items={[runningItem(null, null)]} />);
    expect(screen.getByTestId("reference-game-logo").querySelector("img")).toHaveAttribute("src", GAME.logo_url);
  });
});

const LINEAGES = [{
  lineage: { title: "Probe Kiwi Liga", slug: "kiwi", kind: "series", logo_url: SPUR, organizers: [] },
  seasons: [
    { season: "2025", season_slug: "2025", status: "completed", logo_url: SPUR, reference_ids: ["ref-1"], organizers: [] },
    { season: "2026", season_slug: "2026", status: "active", logo_url: SAISON, reference_ids: [], organizers: [] },
  ],
}];

describe("Serien & Ligen und Chronik", () => {
  it("die Karte der Spur trägt ihr Logo, ungefärbt", () => {
    wrap(<SeriesPaths lineages={LINEAGES} />);
    const logo = screen.getByTestId("references-lineage-logo").querySelector("img");
    expect(logo).toHaveAttribute("src", SPUR);
    expect(logo.className).not.toMatch(TINT);
  });

  it("ohne Logo der Spur das der Saison, zu der die Karte führt - ohne beides keins", () => {
    const withSeason = [{ ...LINEAGES[0], lineage: { ...LINEAGES[0].lineage, logo_url: null } }];
    const { unmount } = wrap(<SeriesPaths lineages={withSeason} />);
    expect(screen.getByTestId("references-lineage-logo").querySelector("img")).toHaveAttribute("src", SAISON);
    unmount();
    const none = [{ lineage: { ...LINEAGES[0].lineage, logo_url: null }, seasons: LINEAGES[0].seasons.map((s) => ({ ...s, logo_url: null })) }];
    wrap(<SeriesPaths lineages={none} />);
    expect(screen.queryByTestId("references-lineage-logo")).toBeNull();
  });

  it("die Chronik zeigt das Logo der Saison einer Teilnahme", () => {
    const items = [
      { id: "ref-1", title: "Probe Kiwi Liga 2025", start_date: "2025-05-01", entries: [] },
      { id: "ref-2", title: "Probe Einzelturnier", start_date: "2025-06-01", entries: [] },
    ];
    wrap(<Chronicle items={items} linked={linkedSeasons(LINEAGES)} />);
    const rows = screen.getAllByTestId("reference-row-logo");
    expect(rows).toHaveLength(1);
    expect(within(screen.getByTestId("reference-card-ref-1")).getByTestId("reference-row-logo").querySelector("img")).toHaveAttribute("src", SPUR);
  });
});

describe("Verwaltung", () => {
  it("zeigt das Logo auf hellem und dunklem Grund, ohne eigenes das der Spur", () => {
    const { unmount } = wrap(<SeriesLogoField value={SAISON} onChange={() => {}} testId="series-logo" inherited={SPUR} />);
    expect(screen.getByTestId("series-logo-light").querySelector("img")).toHaveAttribute("src", SAISON);
    expect(screen.getByTestId("series-logo-dark").querySelector("img")).toHaveAttribute("src", SAISON);
    expect(screen.queryByTestId("series-logo-inherited")).toBeNull();
    unmount();
    wrap(<SeriesLogoField value="" onChange={() => {}} testId="series-logo" inherited={SPUR} />);
    expect(screen.getByTestId("series-logo-light").querySelector("img")).toHaveAttribute("src", SPUR);
    expect(screen.getByTestId("series-logo-inherited")).toBeInTheDocument();
  });
});

describe("Partnerseite und Rundenseite", () => {
  const Title = ({ title }) => <h2>{title}</h2>;

  it("„Ligen und Serien mit uns“ trägt das Logo der Spur", () => {
    const items = [{ lineage: { title: "Probe Kiwi Liga", slug: "kiwi", kind: "series", logo_url: SPUR }, role: "organizer", running: true,
      seasons: [{ season: "2026", season_slug: "2026", running: true, logo_url: SAISON }] }];
    wrap(<PartnerSeries items={items} partnerName="Probe Feige" Title={Title} />);
    expect(screen.getByTestId("partner-series-logo").querySelector("img")).toHaveAttribute("src", SPUR);
  });

  it("der Kopf der Runde zeigt das Logo der Saison, ohne Logo keins", () => {
    const page = { round: { number: 1, code: "R1" }, lineage: { logo_url: SPUR }, series: { logo_url: SAISON } };
    const { unmount } = wrap(<RoundHead page={page} lineageSlug="kiwi" seasonSlug="2026" />);
    expect(screen.getByTestId("round-logo").querySelector("img")).toHaveAttribute("src", SAISON);
    unmount();
    wrap(<RoundHead page={{ ...page, lineage: {}, series: {} }} lineageSlug="kiwi" seasonSlug="2026" />);
    expect(screen.queryByTestId("round-logo")).toBeNull();
  });
});
