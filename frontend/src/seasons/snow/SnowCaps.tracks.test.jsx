import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Spur im Schnee (#937): verlässt man die Seite mitten in der Spur, gibt sie ihren Platz im Bewegungsbudget zurück -
// sonst bliebe er bis zum Neuladen belegt.

const motion = vi.hoisted(() => ({ requestMotion: vi.fn(() => "spur-1"), releaseMotion: vi.fn() }));
vi.mock("../motion", async (importOriginal) => ({ ...(await importOriginal()), ...motion }));

const { SnowCaps } = await import("./SnowCaps");

let fixture = null;

afterEach(() => {
  vi.useRealTimers();
  fixture?.remove();
  fixture = null;
  window.localStorage.clear();
});

test("Verlassen mitten in der Spur gibt das Bewegungsbudget frei", async () => {
  vi.useFakeTimers();
  window.localStorage.clear();
  fixture = document.createElement("div");
  fixture.innerHTML = `<footer id="fuss" data-season-anchor="footer">Fuß</footer>`;
  document.body.appendChild(fixture);
  document.getElementById("fuss").getBoundingClientRect = () => ({ left: 0, right: 1000, top: 400, bottom: 600, width: 1000, height: 200 });
  const { unmount } = render(<MemoryRouter initialEntries={["/"]}><SnowCaps stage={2} salt="2026" max={10} tracks /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  await act(async () => {
    vi.advanceTimersByTime(1600);
  });
  expect(motion.requestMotion).toHaveBeenCalledWith("snow_tracks");
  expect(motion.releaseMotion).not.toHaveBeenCalledWith("spur-1");
  unmount();
  expect(motion.releaseMotion).toHaveBeenCalledWith("spur-1");
});
