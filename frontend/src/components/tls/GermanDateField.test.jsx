import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { GermanDateField } from "./GermanDateField";

// Datumsfeld (#937): Beschriftung und Fehler hängen am Knopf - der Fehler über aria-describedby (und als Hinweis), nicht
// über aria-invalid, das es für Knöpfe nicht gibt.
test("Beschriftung und Fehler hängen am Knopf, ohne aria-invalid", () => {
  render(<GermanDateField id="geburtstag" label="Geburtstag" value="2001-04-03" onChange={() => {}} error="Bitte ein Datum wählen." testId="dob" />);
  const trigger = screen.getByRole("button", { name: /Geburtstag/ });
  expect(trigger).toHaveTextContent("3. April 2001");
  expect(trigger).toHaveAccessibleDescription("Bitte ein Datum wählen.");
  expect(trigger).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("alert")).toHaveTextContent("Bitte ein Datum wählen.");
});

// #2412: „Datum entfernen“ ist ein eigener Knopf neben dem Auslöser, nicht darin verschachtelt (ein Knopf im Knopf ist
// für Tastatur und Vorleseprogramm kaputt). Der Auslöser trägt Beschriftung und Wert im Namen, Hinweis, Beschreibung
// und Fehler hängen per aria-describedby daran. Im Kalender wandern die Pfeiltasten von Tag zu Tag.
function Field(props) {
  const [value, setValue] = useState(props.value ?? "");
  return <GermanDateField id="dob" label="Geburtstag" testId="dob" allowFuture {...props} value={value} onChange={(next) => { setValue(next); props.onChange?.(next); }} />;
}

test("„Datum entfernen“ liegt neben dem Auslöser, nicht darin, und leert per Tastatur", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Field value="2001-04-03" onChange={onChange} />);
  const trigger = screen.getByTestId("dob");
  const clear = screen.getByRole("button", { name: "Datum entfernen" });

  expect(clear.tagName).toBe("BUTTON");
  expect(trigger).not.toContainElement(clear);
  clear.focus();
  await user.keyboard("{Enter}");

  expect(onChange).toHaveBeenCalledWith("");
  expect(screen.queryByRole("button", { name: "Datum entfernen" })).toBeNull();
  expect(trigger).toHaveFocus();
});

test("Der Auslöser nennt Beschriftung und Wert; Hinweis, Beschreibung und Fehler beschreiben ihn", () => {
  render(<Field value="2001-04-03" hint="Wie im Ausweis." description="Nur für den Verein." error="Bitte prüfen." />);
  const trigger = screen.getByTestId("dob");

  expect(trigger).toHaveAccessibleName("Geburtstag 3. April 2001");
  expect(trigger).toHaveAccessibleDescription("Wie im Ausweis. Nur für den Verein. Bitte prüfen.");
});

test("Tastatur im Kalender: Fokus auf dem gewählten Tag, Pfeile wandern, Enter wählt, Fokus zurück zum Auslöser", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Field value="2001-04-28" onChange={onChange} />);
  const trigger = screen.getByTestId("dob");
  trigger.focus();
  await user.keyboard("{Enter}");

  expect(await screen.findByTestId("dob-day-28")).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByTestId("dob-day-29")).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByTestId("dob-day-22")).toHaveFocus();
  await user.keyboard("{ArrowDown}{ArrowDown}");
  // 6. Mai: über den Monatsrand, der Kalender blättert mit.
  expect(screen.getByTestId("dob-month")).toHaveValue("4");
  expect(screen.getByTestId("dob-day-6")).toHaveFocus();
  await user.keyboard("{Enter}");

  expect(onChange).toHaveBeenLastCalledWith("2001-05-06");
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("Escape schließt den Kalender und gibt den Fokus an den Auslöser zurück", async () => {
  const user = userEvent.setup();
  render(<Field value="" />);
  const trigger = screen.getByTestId("dob");
  trigger.focus();
  await user.keyboard("{Enter}");
  await screen.findByTestId("dob-month");

  await user.keyboard("{Escape}");

  expect(screen.queryByTestId("dob-month")).toBeNull();
  expect(trigger).toHaveFocus();
});
