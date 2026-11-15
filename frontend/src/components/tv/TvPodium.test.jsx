import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { podiumPlaces } from "@/lib/tvPodium";

// Sieger-Moment beim Saisonabschluss (#2410): mit Belohnungen das Podest Platz 1 bis 3 mit Team, Liga N und Season und je Platz der
// Grafik der Hauptbelohnung; ohne Belohnung die Karte wie bisher. Ruhendes und nicht Öffentliches kommt nie aufs Podest. Mit „Bewegung
// reduzieren“ spielt keine Grafik ihre Bewegung. Erfundene Namen.

const apiMock = { get: vi.fn(async () => ({ data: { settings: {} } })) };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));

const { TvScreen } = await import("./TvScreen");
const { TvChampionCard } = await import("./TvMoments");

const REGS = [{ id: "r1", display_name: "Nordlicht" }, { id: "r2", display_name: "Steinbock" }, { id: "r3", display_name: "Wolkenfuchs" }];
const CHAMPION = {
  winnerId: "r1", finalMatchId: "table", score: 9, path: [], segments: [], viaLoser: false, fromTable: true,
  podium: [{ rank: 1, registrationId: "r1" }, { rank: 2, registrationId: "r2" }, { rank: 3, registrationId: "r3" }],
};
const reward = (id, kind, name, rank, extra = {}) => ({ id, kind, name, image_url: null,
  art: { place: `${rank}. Platz`, metal: { 1: "gold", 2: "silver", 3: "bronze" }[rank] }, ...extra });
const HEAD = { league: "Probe-Liga", season: "Season 3", division: "Liga 1" };
const three = {
  ...HEAD,
  places: [
    { rank: 1, registration_id: "r1", rewards: [reward("gold", "medal", "Goldmedaille", 1), reward("banner", "banner", "Meister-Banner", 1)] },
    { rank: 2, registration_id: "r2", rewards: [reward("silver", "medal", "Silbermedaille", 2)] },
    { rank: 3, registration_id: "r3", rewards: [reward("bronze", "emblem", "Bronze-Emblem", 3)] },
  ],
};

function renderCard(podium, query = "") {
  return render(
    <MemoryRouter initialEntries={[`/display/bracket/t1${query}`]}>
      <TvScreen>
        <TvChampionCard champion={CHAMPION} registrations={REGS} tournamentTitle="Herbstliga" podium={podium} />
      </TvScreen>
    </MemoryRouter>,
  );
}

test("ohne Belohnungen bleibt der Sieger-Moment wie bisher", () => {
  renderCard(null);
  const card = screen.getByTestId("tv-champion");
  expect(card).not.toHaveAttribute("data-podium");
  expect(card).toHaveTextContent("Champion");
  expect(card).toHaveTextContent("Platz 2: Steinbock");
  // Ein Podest ohne eine einzige Belohnung zählt genauso wenig.
  expect(podiumPlaces(CHAMPION, { ...HEAD, places: [{ rank: 1, registration_id: "r1", rewards: [] }] })).toBeNull();
});

test("drei Belohnungen: Platz 2, 1, 3 auf der Bühne, Liga N und Season, je Platz die Hauptbelohnung groß", () => {
  renderCard(three);
  const card = screen.getByTestId("tv-champion");
  expect(card).toHaveAttribute("data-podium", "1");
  expect(card).toHaveTextContent("Meister");
  expect(screen.getByTestId("tv-podium-line")).toHaveTextContent("Probe-Liga · Liga 1 · Season 3");
  expect(screen.getByTestId("tv-podium-winner")).toHaveTextContent("Nordlicht");
  expect([...card.querySelectorAll("[data-place]")].map((element) => element.dataset.place)).toEqual(["2", "1", "3"]);
  expect(screen.getByTestId("tv-podium-place-1")).toHaveTextContent("Nordlicht");
  expect(screen.getByTestId("tv-podium-place-2")).toHaveTextContent("Steinbock");
  expect(screen.getByTestId("tv-podium-place-3")).toHaveTextContent("Wolkenfuchs");
  // Hauptbelohnung groß, die zweite klein daneben; beschriftet mit Season und Liga N.
  const gold = screen.getByTestId("tv-podium-art-gold");
  expect(gold).toHaveClass("tls-reward--lg");
  expect(gold).toHaveAttribute("data-metal", "gold");
  expect(gold).toHaveAttribute("aria-label", "Medaille · Goldmedaille · Season 3 · Liga 1 · 1. Platz");
  expect(screen.getByTestId("tv-podium-art-banner")).toHaveClass("tls-reward--sm");
  expect(screen.getByTestId("tv-podium-place-1")).toHaveTextContent("Goldmedaille · Meister-Banner");
  expect(screen.getByTestId("tv-podium-art-bronze")).toHaveAttribute("data-metal", "bronze");
  // Die Bewegung läuft: Sockel 3, 2, 1 nacheinander, jede Grafik spielt einmal.
  expect(["3", "2", "1"].map((rank) => screen.getByTestId(`tv-podium-place-${rank}`).style.getPropertyValue("--tv-podium-at"))).toEqual(["0.3s", "0.75s", "1.2s"]);
  expect(gold).toHaveAttribute("data-play", "run");
});

