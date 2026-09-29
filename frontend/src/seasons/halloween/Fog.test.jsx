import { act, fireEvent, render, screen } from "@testing-library/react";
import { Fog } from "./Fog";

// Nebel (H14): `far` eine Ebene, `near` zwei, `none` nichts; Stärke folgt dem Scrollstand; ohne Bewegung still.

afterEach(() => {
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  vi.useRealTimers();
});

test("Ebenen je Stufe, Stärke am Anfang voll, in der Mitte leise, unten wieder voll; ohne Bewegung die stille Fassung", async () => {
  vi.useFakeTimers();
  const { rerender, unmount } = render(<Fog level="none" />);
  expect(screen.queryByTestId("halloween-fog")).toBeNull();
  rerender(<Fog level="far" />);
  const far = screen.getByTestId("halloween-fog");
  expect(far.querySelectorAll(".tls-fog__layer").length).toBe(1);
  expect(far.className).not.toContain("tls-fog--static");
  rerender(<Fog level="near" />);
  const fog = screen.getByTestId("halloween-fog");
  expect(fog.querySelectorAll(".tls-fog__layer").length).toBe(2);
  expect(fog.querySelector(".tls-fog__layer--near")).not.toBeNull();
  expect(fog.style.getPropertyValue("--fog-strength")).toBe("1");
  Object.defineProperty(document.documentElement, "scrollHeight", { value: 4000, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 1800, configurable: true });
  fireEvent.scroll(window);
  await act(async () => {
    vi.advanceTimersByTime(40);
  });
  expect(fog.style.getPropertyValue("--fog-strength")).toBe("0.35");
  expect(fog.getAttribute("data-strength")).toBe("0.35");
  Object.defineProperty(window, "scrollY", { value: 3300, configurable: true });
  fireEvent.scroll(window);
  await act(async () => {
    vi.advanceTimersByTime(40);
  });
  expect(fog.style.getPropertyValue("--fog-strength")).toBe("1");
  rerender(<Fog level="near" moving={false} />);
  expect(screen.getByTestId("halloween-fog").className).toContain("tls-fog--static");
  unmount();
  expect(screen.queryByTestId("halloween-fog")).toBeNull();
});
