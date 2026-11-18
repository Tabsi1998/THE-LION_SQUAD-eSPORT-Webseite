import React from "react";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { openLink } from "../../lib/openLink";
import { LeagueOverallStanding } from "./LeagueOverallStanding";
import { RankBanners } from "./RankBanners";
import { EmblemRow, TrophyCabinet } from "./TrophyCabinet";

// Trophäen, Embleme, Rankingbanner und Platz in der Gesamtwertung (#2173, Web: TrophyCabinet, EmblemRow, RankBannerCopy,
// LeagueOverallStanding - #2425, #2215). Erfundene Namen.

jest.mock("../../lib/api", () => ({ resolveMediaUrl: (url: string) => `https://api.example${url}` }));
jest.mock("../../lib/openLink", () => ({ openLink: jest.fn(() => "screen") }));
jest.mock("../MediaImage", () => ({ MediaImage: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

beforeEach(() => jest.clearAllMocks());

const cup = (id: string, rank: number, game = "Rocket League", date = "2026-03-14T18:00:00Z") => ({
  id, kind: rank <= 3 ? "trophy" : "banner", rank, rank_label: `${rank}. Platz`, date, game: { name: game },
  tournament: { id: `t-${id}`, slug: `cup-${id}`, title: `Cup ${id}` },
});
const reward = (id: string, kind: string, name: string) => ({
  id, kind: "trophy", rank: 1, rank_label: "1. Platz", date: "2026-11-12T20:00:00Z", game: { name: "Call of Duty" },
  tournament: { id: "staffel", title: "CoD-Liga · Season 1" }, league: { division_label: "Liga 1", staffel: "A" },
  reward: { kind, name, art: { season: "Season 1", place: "1. Platz", metal: "gold" } },
});

test("Vitrine: Karten mit Art, Wettbewerb, Platz und Datum; Antippen führt zum Wettbewerb", async () => {
  await render(<TrophyCabinet awards={[cup("a", 1), reward("m", "medal", "Goldmedaille")] as never} empty="leer" />);
  expect(screen.getByTestId("trophy-name-m")).toHaveTextContent("Goldmedaille");
  expect(screen.getByTestId("trophy-competition-m")).toHaveTextContent("CoD-Liga · Season 1 · Liga 1 · Staffel A");
  expect(screen.getByTestId("trophy-place-a")).toHaveTextContent("1. Platz");
  expect(screen.getByText("14.3.2026")).toBeTruthy();
  expect(screen.getByTestId("trophy-cabinet-count")).toHaveTextContent("2 Trophäen");
  await fireEvent.press(screen.getByTestId("trophy-open-a"));
  expect(openLink).toHaveBeenCalledWith("/tournaments/cup-a");
  // Ohne Besitz keine Knöpfe zum Wählen.
  expect(screen.queryByTestId("trophy-banner-a")).toBeNull();
  expect(screen.queryByTestId("trophy-emblem-m")).toBeNull();
});

test("Filter nach Art, Spiel, Season und Platz - nur, was vorkommt; Zählen und Zurücksetzen", async () => {
  const awards = [cup("a", 1), cup("b", 9, "FIFA", "2025-05-01T10:00:00Z"), reward("m", "medal", "Goldmedaille")];
  await render(<TrophyCabinet awards={awards as never} empty="leer" />);
  expect(screen.getByTestId("trophy-cabinet-kind-trophy")).toBeTruthy();
  expect(screen.getByTestId("trophy-cabinet-game-FIFA")).toBeTruthy();
  expect(screen.getByTestId("trophy-cabinet-period-2025")).toBeTruthy();
  expect(screen.getByTestId("trophy-cabinet-place-other")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("trophy-cabinet-kind-medal"));
  expect(screen.getByTestId("trophy-cabinet-count")).toHaveTextContent("1 von 3");
  expect(screen.queryByTestId("trophy-card-a")).toBeNull();
  await fireEvent.press(screen.getByTestId("trophy-cabinet-game-FIFA"));
  expect(screen.getByTestId("trophy-cabinet-no-match")).toHaveTextContent(/Keine Trophäe passt zu diesem Filter./);
  await fireEvent.press(screen.getByTestId("trophy-cabinet-no-match-reset"));
  expect(screen.getByTestId("trophy-cabinet-count")).toHaveTextContent("3 Trophäen");
  expect(screen.queryByTestId("trophy-cabinet-reset")).toBeNull();
  // Eine einzige Art, ein Spiel, eine Season, ein Platz: keine Filter.
  await render(<TrophyCabinet awards={[cup("a", 1)] as never} empty="leer" />);
  expect(screen.queryByTestId("trophy-cabinet-kind")).toBeNull();
  expect(screen.queryByTestId("trophy-cabinet-game")).toBeNull();
  await render(<TrophyCabinet awards={[]} empty="Noch keine Trophäen." />);
  expect(screen.getByTestId("trophy-cabinet-empty")).toHaveTextContent("Noch keine Trophäen.");
});

test("Besitzer: Banner, Titel und bis zu drei Embleme - der vierte ist gesperrt und sagt warum", async () => {
  const onFeature = jest.fn();
  const onTitle = jest.fn();
  const onEmblems = jest.fn();
  const awards = [cup("a", 1), reward("t", "title", "Meister"), reward("e1", "emblem", "Wappen"), reward("e2", "emblem", "Schild"), reward("m", "medal", "Gold"), reward("m2", "medal", "Silber")];
  const owner = { featuredId: "a", titleId: null, emblemIds: ["e1", "e2", "m"], onFeature, onTitle, onEmblems, emblemHint: "Bis zu drei neben deinem Namen." };
  await render(<TrophyCabinet awards={awards as never} empty="leer" owner={owner} />);
  expect(screen.getByTestId("trophy-cabinet-emblem-hint")).toHaveTextContent("Bis zu drei neben deinem Namen. 3 von 3 gewählt.");
  expect(screen.getByTestId("trophy-banner-a")).toHaveTextContent("Banner ✓");
  await fireEvent.press(screen.getByTestId("trophy-banner-a"));
  expect(onFeature).toHaveBeenCalledWith(null);
  await fireEvent.press(screen.getByTestId("trophy-title-t"));
  expect(onTitle).toHaveBeenCalledWith("t");
  // Titel nur bei der Art „Titel“, Embleme nur bei Emblem und Medaille.
  expect(screen.queryByTestId("trophy-title-e1")).toBeNull();
  expect(screen.queryByTestId("trophy-emblem-t")).toBeNull();
  expect(screen.queryByTestId("trophy-emblem-a")).toBeNull();
  expect(screen.getByTestId("trophy-emblem-e2")).toHaveTextContent("Emblem 2 ✓");
  await fireEvent.press(screen.getByTestId("trophy-emblem-e2"));
  expect(onEmblems).toHaveBeenLastCalledWith(["e1", "m"]);
  const fourth = screen.getByTestId("trophy-emblem-m2");
  expect(fourth.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  expect(fourth.props.accessibilityHint).toBe("Höchstens 3 Embleme – nimm zuerst eines weg.");
  expect(screen.getByTestId("trophy-emblem-full-m2")).toHaveTextContent("Höchstens 3 Embleme – nimm zuerst eines weg.");
  onEmblems.mockClear();
  await fireEvent.press(fourth);
  expect(onEmblems).not.toHaveBeenCalled();
  // Während gespeichert wird, nimmt kein Knopf einen Tipp an.
  await render(<TrophyCabinet awards={awards as never} empty="leer" owner={{ ...owner, busy: true }} />);
  expect(screen.getByTestId("trophy-title-t").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true, busy: true }));
  await fireEvent.press(screen.getByTestId("trophy-title-t"));
  expect(onTitle).toHaveBeenCalledTimes(1);
});

test("Tippflächen mindestens 48 Punkte: Filter und Wahl-Knöpfe", async () => {
  const { StyleSheet } = jest.requireActual("react-native");
  await render(<TrophyCabinet awards={[cup("a", 1), reward("e", "emblem", "Wappen")] as never} empty="leer" owner={{ emblemIds: [], onEmblems: jest.fn() }} />);
  for (const id of ["trophy-cabinet-kind-all", "trophy-cabinet-kind-emblem", "trophy-emblem-e"]) {
    const style = StyleSheet.flatten(screen.getByTestId(id).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.minWidth).toBeGreaterThanOrEqual(48);
  }
});

test("Embleme neben dem Namen: höchstens drei, nur Belohnungen - ohne Feld (ältere Server) nichts", async () => {
  await render(<EmblemRow emblems={[reward("e1", "emblem", "Wappen"), reward("e2", "medal", "Gold")] as never} />);
  expect(screen.getByTestId("featured-emblems").props.accessibilityLabel).toBe("Embleme: Wappen, Gold");
  expect(screen.getByTestId("featured-emblems-e1")).toBeTruthy();
  await render(<EmblemRow emblems={undefined} />);
  expect(screen.queryByTestId("featured-emblems")).toBeNull();
  await render(<EmblemRow emblems={[cup("a", 1)] as never} />);
  expect(screen.queryByTestId("featured-emblems")).toBeNull();
});

test("Rankingbanner: Vorschau, Link kopieren mit Haken, teilen - ohne Einträge nichts", async () => {
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
  const rows = [{ key: "s1", league: "CoD-Liga", season: "Season 1", name: "Löwen", division: "Liga 1", staffel: "A", image_url: "/api/leagues/cod/season-1/teams/q1/banner.png" }];
  await render(<RankBanners rows={rows} />);
  expect(screen.getByText("CoD-Liga · Season 1")).toBeTruthy();
  expect(screen.getByText("Löwen · Liga 1 · Staffel A")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("team-rank-banners-s1-copy"));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith("https://api.example/api/leagues/cod/season-1/teams/q1/banner.png");
  await waitFor(() => expect(screen.getByTestId("team-rank-banners-s1-copy")).toHaveTextContent("Kopiert"));
  expect(screen.queryByTestId("team-rank-banners-s1-copy-failed")).toBeNull();
  await fireEvent.press(screen.getByTestId("team-rank-banners-s1-share"));
  expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://api.example/api/leagues/cod/season-1/teams/q1/banner.png" }));
  share.mockRestore();
  // Kopieren scheitert: kein Haken, stattdessen der Weg übers Teilen.
  (Clipboard.setStringAsync as jest.Mock).mockResolvedValueOnce(false);
  await render(<RankBanners rows={rows} />);
  await fireEvent.press(screen.getByTestId("team-rank-banners-s1-copy"));
  await waitFor(() => expect(screen.getByTestId("team-rank-banners-s1-copy-failed")).toHaveTextContent("Kopieren ging nicht – teile den Link stattdessen."));
  expect(screen.getByTestId("team-rank-banners-s1-copy")).toHaveTextContent("Rankingbanner kopieren");
  (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error("kein Zugriff"));
  await fireEvent.press(screen.getByTestId("team-rank-banners-s1-copy"));
  await waitFor(() => expect(screen.getByTestId("team-rank-banners-s1-copy-failed")).toBeTruthy());
  expect(screen.getByTestId("team-rank-banners-s1-copy")).toHaveTextContent("Rankingbanner kopieren");
  await render(<RankBanners rows={undefined} />);
  expect(screen.queryByTestId("team-rank-banners")).toBeNull();
});

test("Platz in der Gesamtwertung: Gesamtsieger nur bei Endstand mit ganzer Sicht, Weg zur Gesamtwertung", async () => {
  const rows = [
    { league_name: "CoD-Liga", period_name: "2027", division_label: "Liga 1", level: 1, place: 1, of: 8, points: 24, closed: true, complete: true, url: "/liga/cod/season-2/gesamtwertung", name: "Löwen" },
    { league_name: "CoD-Liga", period_name: "2026", division_label: "Liga 2", level: 2, place: 1, of: 6, points: 18, closed: true, complete: false, url: null },
    { league_name: "FIFA-Liga", period_name: "2027", division_label: "Liga 1", level: 1, place: 3, of: 5, points: 1, closed: false, complete: false, url: null },
  ];
  await render(<LeagueOverallStanding rows={rows} showTeam />);
  expect(screen.getByTestId("league-overall-winner-0")).toHaveTextContent("Gesamtsieger");
  expect(screen.queryByTestId("league-overall-winner-1")).toBeNull();
  expect(screen.getByTestId("league-overall-state-0")).toHaveTextContent("Liga 1 · Löwen · Endstand");
  expect(screen.getByTestId("league-overall-state-1")).toHaveTextContent("Liga 2 · Endstand ohne nicht öffentliche Seasons");
  expect(screen.getByTestId("league-overall-state-2")).toHaveTextContent("Liga 1 · laufend");
  expect(screen.getByText("1 Punkt")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("league-overall-open-0"));
  expect(openLink).toHaveBeenCalledWith("/liga/cod/season-2/gesamtwertung");
  expect(screen.queryByTestId("league-overall-open-1")).toBeNull();
  await render(<LeagueOverallStanding rows={undefined} />);
  expect(screen.queryByTestId("league-overall")).toBeNull();
});

test("vereinsintern (#2516): eine interne Trophäe trägt das Etikett, an Profil und Team gleich", async () => {
  await render(<TrophyCabinet awards={[{ ...cup("int", 1), internal: true }, cup("pub", 2)] as never} empty="leer" />);
  expect(screen.getByTestId("internal-tag-trophy-int")).toHaveTextContent("Vereinsintern");
  expect(screen.queryByTestId("internal-tag-trophy-pub")).toBeNull();
});

test("vereinsintern (#2516): das Label der Karte nennt es dem Screenreader - mit und ohne Link", async () => {
  const linked = { ...cup("int", 1), internal: true };
  const plain = { ...cup("ohne", 2), internal: true, tournament: { id: "t-ohne", title: "Cup ohne" } };
  await render(<TrophyCabinet awards={[linked, plain, cup("pub", 3)] as never} empty="leer" />);
  expect(screen.getByTestId("trophy-open-int").props.accessibilityLabel).toBe("Cup int – 1. Platz – vereinsintern – zum Wettbewerb");
  expect(screen.getByTestId("trophy-static-ohne").props.accessibilityLabel).toBe("Cup ohne – 2. Platz – vereinsintern");
  expect(screen.getByTestId("trophy-open-pub").props.accessibilityLabel).toBe("Cup pub – 3. Platz – zum Wettbewerb");
});