test("eine Belohnung: das Podest steht, Platz 2 und 3 ohne Grafik", () => {
  renderCard({ ...HEAD, places: [three.places[0]].map((place) => ({ ...place, rewards: place.rewards.slice(0, 1) })) });
  expect(screen.getByTestId("tv-champion")).toHaveAttribute("data-podium", "1");
  expect(screen.getByTestId("tv-podium-art-gold")).toBeInTheDocument();
  expect(screen.getByTestId("tv-podium-place-2")).toHaveTextContent("Steinbock");
  expect(screen.getByTestId("tv-podium-place-2").querySelector(".tls-reward")).toBeNull();
  expect(screen.getByTestId("tv-podium-place-3").querySelector(".tls-reward")).toBeNull();
});

test("ruhende und nicht öffentliche Belohnungen kommen nicht aufs Podest - und ohne übrige bleibt die Karte wie bisher", () => {
  const hidden = {
    ...HEAD,
    places: [
      { rank: 1, registration_id: "r1", rewards: [reward("gold", "medal", "Goldmedaille", 1, { suspended: true }), reward("banner", "banner", "Meister-Banner", 1)] },
      { rank: 2, registration_id: "r2", rewards: [reward("silver", "medal", "Silbermedaille", 2, { public: false })] },
      // Ein anderes Team auf Platz 3 als im Endstand: dessen Belohnung gehört nicht zu Wolkenfuchs.
      { rank: 3, registration_id: "r9", rewards: [reward("bronze", "emblem", "Bronze-Emblem", 3)] },
    ],
  };
  const { unmount } = renderCard(hidden);
  expect(screen.queryByTestId("tv-podium-art-gold")).toBeNull();
  expect(screen.queryByTestId("tv-podium-art-silver")).toBeNull();
  expect(screen.queryByTestId("tv-podium-art-bronze")).toBeNull();
  // Die nächste Belohnung rückt als Hauptbelohnung nach.
  expect(screen.getByTestId("tv-podium-art-banner")).toHaveClass("tls-reward--lg");
  expect(screen.getByTestId("tv-podium-place-1")).not.toHaveTextContent("Goldmedaille");
  unmount();
  renderCard({ ...HEAD, places: [{ rank: 1, registration_id: "r1", rewards: [reward("gold", "medal", "Goldmedaille", 1, { suspended: true })] }] });
  expect(screen.getByTestId("tv-champion")).not.toHaveAttribute("data-podium");
});

test("„Bewegung reduzieren“: das Podest steht sofort, keine Grafik spielt ihre Bewegung", () => {
  renderCard(three, "?reduce_motion=1");
  expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off");
  expect(screen.getByTestId("tv-champion")).toHaveAttribute("data-podium", "1");
  for (const id of ["gold", "banner", "silver", "bronze"]) expect(screen.getByTestId(`tv-podium-art-${id}`)).not.toHaveAttribute("data-play");
});

test("geparkt bleibt der Meister klein in der Ecke - ohne Podest", () => {
  render(
    <MemoryRouter initialEntries={["/display/bracket/t1"]}>
      <TvScreen><TvChampionCard champion={CHAMPION} registrations={REGS} parked spot="tr" testId="tv-champion-parked" podium={three} /></TvScreen>
    </MemoryRouter>,
  );
  expect(screen.getByTestId("tv-champion-parked")).toHaveClass("tv-champion--parked");
  expect(screen.queryByTestId("tv-podium-line")).toBeNull();
});
