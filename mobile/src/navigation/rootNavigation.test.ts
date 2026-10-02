import { navigateToUrl, targetFromUrl } from "./rootNavigation";

// Wohin eine Benachrichtigung führt. Seit #301 kommt „Erfolg freigeschaltet“ sofort – der Tipp
// darauf soll bei den Erfolgen landen (#218).

const mockRef = { ready: false, navigate: jest.fn() };
jest.mock("@react-navigation/native", () => ({
  createNavigationContainerRef: () => ({ isReady: () => mockRef.ready, navigate: (...args: unknown[]) => mockRef.navigate(...args), getCurrentRoute: () => null }),
}));

beforeEach(() => {
  mockRef.ready = false;
  mockRef.navigate.mockClear();
});

test("der Link einer Erfolgs-Benachrichtigung öffnet den Reiter Erfolge", () => {
  expect(targetFromUrl("/profile?tab=achievements")).toEqual({ area: "profile", params: { tab: "achievements" } });
});

test("die übrigen Profil-Links bleiben, wie sie waren", () => {
  expect(targetFromUrl("/profile?tab=inbox")).toEqual({ area: "more", screen: "DirectMessages" });
  expect(targetFromUrl("/profile?tab=teams")).toEqual({ area: "teams", screen: "TeamList" });
  expect(targetFromUrl("/profile")).toEqual({ area: "profile" });
  expect(targetFromUrl("/me/prizes")).toEqual({ area: "profile", params: { tab: "prizes" } });
});

// Adressen aus Inhalten (Adventkalender, #641): was die App selbst zeigen kann, öffnet sich im Screen.
test("eine Adresse der Website öffnet ihren Screen - sonst sagt die App, dass sie keinen hat", () => {
  expect(navigateToUrl("/news/advent-gruss")).toBe(false);
  expect(mockRef.navigate).not.toHaveBeenCalled();

  mockRef.ready = true;
  expect(navigateToUrl("/news/advent-gruss")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "NewsDetail", params: { id: "advent-gruss" } });
  expect(navigateToUrl("/events/weihnachts-lan")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Tournaments", { screen: "EventDetail", params: { id: "weihnachts-lan" } });
  expect(navigateToUrl("/teams/t-1")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Teams", { screen: "TeamDetail", params: { id: "t-1" } });
  expect(navigateToUrl("/me/prizes")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Profile", { tab: "prizes" });

  // Adressen ohne Kennung führen in die Liste.
  expect(navigateToUrl("/events")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Tournaments", { screen: "TournamentList", params: undefined });
  expect(navigateToUrl("/news")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "NewsList", params: undefined });
  expect(navigateToUrl("/gallery")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "Gallery", params: undefined });
  expect(navigateToUrl("/fastlap")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "FastLapList", params: undefined });
  expect(navigateToUrl("/advent")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "AdventCalendar", params: undefined });

  mockRef.navigate.mockClear();
  for (const url of ["/servers", "/about", "", null, undefined]) expect(navigateToUrl(url)).toBe(false);
  expect(mockRef.navigate).not.toHaveBeenCalled();
});
