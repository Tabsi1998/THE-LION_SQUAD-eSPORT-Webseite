import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SCARE_STORAGE } from "./scareRules";

// Jumpscares (#680) auf der Bühne: erst nach 45 s, nur mit laufender Engine und Ton, einmal am Tag; ein Klick beendet
// den Schreck, danach der Hinweis mit „Nie wieder“; der Schalter neben dem Widget schaltet ab und an.

const engineState = { engine: null };
vi.mock("../audio", () => ({
  emitSound: vi.fn(() => true),
  getActiveEngine: () => engineState.engine,
}));
const seasonState = { scaresAllowed: true, reducedMotion: false };
vi.mock("../SeasonContext", () => ({ useSeason: () => seasonState }));

const { ScareToggle, Scares } = await import("./Scare");
const { emitSound } = await import("../audio");

function halloween(night = true) {
  return { key: "halloween", effective: "full", data: { night } };
}

beforeEach(() => {
  Object.values(SCARE_STORAGE).forEach((key) => localStorage.removeItem(key));
  localStorage.setItem(SCARE_STORAGE.visits, JSON.stringify({ count: 5, day: "2026-10-01" }));
  engineState.engine = { unlocked: true, prefs: { sounds: true, music: true } };
  seasonState.scaresAllowed = true;
  seasonState.reducedMotion = false;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

function mount(props = {}, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}><Scares season={halloween()} checkMs={1000} {...props} /></MemoryRouter>);
}

test("kommt erst nach 45 s, dann mit Figur, Auftritt, Rahmen und Klang; ein Klick beendet ihn, der Hinweis bleibt kurz", async () => {
  vi.useFakeTimers();
  let clock = Date.parse("2026-10-30T20:00:00Z");
  const now = () => clock;
  mount({ now, rng: () => 0.42 });
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  clock += 10000;
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  clock += 40000;
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  const scare = screen.getByTestId("halloween-scare");
  const variant = scare.getAttribute("data-variant");
  expect(variant).toMatch(/^(spider|ghost|cat|bats|lantern|shadow)-(rise|drop|tilt|fade|dash)-[a-z_]+-(dim|shake|pulse|flicker)$/);
  expect(scare.className).toContain(`tls-scare--${variant.split("-")[1]}`);
  expect(scare.className).toContain(`tls-scare--frame-${variant.split("-")[3]}`);
  expect(emitSound).toHaveBeenCalledWith(variant.split("-")[2]);
  expect(localStorage.getItem(SCARE_STORAGE.last)).toBe("2026-10-30");
  await act(async () => {
    fireEvent.pointerDown(window);
  });
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  expect(screen.getByTestId("halloween-scare-note")).toHaveTextContent("Boo.");
  await act(async () => {
    vi.advanceTimersByTime(6100);
  });
  expect(screen.queryByTestId("halloween-scare-note")).toBeNull();
  // Heute kein zweiter, auch nach Minuten nicht.
  clock += 600000;
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
});

test("endet von selbst nach höchstens 1,8 s; „Nie wieder“ schaltet ab", async () => {
  vi.useFakeTimers();
  let clock = Date.parse("2026-10-30T20:00:00Z");
  mount({ now: () => clock, rng: () => 0.99 });
  clock += 60000;
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByTestId("halloween-scare")).toBeInTheDocument();
  clock += 1900;
  await act(async () => {
    vi.advanceTimersByTime(1900);
  });
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  fireEvent.click(screen.getByTestId("halloween-scare-off"));
  expect(localStorage.getItem(SCARE_STORAGE.off)).toBe("1");
  expect(screen.queryByTestId("halloween-scare-note")).toBeNull();
});

test("nie ohne Erlaubnis, ohne Ton, bei Bewegung reduzieren, im Admin oder in den ersten Besuchen", async () => {
  vi.useFakeTimers();
  let clock = Date.parse("2026-10-30T20:00:00Z");
  const tick = async () => {
    clock += 60000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  };
  const view = mount({ now: () => clock, allowed: false });
  await tick();
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  view.unmount();
  engineState.engine = { unlocked: true, prefs: { sounds: false, music: false } };
  const muted = mount({ now: () => clock });
  await tick();
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  muted.unmount();
  engineState.engine = { unlocked: true, prefs: { sounds: true, music: true } };
  seasonState.reducedMotion = true;
  const still = mount({ now: () => clock });
  await tick();
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  still.unmount();
  seasonState.reducedMotion = false;
  const admin = mount({ now: () => clock }, "/admin/settings");
  await tick();
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  admin.unmount();
  localStorage.setItem(SCARE_STORAGE.visits, JSON.stringify({ count: 1, day: "2026-10-01" }));
  const fresh = mount({ now: () => clock });
  await tick();
  expect(screen.queryByTestId("halloween-scare")).toBeNull();
  expect(JSON.parse(localStorage.getItem(SCARE_STORAGE.visits))).toEqual({ count: 2, day: "2026-10-30" });
  fresh.unmount();
});

test("der Schalter neben dem Widget: an, aus, an - mit Merker", () => {
  render(<ScareToggle />);
  const toggle = screen.getByTestId("season-scare-toggle");
  expect(toggle.getAttribute("data-state")).toBe("on");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("data-state")).toBe("off");
  expect(localStorage.getItem(SCARE_STORAGE.off)).toBe("1");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("data-state")).toBe("on");
  expect(localStorage.getItem(SCARE_STORAGE.off)).toBeNull();
});
