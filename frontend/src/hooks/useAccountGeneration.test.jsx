import { renderHook } from "@testing-library/react";
import { useAccountGeneration } from "./useAccountGeneration";

// Kontowechsel (#1047): nur ein Wechsel von einem angemeldeten Konto weg zählt.

test("das erste Laden der Sitzung und eine Anmeldung als Gast zählen nicht", () => {
  const { result, rerender } = renderHook(({ id }) => useAccountGeneration(id), { initialProps: { id: undefined } });
  expect(result.current).toBe(0);
  rerender({ id: "u-a" });
  expect(result.current).toBe(0);
  rerender({ id: "u-a" });
  expect(result.current).toBe(0);
});

test("ein anderes Konto oder das Abmelden zählt, die Anmeldung danach nicht", () => {
  const { result, rerender } = renderHook(({ id }) => useAccountGeneration(id), { initialProps: { id: null } });
  rerender({ id: "u-a" });
  expect(result.current).toBe(0);
  rerender({ id: "u-b" });
  expect(result.current).toBe(1);
  rerender({ id: null });
  expect(result.current).toBe(2);
  rerender({ id: "u-a" });
  expect(result.current).toBe(2);
});
