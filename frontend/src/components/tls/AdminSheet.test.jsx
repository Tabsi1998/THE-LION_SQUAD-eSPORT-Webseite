import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AdminSheet } from "./AdminSheet";

// Seitenblatt (#435): Titel und Inhalt, Speichern schickt das Formular ab, Esc / Klick daneben /
// Schließen-Knopf rufen onClose, der Hintergrund scrollt nicht, solange es offen ist.

test("zeigt Titel, Inhalt und Leiste; Speichern schickt das Formular ab", () => {
  const onSubmit = vi.fn((event) => event.preventDefault());
  const onClose = vi.fn();
  render(
    <AdminSheet title="Neuer Partner" eyebrow="Verein" onClose={onClose} onSubmit={onSubmit} submitTestId="save" testId="sheet">
      <input data-testid="inside" />
    </AdminSheet>,
  );
  expect(screen.getByRole("dialog", { name: "Neuer Partner" })).toBeInTheDocument();
  expect(screen.getByText("Verein")).toBeInTheDocument();
  expect(screen.getByTestId("inside")).toBeInTheDocument();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(screen.getByTestId("save"));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

test("Esc, Klick daneben und der Schließen-Knopf schließen; danach scrollt die Seite wieder", () => {
  const onClose = vi.fn();
  const { unmount } = render(<AdminSheet title="Sponsor bearbeiten" onClose={onClose} onSubmit={(e) => e.preventDefault()} testId="sheet">Inhalt</AdminSheet>);
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  fireEvent.mouseDown(screen.getByTestId("sheet-backdrop"));
  fireEvent.click(screen.getByTestId("sheet-close"));
  fireEvent.click(screen.getByTestId("sheet-cancel"));
  expect(onClose).toHaveBeenCalledTimes(4);
  // Ein Klick im Blatt selbst schließt nicht.
  fireEvent.mouseDown(screen.getByTestId("sheet"));
  expect(onClose).toHaveBeenCalledTimes(4);
  unmount();
  expect(document.body.style.overflow).toBe("");
});

test("beim Speichern ist der Knopf gesperrt und trägt den Speichere-Text", () => {
  render(<AdminSheet title="Position" onClose={() => {}} onSubmit={() => {}} saving submitTestId="save" savingLabel="Speichere …">Inhalt</AdminSheet>);
  expect(screen.getByTestId("save")).toBeDisabled();
  expect(screen.getByTestId("save")).toHaveTextContent("Speichere …");
});

// #2412: das Blatt ist ein echter Dialog - Fokus aufs Blatt, Tab bleibt darin, der Rest der Seite ist gesperrt, und
// nach dem Schließen steht der Fokus wieder auf dem Knopf, der es geöffnet hat.
function Page() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main data-testid="page"><button type="button" onClick={() => setOpen(true)}>Bearbeiten</button></main>
      {open ? (
        <AdminSheet title="Sponsor" onClose={() => setOpen(false)} onSubmit={(e) => e.preventDefault()} testId="sheet">
          <input aria-label="Name" />
        </AdminSheet>
      ) : null}
    </>
  );
}

test("Tastatur: Fokus aufs Blatt, Tab bleibt drin, Hintergrund gesperrt, Escape gibt den Fokus zurück", async () => {
  const user = userEvent.setup();
  render(<Page />);
  const opener = screen.getByRole("button", { name: "Bearbeiten" });
  await user.click(opener);

  const sheet = screen.getByRole("dialog", { name: "Sponsor" });
  expect(sheet).toHaveFocus();
  expect(screen.getByTestId("page")).toHaveAttribute("inert");
  for (let i = 0; i < 6; i += 1) {
    await user.tab();
    expect(sheet).toContainElement(document.activeElement);
  }

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTestId("page")).not.toHaveAttribute("inert");
  expect(opener).toHaveFocus();
});
