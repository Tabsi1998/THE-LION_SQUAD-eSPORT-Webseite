import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Dashboard-Kachel „Deine Erfolge“ (#619): Level mit Titel und Sternen, „Als Nächstes“, letzte Freischaltung.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { AchievementsTile } = await import("./AchievementsTile");

const SUMMARY = {
  level: { level: 12, xp: 4000, next_level_xp: 4600, progress: 30, title: "Kämpfer", prestige: 2 },
  next_up: { code: "matches_played_3", name: "Spielmacher III", current: 60, target: 75, group_accent: "#29B6E8" },
  last_award: { code: "matches_played_2", name: "Spielmacher II", material_name: "Eisen", material_color: "#9AA0A6", icon: "swords" },
  count: 2, points: 15, hidden: { total: 13, earned: 0 },
};

describe("AchievementsTile", () => {
  it("zeigt Level, Sterne, Als Nächstes und die letzte Freischaltung", async () => {
    apiMock.get.mockResolvedValue({ data: SUMMARY });
    render(<MemoryRouter><AchievementsTile /></MemoryRouter>);
    expect(await screen.findByTestId("dashboard-achievements-level")).toHaveTextContent("Level 12");
    const tile = screen.getByTestId("dashboard-achievements");
    expect(tile).toHaveAttribute("href", "/profile?tab=achievements");
    expect(tile).toHaveTextContent("Kämpfer");
    expect(screen.getByTestId("dashboard-achievements-prestige").querySelectorAll("svg")).toHaveLength(2);
    expect(screen.getByTestId("dashboard-achievements-count")).toHaveTextContent("2 Erfolge · 15 Pkt.");
    expect(screen.getByTestId("dashboard-achievements-next")).toHaveTextContent("Spielmacher III");
    expect(screen.getByTestId("dashboard-achievements-next")).toHaveTextContent("60/75");
    expect(screen.getByTestId("dashboard-achievements-last")).toHaveTextContent("Spielmacher II");
    expect(screen.getByTestId("dashboard-achievements-last")).toHaveTextContent("Eisen");
    expect(apiMock.get).toHaveBeenCalledWith("/achievements/me/summary");
  });

  it("bleibt ohne Freischaltung freundlich und ohne Antwort ein Link", async () => {
    apiMock.get.mockResolvedValueOnce({ data: { ...SUMMARY, next_up: null, last_award: null, count: 0, points: 0 } });
    render(<MemoryRouter><AchievementsTile /></MemoryRouter>);
    expect(await screen.findByTestId("dashboard-achievements-empty")).toHaveTextContent("Noch keine Freischaltung");
    expect(screen.queryByTestId("dashboard-achievements-next")).toBeNull();

    apiMock.get.mockRejectedValueOnce(new Error("offline"));
    render(<MemoryRouter><AchievementsTile /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId("dashboard-achievements")).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId("dashboard-achievements")[1]).toHaveTextContent("Achievements"));
  });
});
