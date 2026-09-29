import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Reiter „Achievements“ (#619): Kopf mit Level und Titel, „Als Nächstes“ mit Link, Angeheftete mit Lösen,
// Vitrinen je Kategorie als Filter, Status- und Material-Filter, Anheften an der Stufe (bis sechs).

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f, resolveMediaUrl: (v) => v || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));

class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.callback([{ isIntersecting: true, target }], this); }
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = FakeIntersectionObserver;

const { AchievementsTab } = await import("./AchievementsTab");
const { achievementInsights } = await import("./form");

function tier(code, rank, name, extra = {}) {
  return { code, rank, level: Math.min(4, Math.ceil(rank / 2)), name, description: `${name}.`, points: 5 * rank, material: "wood", material_name: "Holz", material_color: "#A0703C",
           earned: false, current: 0, target: 10, percent: 0, manual_only: false, member_only: false, icon: "swords", ...extra };
}

const GROUPS = [
  { code: "matches_played", name: "Spielmacher", category: "match", icon: "swords", accent_color: "#29B6E8", description: "Sammle Matches.", public: true, tier_count: 3, earned_count: 2,
    tiers: [
      tier("matches_played_1", 1, "Spielmacher I", { earned: true, earned_at: "2026-09-20T10:00:00Z", current: 10, target: 10, percent: 100 }),
      tier("matches_played_2", 2, "Spielmacher II", { earned: true, earned_at: "2026-09-25T10:00:00Z", material: "iron", material_name: "Eisen", current: 25, target: 25, percent: 100 }),
      tier("matches_played_3", 3, "Spielmacher III", { material: "bronze", material_name: "Bronze", current: 60, target: 75, percent: 80 }),
    ] },
  { code: "lap_hunter", name: "Rundenjäger", category: "fastlap", icon: "flag", accent_color: "#A855F7", description: "Fahr Runden.", public: true, tier_count: 1, earned_count: 0,
    tiers: [tier("lap_hunter_1", 1, "Rundenjäger I")] },
];
const AWARDS = [
  { code: "matches_played_1", award_id: "aw1", name: "Spielmacher I", group_name: "Spielmacher", group_category: "match", material: "wood", material_name: "Holz", material_color: "#A0703C", level_name: "Holz", level_color: "#A0703C", points: 5, icon: "swords", earned_at: "2026-09-20T10:00:00Z" },
  { code: "matches_played_2", award_id: "aw2", name: "Spielmacher II", group_name: "Spielmacher", group_category: "match", material: "iron", material_name: "Eisen", material_color: "#9AA0A6", level_name: "Eisen", level_color: "#9AA0A6", points: 10, icon: "swords", earned_at: "2026-09-25T10:00:00Z" },
];
const DATA = {
  groups: GROUPS, awards: AWARDS,
  next_up: [{ code: "matches_played_3", name: "Spielmacher III", group_code: "matches_played", group_name: "Spielmacher", group_accent: "#29B6E8", category: "match", icon: "swords", material: "bronze", material_name: "Bronze", material_color: "#CD7F32", points: 20, percent: 80, current: 60, target: 75, missing: 15, how_to: "Spiel Matches in Turnieren.", link: "/tournaments", member_only: false }],
  hidden: { total: 13, earned: 1 },
  pinned: [AWARDS[1]], pinned_codes: ["matches_played_2"],
  privacy_achievements_public: true,
  level: { level: 7, xp: 1234, next_level_xp: 1500, progress: 40, title: "Anwärter", next_title_at: 10, prestige: 1, points: 1234, next_level_points: 1500 },
};

