import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { hashString } from "../rng";

// Weihnachten (S8, X1, X2, X4): Klassen und Breite, Lichtinseln nur an den Feiertagen, Kette mit ruhigerem
// Bewegungsbudget, der Gruß einmal je Tag mit Text des Tages, Escape und Klick, Abschied mit Link, Jahres-Salz.

vi.mock("../../components/tls/Logo", () => ({ Logo: (props) => <img data-testid="tls-logo" alt="Logo" data-variant={props.variant} /> }));

const { Backdrop, Corners, DAY_LABELS, HOLIDAY_SLOTS, TOAST_DELAY_MS, TOAST_MS, Toast, christmasLayout, greetingFor, season, setYearSalt, starField, yearSaltFor } = await import("./index.jsx");
const { createMotionScheduler, getMotionScheduler, resetMotionScheduler } = await import("../motion");
setYearSalt("test");

function xmas(overrides = {}) {
  return { key: "christmas", phase: "gruss", effective: "normal", starts_at: "2026-12-24T00:00:00+01:00", ends_at: "2026-12-26T23:59:59+01:00", texts: { greeting: "Frohe Weihnachten wünscht THE LION SQUAD", greeting_25: "Schöne Feiertage vom Rudel!", farewell: "Danke fürs Mitfeiern", farewell_link: "/news/rueckblick" }, data: {}, ...overrides };
}

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top });
}

let fixture = null;
const originalWidth = window.innerWidth;

beforeEach(() => {
  localStorage.clear();
  resetMotionScheduler(createMotionScheduler({ slots: 2, doc: null }));
});

afterEach(() => {
  vi.useRealTimers();
  fixture?.remove();
  fixture = null;
  Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true, writable: true });
});

afterAll(() => resetMotionScheduler(null));

// Die App zeigt dieselbe Grußkarte (mobile/src/seasons/christmas/greeting.ts, #642) - derselbe Fingerabdruck der Sterne
// steht dort im Test: weicht eine Seite ab, wird die andere rot.
const STARS_PARITY = 2991777711;

test("Parität mit der App: dieselben Sterne aus demselben Seed", () => {
  expect(hashString(JSON.stringify([starField(2026), starField("2027", 5)]))).toBe(STARS_PARITY);
});

test("Klassen und Breite: Kette überall außer still und unter 768 px, Fußzeile mit der Szene, Lichtinseln mit der Atmosphäre", () => {
  expect(christmasLayout("/", "normal", 1440)).toEqual({ cls: "lively", chain: true, footerChain: true, glow: true });
  expect(christmasLayout("/login", "normal", 1440)).toEqual({ cls: "calm", chain: true, footerChain: true, glow: true });
  expect(christmasLayout("/admin/x", "normal", 1440)).toEqual({ cls: "quiet", chain: false, footerChain: false, glow: false });
  expect(christmasLayout("/", "normal", 700)).toMatchObject({ chain: false, footerChain: false });
  expect(christmasLayout("/", "subtle", 1440)).toMatchObject({ chain: true, footerChain: true });
});

test("Text des Tages: Heiligabend, eigener Text am 25., der eine Gruß am 26., Abschied mit Link, außerhalb der Tage Heiligabend", () => {
  expect(greetingFor(xmas(), new Date(2026, 11, 24, 18))).toEqual({ title: "Heiligabend", text: "Frohe Weihnachten wünscht THE LION SQUAD", link: "", day: 24 });
  expect(greetingFor(xmas(), new Date(2026, 11, 25, 9))).toMatchObject({ title: DAY_LABELS[25], text: "Schöne Feiertage vom Rudel!", day: 25 });
  expect(greetingFor(xmas(), new Date(2026, 11, 26, 9))).toMatchObject({ title: DAY_LABELS[26], text: "Frohe Weihnachten wünscht THE LION SQUAD", day: 26 });
  expect(greetingFor(xmas({ phase: "abschied" }), new Date(2027, 0, 6, 9))).toEqual({ title: "Heilige Drei Könige", text: "Danke fürs Mitfeiern", link: "/news/rueckblick", day: 6 });
  expect(greetingFor(xmas({ texts: {} }), new Date(2026, 11, 20))).toMatchObject({ day: 24, text: "Frohe Weihnachten wünscht THE LION SQUAD" });
  expect(greetingFor(xmas({ phase: "abschied", texts: {} }))).toMatchObject({ link: "", text: expect.stringContaining("Danke") });
});

