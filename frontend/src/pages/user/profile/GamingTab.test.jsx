import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Plattform-Feld (#2281): im Profil ist das am Spiel gekennzeichnete Feld als Plattform erkennbar - mit dem Satz, was ohne
// Pflicht gilt.

vi.mock("./LeagueEligibilityNotice", () => ({ LeagueEligibilityNotice: () => null }));
vi.mock("./LeagueIdNotice", () => ({ LeagueIdNotice: () => null }));
vi.mock("@/components/tls/HelpLink", () => ({ HelpLink: () => null }));

const { GamingTab } = await import("./GamingTab");

const FORM = { favorite_games: "", main_platforms: [], input_devices: [], gaming_subscriptions: [], preferred_role: "", game_ids: {} };

function renderWith(fields) {
  const groups = [{ slug: "cod", title: "Call of Duty", games: ["Call of Duty"], fields }];
  return render(<MemoryRouter><GamingTab form={FORM} set={() => {}} setGameId={() => {}} gameIdGroups={groups} /></MemoryRouter>);
}

test("das Plattform-Feld trägt den Hinweis, andere Felder nicht", () => {
  renderWith([
    { key: "activision_id", label: "Activision ID", required: true },
    { key: "plattform", label: "Plattform", required: false, options: ["PC", "PS5"], platform: true },
  ]);
  expect(screen.getByTestId("profile-game-id-platform-cod-plattform")).toHaveTextContent("Deine Plattform");
  expect(screen.getByTestId("profile-game-id-platform-cod-plattform")).toHaveTextContent("es zählt der aktuelle Wert");
  expect(screen.queryByTestId("profile-game-id-platform-cod-activision_id")).toBeNull();
});

test("als Pflichtfeld ohne den Satz zum Umstellen", () => {
  renderWith([{ key: "plattform", label: "Plattform", required: true, options: ["PC"], platform: true }]);
  expect(screen.getByTestId("profile-game-id-platform-cod-plattform")).not.toHaveTextContent("jederzeit ändern");
});
