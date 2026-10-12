import { act, renderHook } from "@testing-library/react";
import { useMobileMenu } from "./mobileMenu";

// #1324: das Handy-Menü überlebt den Wechsel vom Rahmen des Seitenwechsels zum Rahmen der Seite, nicht aber einen
// Seitenwechsel.

test("offen bleibt offen, wenn ein neuer Rahmen auf derselben Seite kommt", () => {
  const first = renderHook(() => useMobileMenu("/dashboard"));
  act(() => first.result.current[1](true));
  first.unmount();
  const second = renderHook(() => useMobileMenu("/dashboard"));
  expect(second.result.current[0]).toBe(true);
  act(() => second.result.current[1]((value) => !value));
  expect(second.result.current[0]).toBe(false);
});

test("eine andere Seite schließt das Menü - auch beim Zurückkehren", () => {
  const hook = renderHook(({ path }) => useMobileMenu(path), { initialProps: { path: "/a" } });
  act(() => hook.result.current[1](true));
  hook.rerender({ path: "/b" });
  expect(hook.result.current[0]).toBe(false);
  hook.rerender({ path: "/a" });
  expect(hook.result.current[0]).toBe(false);
});
