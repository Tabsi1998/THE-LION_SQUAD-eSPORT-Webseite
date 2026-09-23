import { fireEvent, render, screen } from "@testing-library/react";
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
  fireEvent.keyDown(window, { key: "Escape" });
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
