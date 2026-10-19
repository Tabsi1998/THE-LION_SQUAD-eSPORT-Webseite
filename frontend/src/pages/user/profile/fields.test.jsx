import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./fields";

// Ein Klick neben das Bild im Profil öffnete die Dateiauswahl: das Feld war ein <label>, und ein Klick in seine Fläche
// löst den ersten Knopf darin aus - beim Bild das versteckte Datei-Feld. Felder mit mehreren Knöpfen sind eine Gruppe.
describe("Profil-Feld", () => {
  it("Gruppe: ein Klick auf Titel oder Fläche löst keinen Knopf darin aus", () => {
    const pick = vi.fn();
    render(
      <Field label="Avatar" group>
        <input type="file" className="hidden" data-testid="file" onClick={pick} />
        <button type="button">Bild hochladen</button>
      </Field>,
    );
    const group = screen.getByRole("group", { name: "Avatar" });
    expect(group.tagName).toBe("DIV");
    expect(group.closest("label")).toBeNull();
    fireEvent.click(screen.getByText("Avatar"));
    fireEvent.click(group);
    expect(pick).not.toHaveBeenCalled();
  });

  it("einzelne Eingabe bleibt ein Label: Klick auf den Titel setzt den Fokus hinein", () => {
    render(
      <Field label="Anzeigename">
        <input data-testid="name" />
      </Field>,
    );
    expect(screen.getByLabelText("Anzeigename")).toBe(screen.getByTestId("name"));
  });
});
