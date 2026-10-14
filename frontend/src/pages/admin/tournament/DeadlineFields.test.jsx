import { fireEvent, render, screen } from "@testing-library/react";
import { DeadlineFields } from "./DeadlineFields";
import { DEADLINE_FIELDS, deadlineFormValues, deadlinePayload } from "@/lib/tournamentDeadlines";

// Fristen je Turnier (#1551): leer heißt Standard (vor Ort 10, online 15 Minuten, Ergebnis online 15 Minuten,
// Liga 48 Stunden); der Server nimmt nur ganze Zahlen ab 1.

test("leere Felder zeigen den Standard und gehen als null an den Server", () => {
  const form = deadlineFormValues({});
  expect(Object.values(form)).toEqual(["", "", "", ""]);
  expect(deadlinePayload(form)).toEqual({
    no_show_minutes_on_site: null,
    no_show_minutes_online: null,
    result_confirm_minutes_online: null,
    result_confirm_hours_league: null,
  });
  expect(DEADLINE_FIELDS.map((field) => field.fallback)).toEqual([10, 15, 15, 48]);
});

test("gespeicherte Werte kommen zurück, Eingaben werden zu Zahlen", () => {
  const form = deadlineFormValues({ no_show_minutes_on_site: 7, result_confirm_hours_league: 72 });
  expect(form.no_show_minutes_on_site).toBe("7");
  expect(deadlinePayload({ ...form, no_show_minutes_online: " 20 " })).toMatchObject({
    no_show_minutes_on_site: 7, no_show_minutes_online: 20, result_confirm_hours_league: 72, result_confirm_minutes_online: null,
  });
  expect(deadlinePayload({ ...form, no_show_minutes_on_site: "0" }).no_show_minutes_on_site).toBeNull();
  expect(deadlinePayload({ ...form, no_show_minutes_on_site: "abc" }).no_show_minutes_on_site).toBeNull();
});

test("das Formular zeigt vier Felder mit Standard als Platzhalter und meldet Änderungen", () => {
  const onChange = vi.fn();
  render(<DeadlineFields form={deadlineFormValues({})} onChange={onChange} />);
  const onSite = screen.getByTestId("tr-edit-no-show-on-site");
  expect(onSite).toHaveAttribute("placeholder", "Standard: 10");
  expect(screen.getByTestId("tr-edit-confirm-league")).toHaveAttribute("placeholder", "Standard: 48");
  fireEvent.change(onSite, { target: { value: "12" } });
  expect(onChange).toHaveBeenCalledWith("no_show_minutes_on_site", "12");
  expect(screen.getByTestId("tr-edit-deadlines")).toHaveTextContent("Vor Ort");
});