function renderTab(overrides = {}, props = {}) {
  const data = { ...DATA, ...overrides };
  const onAchDataChange = vi.fn();
  const utils = render(
    <MemoryRouter>
      <AchievementsTab achData={data} achInsights={achievementInsights(data)} completeness={{ score: 55 }} evaluateAchievements={() => {}} evaluatingAchievements={false} onAchDataChange={onAchDataChange} {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onAchDataChange };
}

beforeEach(() => {
  apiMock.put.mockReset();
  toastMock.error.mockReset();
});

describe("AchievementsTab (#619)", () => {
  it("zeigt Kopf mit Level, Titel und Prestige, die Zahlen und „Als Nächstes“ mit Link", () => {
    renderTab();
    const header = screen.getByTestId("achievement-level-header");
    expect(within(header).getByTestId("achievement-level-title")).toHaveTextContent("Level 7 · Anwärter");
    expect(within(header).getByTestId("achievement-prestige")).toBeInTheDocument();
    expect(header).toHaveTextContent("Nächster Titel ab Level 10");
    expect(within(header).getByTestId("account-level-progress")).toBeInTheDocument();
    expect(screen.getByTestId("achievement-stat-hidden")).toHaveTextContent("1/13");
    const next = screen.getByTestId("next-achievement-matches_played_3");
    expect(next).toHaveTextContent("Spielmacher III");
    expect(next).toHaveTextContent("Spiel Matches in Turnieren. Noch 15.");
    expect(next).toHaveTextContent("60/75");
    expect(within(next).getByTestId("next-achievement-link-matches_played_3")).toHaveAttribute("href", "/tournaments");
    expect(screen.getByTestId("achievement-visibility-note")).toHaveTextContent("öffentlich");
  });

  it("zeigt Angeheftete, löst eines und heftet über die Stufe ein weiteres an", async () => {
    apiMock.put.mockImplementation(async (url, body) => ({ data: { pinned_codes: body.tier_codes, pinned: AWARDS.filter((a) => body.tier_codes.includes(a.code)) } }));
    const { onAchDataChange } = renderTab();
    expect(screen.getByTestId("achievement-pinned-count")).toHaveTextContent("1 von 6");
    expect(screen.getByTestId("pinned-award-matches_played_2")).toHaveTextContent("Spielmacher II");
    expect(screen.getByTestId("achievement-pinned-hint")).toHaveTextContent("Noch 5 Plätze frei");

    fireEvent.click(screen.getByTestId("pinned-remove-matches_played_2"));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/achievements/me/pins", { tier_codes: [] }));
    await waitFor(() => expect(onAchDataChange).toHaveBeenCalled());

    // Anheften über die Stufe im Katalog: die Gruppe aufklappen, dann der Knopf an der erreichten Stufe.
    fireEvent.click(within(screen.getByTestId("achievement-group-matches_played")).getAllByRole("button")[0]);
    const pinButton = await screen.findByTestId("achievement-pin-matches_played_1");
    expect(pinButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("achievement-pin-matches_played_3")).toBeNull();
    fireEvent.click(pinButton);
    await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith("/achievements/me/pins", { tier_codes: ["matches_played_2", "matches_played_1"] }));
  });

  it("lehnt das siebte Anheften ab, ohne die API zu rufen", async () => {
    const codes = ["a", "b", "c", "d", "e", "f"];
    renderTab({ pinned_codes: codes, pinned: [] });
    fireEvent.click(within(screen.getByTestId("achievement-group-matches_played")).getAllByRole("button")[0]);
    const pinButton = await screen.findByTestId("achievement-pin-matches_played_1");
    expect(pinButton).toBeDisabled();
    expect(apiMock.put).not.toHaveBeenCalled();
  });

  it("filtert über Vitrine, Status und Material", async () => {
    renderTab();
    expect(screen.getByTestId("achievement-showcase-match")).toHaveTextContent("2 von 3");
    expect(screen.getByTestId("achievement-showcase-fastlap")).toHaveTextContent("0 von 1");
    fireEvent.click(screen.getByTestId("achievement-showcase-fastlap"));
    expect(screen.queryByTestId("achievement-group-matches_played")).toBeNull();
    expect(screen.getByTestId("achievement-group-lap_hunter")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("achievement-showcase-clear"));
    expect(screen.getByTestId("achievement-group-matches_played")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("achievement-filter-status-earned"));
    expect(screen.getByTestId("achievement-filter-count")).toHaveTextContent("1 Gruppen");
    expect(screen.queryByTestId("achievement-group-lap_hunter")).toBeNull();
    fireEvent.click(within(screen.getByTestId("achievement-group-matches_played")).getAllByRole("button")[0]);
    expect(await screen.findByTestId("achievement-tier-matches_played_1")).toBeInTheDocument();
    expect(screen.queryByTestId("achievement-tier-matches_played_3")).toBeNull();

    fireEvent.click(screen.getByTestId("achievement-filter-status-progress"));
    expect(await screen.findByTestId("achievement-tier-matches_played_3")).toBeInTheDocument();
    expect(screen.queryByTestId("achievement-tier-matches_played_1")).toBeNull();

    fireEvent.change(screen.getByTestId("achievement-filter-material"), { target: { value: "gold" } });
    expect(screen.getByTestId("achievements-empty")).toHaveTextContent("Nichts passt zu diesem Filter.");
    fireEvent.click(screen.getByTestId("achievement-filter-reset"));
    expect(screen.getByTestId("achievement-group-lap_hunter")).toBeInTheDocument();
  });

  it("weist auf private Erfolge hin", () => {
    renderTab({ privacy_achievements_public: false });
    expect(screen.getByTestId("achievement-visibility-note")).toHaveTextContent("privat");
  });
});

describe("AchievementsTab – Teilen (#619)", () => {
  it("bietet Teilen an erreichten Stufen und kopiert ohne Web Share den Link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderTab();
    fireEvent.click(within(screen.getByTestId("achievement-group-matches_played")).getAllByRole("button")[0]);
    const shareButton = await screen.findByTestId("achievement-share-matches_played_2");
    expect(screen.queryByTestId("achievement-share-matches_played_3")).toBeNull();
    fireEvent.click(shareButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/achievements/a/aw2`));
  });

  it("teilt nichts, solange die Erfolge privat sind", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderTab({ privacy_achievements_public: false });
    fireEvent.click(within(screen.getByTestId("achievement-group-matches_played")).getAllByRole("button")[0]);
    fireEvent.click(await screen.findByTestId("achievement-share-matches_played_1"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
  });
});
