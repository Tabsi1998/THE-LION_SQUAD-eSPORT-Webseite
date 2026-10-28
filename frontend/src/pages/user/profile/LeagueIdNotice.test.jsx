import { render, screen, waitFor } from "@testing-library/react";

// Hinweis im Profil (#2108): In der laufenden Liga gilt weiter die festgehaltene ID - sobald die ID im Formular anders
// lautet, sagt der Hinweis es, ohne neu zu laden. Erfundene IDs.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const { LeagueIdNotice } = await import("./LeagueIdNotice");

const ENTRY = {
  season_id: "s1",
  title: "Testliga · Season 1",
  state: "locked",
  ok: true,
  text: "Testloewe#1234567",
  locked: { activision_id: "Testloewe#1234567" },
  fields: [{ key: "activision_id", label: "Activision-ID" }],
  identity_slug: "hauptspiel",
  game_slug: "version",
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: { items: [ENTRY] } });
});

test("ändert sich die ID im Formular, gilt in der Liga weiter die gemeldete", async () => {
  const { rerender } = render(<LeagueIdNotice gameIds={{ hauptspiel: { activision_id: "Testloewe#1234567" } }} />);
  await waitFor(() => expect(screen.getByTestId("profile-league-id-s1")).toHaveAttribute("data-tone", "info"));
  expect(apiMock.get).toHaveBeenCalledWith("/me/league-ids");

  rerender(<LeagueIdNotice gameIds={{ hauptspiel: { activision_id: "Neu#7654321" } }} />);

  const notice = screen.getByTestId("profile-league-id-s1");
  expect(notice).toHaveAttribute("data-tone", "warn");
  expect(notice).toHaveTextContent("In der laufenden Liga (Testliga · Season 1) gilt weiter Testloewe#1234567");
});

test("ohne Liga keine Zeile; ein Fehler beim Laden stört das Profil nicht", async () => {
  apiMock.get.mockRejectedValueOnce(new Error("offline"));
  render(<LeagueIdNotice gameIds={{}} />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.queryByTestId("profile-league-ids")).not.toBeInTheDocument();
});
