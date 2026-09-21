import { targetFromUrl } from "./rootNavigation";

// Wohin eine Benachrichtigung führt. Seit #301 kommt „Erfolg freigeschaltet“ sofort – der Tipp
// darauf soll bei den Erfolgen landen (#218).

jest.mock("@react-navigation/native", () => ({
  createNavigationContainerRef: () => ({ isReady: () => false, navigate: jest.fn(), getCurrentRoute: () => null }),
}));

test("der Link einer Erfolgs-Benachrichtigung öffnet den Reiter Erfolge", () => {
  expect(targetFromUrl("/profile?tab=achievements")).toEqual({ area: "profile", params: { tab: "achievements" } });
});

test("die übrigen Profil-Links bleiben, wie sie waren", () => {
  expect(targetFromUrl("/profile?tab=inbox")).toEqual({ area: "more", screen: "DirectMessages" });
  expect(targetFromUrl("/profile?tab=teams")).toEqual({ area: "teams", screen: "TeamList" });
  expect(targetFromUrl("/profile")).toEqual({ area: "profile" });
  expect(targetFromUrl("/me/prizes")).toEqual({ area: "profile", params: { tab: "prizes" } });
});
