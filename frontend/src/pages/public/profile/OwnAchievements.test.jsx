import { render, screen, waitFor } from "@testing-library/react";

// Eigene Erfolge (#1296, wie in der App): erst auswerten, dann die Erfolge laden - der Abruf der Vollständigkeit vergibt
// nichts mehr, sonst stand nach dem Anmelden kurz der alte Stand da (Level 5 statt 9). Einmal je Öffnen.

const calls = [];
const apiMock = {
  get: vi.fn(async (path) => {
    calls.push(`get ${path}`);
    if (path === "/achievements/me") return { data: { groups: [], awards: [] } };
    return { data: { score: 80, missing: [] } };
  }),
  post: vi.fn(async (path) => {
    calls.push(`post ${path}`);
    return { data: { newly_awarded: 0 } };
  }),
};
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/achievements/ceremony/queue", () => ({ enqueueCeremony: vi.fn() }));
vi.mock("@/components/achievements/ceremony/select", () => ({ describePackage: vi.fn() }));
vi.mock("@/pages/user/profile/AchievementsTab", () => ({ AchievementsTab: ({ achData }) => <div data-testid="own-tab">{achData ? "geladen" : "lädt"}</div> }));
vi.mock("@/pages/user/profile/form", () => ({ achievementInsights: () => null }));

const { OwnAchievements } = await import("./OwnProfileParts");

test("erst die Auswertung, dann die Erfolge - die Vollständigkeit lädt daneben, die Auswertung läuft einmal", async () => {
  calls.length = 0;
  render(<OwnAchievements />);
  await waitFor(() => expect(screen.getByTestId("own-tab")).toHaveTextContent("geladen"));
  expect(calls.indexOf("post /achievements/evaluate")).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("post /achievements/evaluate")).toBeLessThan(calls.indexOf("get /achievements/me"));
  expect(calls).toContain("get /users/me/profile-completeness");
  expect(calls.filter((entry) => entry === "post /achievements/evaluate")).toHaveLength(1);
});
