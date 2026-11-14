import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

// @-Erwähnen (#937): der Fokus bleibt im Textfeld, die Vorschläge sind eine Liste, auf deren gewählten Eintrag das
// Textfeld zeigt (aria-activedescendant). Pfeile wählen, Enter übernimmt, Escape schließt.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));

const { MentionTextarea } = await import("./MentionTextarea");

function Harness() {
  const [value, setValue] = useState("");
  return <MentionTextarea value={value} onValueChange={setValue} aria-label="Nachricht" />;
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: [{ id: "u1", username: "leo", display_name: "Leo" }, { id: "u2", username: "lea", display_name: "Lea" }] });
});

test("Pfeile wählen einen Vorschlag, das Textfeld zeigt darauf, Enter übernimmt", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole("textbox", { name: "Nachricht" });
  await user.click(input);
  await user.keyboard("Hallo @le");
  const list = await screen.findByRole("listbox", { name: "Vorschläge zum Erwähnen" });
  const options = await screen.findAllByRole("option");
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute("aria-controls", list.id);
  expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  options.forEach((option) => expect(option).toHaveAttribute("tabindex", "-1"));
  await user.keyboard("{ArrowDown}");
  expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
  await user.keyboard("{Enter}");
  expect(input).toHaveValue("Hallo @lea ");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(input).not.toHaveAttribute("aria-activedescendant");
});

test("Escape schließt die Vorschläge, der Text bleibt", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole("textbox", { name: "Nachricht" });
  await user.click(input);
  await user.keyboard("@le");
  await screen.findAllByRole("option");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(input).toHaveValue("@le");
});
