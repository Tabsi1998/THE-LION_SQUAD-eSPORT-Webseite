import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Der Schalter im Footer (#634): nur mit laufender Saison sichtbar, zeigt die eigene Wahl, stellt um.

const seasonState = { ready: true, seasons: [{ key: "halloween", effective: "normal" }], preference: "on", setPreference: vi.fn() };
vi.mock("./SeasonContext", () => ({ useSeason: () => seasonState }));

const { DecoSwitch } = await import("./DecoSwitch");

test("sichtbar mit Saison, gedrückt ist die eigene Wahl, Klick stellt um", async () => {
  const user = userEvent.setup();
  render(<DecoSwitch />);
  expect(screen.getByTestId("season-deco-on")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("season-deco-off")).toHaveAttribute("aria-pressed", "false");
  await user.click(screen.getByTestId("season-deco-subtle"));
  expect(seasonState.setPreference).toHaveBeenCalledWith("subtle");
});

test("ohne Saison kein Schalter", () => {
  seasonState.seasons = [];
  render(<DecoSwitch />);
  expect(screen.queryByTestId("season-deco-switch")).toBeNull();
});
