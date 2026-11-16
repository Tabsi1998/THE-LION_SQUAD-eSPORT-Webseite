import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SideSheet } from "./SideSheet";

// #2412: das öffentliche Blatt verhält sich wie das der Verwaltung - Fokus aufs Blatt, Tab bleibt darin, der Rest der
// Seite ist gesperrt, Escape schließt und gibt den Fokus an den auslösenden Knopf zurück.
function Page() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main data-testid="page"><button type="button" onClick={() => setOpen(true)}>Details</button></main>
      {open ? (
        <SideSheet title="Turnier" onClose={() => setOpen(false)} footer={<button type="button">Anmelden</button>}>
          <a href="/regeln">Regeln</a>
        </SideSheet>
      ) : null}
    </>
  );
}

test("Tastatur: Fokus aufs Blatt, Tab bleibt drin, Hintergrund gesperrt, Escape gibt den Fokus zurück", async () => {
  const user = userEvent.setup();
  render(<Page />);
  const opener = screen.getByRole("button", { name: "Details" });
  await user.click(opener);

  const sheet = screen.getByRole("dialog", { name: "Turnier" });
  expect(sheet).toHaveFocus();
  expect(screen.getByTestId("page")).toHaveAttribute("inert");
  for (let i = 0; i < 5; i += 1) {
    await user.tab();
    expect(sheet).toContainElement(document.activeElement);
  }

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTestId("page")).not.toHaveAttribute("inert");
  expect(opener).toHaveFocus();
  expect(document.body.style.overflow).toBe("");
});
