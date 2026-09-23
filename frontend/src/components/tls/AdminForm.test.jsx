import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "./AdminForm";
import { CheckField, SelectField, TextField } from "./FormFields";

// Formular-Rahmen (#434): Kopf mit Zurück, Inhalt und Seitenleiste, Speichern-Leiste; Abschnitte
// einklappbar; Felder mit Pflichtstern, {k,l}-Listen und Haken mit Hinweis.

test("Editor-Seite: Kopf mit Zurück, Inhalt und Seitenleiste, Speichern-Leiste", () => {
  render(
    <MemoryRouter>
      <AdminFormPage eyebrow="Events" title="Neues Event" backTo="/admin/events" backLabel="Events" aside={<div>Status</div>} actions={<FormActions submitTestId="save" cancelTo="/admin/events" />}>
        <div>Inhalt</div>
      </AdminFormPage>
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Neues Event" })).toBeInTheDocument();
  expect(screen.getByTestId("admin-form-back")).toHaveAttribute("href", "/admin/events");
  expect(screen.getByTestId("admin-form-main")).toHaveTextContent("Inhalt");
  expect(screen.getByTestId("admin-form-aside")).toHaveTextContent("Status");
  expect(screen.getByTestId("admin-form-actions")).toBeInTheDocument();
  expect(screen.getByTestId("save")).toHaveTextContent("Speichern");
  expect(screen.getByTestId("admin-form-cancel")).toHaveAttribute("href", "/admin/events");
});

test("ohne Seitenleiste gibt es keine leere Spalte; die Leiste sperrt beim Speichern", () => {
  render(
    <MemoryRouter>
      <AdminFormPage eyebrow="Fast Lap" title="Neue Challenge" actions={<FormActions submitTestId="save" saving submitLabel="Challenge erstellen" savingLabel="Erstelle …" icon={null} />}>
        <div>Inhalt</div>
      </AdminFormPage>
    </MemoryRouter>,
  );
  expect(screen.queryByTestId("admin-form-aside")).toBeNull();
  expect(screen.queryByTestId("admin-form-back")).toBeNull();
  expect(screen.getByTestId("save")).toBeDisabled();
  expect(screen.getByTestId("save")).toHaveTextContent("Erstelle …");
});

test("einklappbarer Abschnitt versteckt seinen Inhalt, bis man ihn öffnet", () => {
  render(
    <FormSection title="Darstellung und Regeln" hint="Texte und Bilder" collapsible testId="section">
      <input data-testid="inside" />
    </FormSection>,
  );
  const details = screen.getByTestId("section");
  expect(details.open).toBe(false);
  expect(screen.getByTestId("inside")).not.toBeVisible();
  fireEvent.click(screen.getByText("Darstellung und Regeln"));
  expect(details.open).toBe(true);
  expect(screen.getByTestId("inside")).toBeVisible();
});

test("Felder: Pflichtstern, Auswahl aus {k,l}-Listen, Haken mit Hinweis", () => {
  render(
    <FormGrid cols={3}>
      <TextField label="Titel" value="" onChange={() => {}} required testId="t" />
      <SelectField label="Typ" value="lan" onChange={() => {}} options={[{ k: "general", l: "Allgemein" }, { k: "lan", l: "LAN" }]} testId="s" />
      <CheckField label="Anpinnen" hint="Bleibt oben." checked onChange={() => {}} testId="c" accent="#FFD700" />
    </FormGrid>,
  );
  expect(screen.getByTitle("Pflichtfeld")).toBeInTheDocument();
  expect(screen.getByTestId("t")).toBeRequired();
  expect(screen.getByTestId("s")).toHaveValue("lan");
  expect(screen.getByRole("option", { name: "Allgemein" })).toBeInTheDocument();
  expect(screen.getByTestId("c")).toBeChecked();
  expect(screen.getByText("Bleibt oben.")).toBeInTheDocument();
});
