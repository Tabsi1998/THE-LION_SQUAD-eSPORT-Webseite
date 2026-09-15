import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileNav } from "./ProfileNav";
import { TABS } from "./constants";

// Ein Menü für drei Breiten (#253): jeder Reiter genau einmal im Dokument,
// der aktive als aktuelle Seite markiert.

test("jeder Reiter steht genau einmal und der aktive ist markiert", () => {
  render(<ProfileNav tab="socials" onSelect={() => {}} />);
  for (const item of TABS) {
    expect(screen.getAllByTestId(`profile-tab-${item.k}`)).toHaveLength(1);
  }
  expect(screen.getByTestId("profile-tab-socials")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("profile-tab-basic")).not.toHaveAttribute("aria-current");
});

test("ein Klick meldet den Reiter", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<ProfileNav tab="basic" onSelect={onSelect} />);
  await user.click(screen.getByRole("button", { name: /Privatsphäre/ }));
  expect(onSelect).toHaveBeenCalledWith("privacy");
});