test("Lichtinseln nur an den Feiertagen und nicht bei dezent; Sterne je Jahr stabil", () => {
  expect(render(<MemoryRouter initialEntries={["/"]}><Backdrop season={xmas({ phase: "abschied" })} /></MemoryRouter>).container.innerHTML).toBe("");
  expect(render(<MemoryRouter initialEntries={["/"]}><Backdrop season={xmas({ effective: "subtle" })} /></MemoryRouter>).container.innerHTML).toBe("");
  expect(render(<MemoryRouter initialEntries={["/admin/x"]}><Backdrop season={xmas()} /></MemoryRouter>).container.innerHTML).toBe("");
  render(<MemoryRouter initialEntries={["/"]}><Backdrop season={xmas()} /></MemoryRouter>);
  expect(screen.getByTestId("christmas-glow").className).toContain("tls-season-backdrop");
  const stars = starField(2026);
  expect(stars).toHaveLength(14);
  expect(starField(2026)).toEqual(stars);
  expect(starField(2027)).not.toEqual(stars);
  stars.forEach((star) => {
    expect(star.x).toBeGreaterThanOrEqual(0);
    expect(star.x).toBeLessThanOrEqual(100);
  });
  expect(yearSaltFor(xmas())).toBe("test");
  setYearSalt(null);
  expect(yearSaltFor(xmas())).toBe("2026");
  expect(yearSaltFor({ starts_at: "" }, new Date(2027, 0, 6))).toBe("2026");
  setYearSalt("test");
});

test("Kette an den Feiertagen mit einem Platz im Bewegungsbudget, danach wieder zwei; Abschied ohne Kette", async () => {
  vi.useFakeTimers();
  fixture = document.createElement("div");
  fixture.innerHTML = `<header id="head" style="position: sticky"><nav><a href="/news">News</a></nav></header><main></main>`;
  document.body.appendChild(fixture);
  box(document.getElementById("head"), { left: 0, right: 1024, top: 0, bottom: 80 });
  const { unmount } = render(<MemoryRouter initialEntries={["/"]}><Corners season={xmas()} /></MemoryRouter>);
  expect(getMotionScheduler().snapshot().slots).toBe(HOLIDAY_SLOTS);
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  expect(screen.getAllByTestId("christmas-lights").map((chain) => chain.getAttribute("data-anchor"))).toEqual(["header"]);
  unmount();
  expect(getMotionScheduler().snapshot().slots).toBe(2);
  render(<MemoryRouter initialEntries={["/"]}><Corners season={xmas({ phase: "abschied" })} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  expect(screen.queryAllByTestId("christmas-lights")).toHaveLength(0);
  expect(getMotionScheduler().snapshot().slots).toBe(2);
});

test("Gruß: 1,5 s nach dem Laden einmal je Tag, Text des Tages, Escape schließt, danach heute nicht mehr; Klick schließt; Abschied mit Link; nach 14 s weg", async () => {
  vi.useFakeTimers();
  const now = new Date(2026, 11, 24, 10);
  const first = render(<Toast season={xmas()} now={now} />);
  expect(screen.queryByTestId("christmas-toast")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(TOAST_DELAY_MS + 10);
  });
  const toast = screen.getByTestId("christmas-toast");
  expect(toast.getAttribute("role")).toBe("status");
  expect(toast.getAttribute("data-day")).toBe("24");
  expect(toast).toHaveTextContent("Heiligabend");
  expect(toast).toHaveTextContent("Frohe Weihnachten wünscht THE LION SQUAD");
  expect(screen.getByTestId("tls-logo").getAttribute("data-variant")).toBe("mascot");
  expect(toast.querySelectorAll(".tls-xmas-toast__light")).toHaveLength(8);
  expect(toast.querySelectorAll(".tls-xmas-toast__star")).toHaveLength(14);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByTestId("christmas-toast")).toBeNull();
  first.unmount();
  render(<Toast season={xmas()} now={now} />);
  await act(async () => {
    vi.advanceTimersByTime(TOAST_DELAY_MS + TOAST_MS + 100);
  });
  expect(screen.queryByTestId("christmas-toast")).toBeNull();
  // Erzwungen (Vorschau): sofort nach der Wartezeit, Klick schließt.
  const forced = render(<Toast season={xmas()} now={now} force />);
  await act(async () => {
    vi.advanceTimersByTime(TOAST_DELAY_MS + 10);
  });
  fireEvent.click(screen.getByTestId("christmas-toast-close"));
  expect(screen.queryByTestId("christmas-toast")).toBeNull();
  forced.unmount();
  // Abschied am 6. Jänner: eigener Tag, Link zum Rückblick; nach 14 s von selbst weg.
  render(<Toast season={xmas({ phase: "abschied" })} now={new Date(2027, 0, 6, 9)} />);
  await act(async () => {
    vi.advanceTimersByTime(TOAST_DELAY_MS + 10);
  });
  expect(screen.getByTestId("christmas-toast")).toHaveTextContent("Danke fürs Mitfeiern");
  expect(screen.getByText("Zum Jahresrückblick").getAttribute("href")).toBe("/news/rueckblick");
  await act(async () => {
    vi.advanceTimersByTime(TOAST_MS + 10);
  });
  expect(screen.queryByTestId("christmas-toast")).toBeNull();
  expect(season.Toast).toBe(Toast);
  expect(season.Corners).toBe(Corners);
  expect(season.key).toBe("christmas");
});
