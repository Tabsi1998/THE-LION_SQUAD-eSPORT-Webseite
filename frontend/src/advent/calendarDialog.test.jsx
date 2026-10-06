import { act, renderHook } from "@testing-library/react";
import { closeAdventCalendar, isAdventCalendarOpen, openAdventCalendar, useAdventCalendarOpen } from "./calendarDialog";

// Ob das Kalender-Fenster offen ist (#963): ein Wert für alle Einstiege, den Bausteine abonnieren können.

afterEach(() => closeAdventCalendar());

test("öffnen und schließen - wer zuschaut, bekommt es mit", () => {
  const { result } = renderHook(() => useAdventCalendarOpen());
  expect(result.current).toBe(false);
  act(() => openAdventCalendar());
  expect(result.current).toBe(true);
  expect(isAdventCalendarOpen()).toBe(true);
  act(() => openAdventCalendar());
  expect(result.current).toBe(true);
  act(() => closeAdventCalendar());
  expect(result.current).toBe(false);
});
