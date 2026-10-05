import { navigateToUrl, openSignIn, signInOpen, targetFromUrl } from "./rootNavigation";

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

// Gast zuerst (#918): Anmelden und Registrieren von überall - vor dem Start der Navigation passiert nichts.
test("openSignIn öffnet Anmelden oder Registrieren, sobald die Navigation steht", () => {
  expect(openSignIn()).toBe(false);
  expect(mockRef.navigate).not.toHaveBeenCalled();
  mockRef.ready = true;
  expect(openSignIn()).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Login");
  expect(openSignIn("Register")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Register");
  expect(signInOpen()).toBe(false);
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
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "NewsDetail", params: { id: "advent-gruss" }, initial: false });
  expect(navigateToUrl("/events/weihnachts-lan")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Tournaments", { screen: "EventDetail", params: { id: "weihnachts-lan" }, initial: false });
  expect(navigateToUrl("/teams/t-1")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Teams", { screen: "TeamDetail", params: { id: "t-1" }, initial: false });
  expect(navigateToUrl("/me/prizes")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Profile", { tab: "prizes" });

  // Adressen ohne Kennung führen in die Liste.
  expect(navigateToUrl("/events")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Tournaments", { screen: "TournamentList", params: undefined, initial: false });
  expect(navigateToUrl("/teams")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Teams", { screen: "TeamList", params: undefined, initial: false });
  expect(targetFromUrl("/community")).toBeNull();
  expect(navigateToUrl("/achievements")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "AchievementShowcase", params: undefined, initial: false });
  expect(navigateToUrl("/news")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "NewsList", params: undefined, initial: false });
  expect(navigateToUrl("/gallery")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "Gallery", params: undefined, initial: false });
  expect(navigateToUrl("/fastlap")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "FastLapList", params: undefined, initial: false });
  expect(navigateToUrl("/advent")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "AdventCalendar", params: undefined, initial: false });

  mockRef.navigate.mockClear();
  for (const url of ["/servers", "/about", "", null, undefined]) expect(navigateToUrl(url)).toBe(false);
  expect(mockRef.navigate).not.toHaveBeenCalled();
});

test("„Deine Rechnung ist da“ (#841) öffnet Meine Rechnungen mit dem Beleg - fremde Werte fallen weg", () => {
  expect(targetFromUrl("/profile?tab=invoices&invoice=d-501")).toEqual({ area: "more", screen: "MyInvoices", params: { invoice: "d-501" } });
  expect(targetFromUrl("https://lionsquad.at/profile?tab=invoices&invoice=d-501")).toEqual({ area: "more", screen: "MyInvoices", params: { invoice: "d-501" } });
  expect(targetFromUrl("/profile?tab=invoices&invoice=../../x")).toEqual({ area: "more", screen: "MyInvoices", params: undefined });
  expect(targetFromUrl("/profile?tab=invoices")).toEqual({ area: "more", screen: "MyInvoices", params: undefined });
  expect(targetFromUrl("/account/invoices")).toEqual({ area: "more", screen: "MyInvoices" });
});
