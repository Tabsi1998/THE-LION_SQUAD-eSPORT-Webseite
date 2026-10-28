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

test("hybrid in Spielwochen: die Fristen mit Standard als Platzhalter, Änderungen werden gemeldet", () => {
  const onChange = vi.fn();
  render(<DeadlineFields form={{ ...deadlineFormValues({}), format: "league", event_mode: "hybrid" }} onChange={onChange} />);
  const onSite = screen.getByTestId("tr-edit-no-show-on-site");
  expect(onSite).toHaveAttribute("placeholder", "Standard: 10");
  expect(screen.getByTestId("tr-edit-confirm-league")).toHaveAttribute("placeholder", "Standard: 48");
  expect(screen.getByTestId("tr-edit-no-show-online")).toBeInTheDocument();
  // In Spielwochen gilt die Wochenfrist, nicht die Minuten-Frist.
  expect(screen.queryByTestId("tr-edit-confirm-online")).toBeNull();
  fireEvent.change(onSite, { target: { value: "12" } });
  expect(onChange).toHaveBeenCalledWith("no_show_minutes_on_site", "12");
  expect(screen.getByTestId("tr-edit-deadlines")).toHaveTextContent("Vor Ort");
});

// Nur, was wirkt (#2111, T2): vor Ort zählt nur „Nicht erschienen ab Aufruf“, online ohne Spielwochen nur die
// Online-Fristen - dieselbe Regel wie services/match_deadlines.py.
test("vor Ort nur die Frist ab Aufruf, online ein K.-o. nur die Online-Fristen", () => {
  const ids = () => [...document.querySelectorAll("[data-testid^='tr-edit-']")].map((node) => node.dataset.testid).filter((id) => id !== "tr-edit-deadlines");
  const { unmount } = render(<DeadlineFields form={{ ...deadlineFormValues({}), format: "league", event_mode: "local" }} onChange={() => {}} />);
  expect(ids()).toEqual(["tr-edit-no-show-on-site"]);
  unmount();
  render(<DeadlineFields form={{ ...deadlineFormValues({}), format: "single_elim", event_mode: "online" }} onChange={() => {}} />);
  expect(ids()).toEqual(["tr-edit-no-show-online", "tr-edit-confirm-online"]);
});