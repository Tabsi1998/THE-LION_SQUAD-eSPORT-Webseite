import { act, fireEvent, render, screen, within } from "@testing-library/react";

// Das Brett des Adventkalenders (#641, #732): 24 Türchen in der Anordnung des Servers; verschlossen rüttelt es nur,
// offen geht es auf, geöffnet zeigt es seinen Inhalt - und was noch zu ist, verrät nichts.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));

const { AdventBoard, RATTLE_MS } = await import("./AdventBoard");
const { doorVariant, hingeAt, cellOf } = await import("./doors");

const ORDER = [8, 22, 9, 14, 5, 13, 17, 12, 2, 18, 6, 16, 19, 7, 10, 3, 24, 23, 11, 15, 21, 4, 1, 20];

function calendar({ today = 12, opened = [1, 2], extra = {} } = {}) {
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const state = day > today ? "locked" : opened.includes(day) ? "opened" : "available";
    const door = { day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, seed: 7919 * day + 13, state };
    if (state === "opened") door.content = { kind: day === 2 ? "quiz" : "text", title: `Inhalt ${day}`, body: "Text", media_url: null, link: null };
    doors.push(door);
  }
  return { active: true, year: 2026, order: ORDER, doors, catch_up: today > 24, newest_door: Math.min(24, today), opened: opened.length, total: 24, ...extra };
}

function setup(props = {}) {
  const handlers = { onOpen: vi.fn(), onShow: vi.fn(), onLocked: vi.fn() };
  const view = render(<AdventBoard calendar={calendar(props.calendar)} busyDay={props.busyDay ?? null} {...handlers} />);
  return { ...handlers, ...view };
}

test("24 Türchen in der Anordnung des Servers, mit dem Bild des Jahres", () => {
  setup();
  const board = screen.getByTestId("advent-board");
  expect(board).toHaveAttribute("data-year", "2026");
  expect(board).toHaveAccessibleName("Adventkalender 2026: 24 Türchen");
  expect(board.style.getPropertyValue("--advent-scene")).toMatch(/^url\("data:image\/svg\+xml,/);
  const cells = [...board.querySelectorAll("[data-day]")];
  expect(cells.map((cell) => Number(cell.dataset.day))).toEqual(ORDER);
  expect(screen.getByTestId("advent-frame")).toHaveAttribute("data-season-quiet", "1");
});

test("Zustände: verschlossen, offen, geöffnet - und das heutige trägt sein Schild", () => {
  setup();
  expect(screen.getByTestId("advent-door-20")).toHaveAttribute("data-state", "locked");
  expect(screen.getByTestId("advent-door-12")).toHaveAttribute("data-state", "available");
  expect(screen.getByTestId("advent-door-2")).toHaveAttribute("data-state", "opened");
  expect(screen.getByTestId("advent-door-12")).toHaveAttribute("data-today", "1");
  expect(within(screen.getByTestId("advent-door-12")).getByText("Heute")).toBeInTheDocument();
  expect(screen.getAllByText("Heute")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Türchen 12 öffnen – das heutige" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Türchen 11 öffnen" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Türchen 20 – öffnet sich am 20. Dezember, 6 Uhr" })).toHaveAttribute("title", "Türchen 20 – öffnet sich am 20. Dezember, 6 Uhr");
  expect(screen.getByRole("button", { name: "Türchen 2 – geöffnet: Inhalt 2" })).toBeInTheDocument();
});

test("nur geöffnete Türchen zeigen etwas von ihrem Inhalt", () => {
  setup();
  expect(within(screen.getByTestId("advent-door-2")).getByText("Inhalt 2")).toBeInTheDocument();
  expect(screen.getByTestId("advent-door-2").querySelector(".tls-adv__preview")).toHaveAttribute("data-kind", "quiz");
  for (const day of [11, 12, 20, 24]) {
    const cell = screen.getByTestId(`advent-door-${day}`);
    expect(cell.querySelector(".tls-adv__preview")).toBeNull();
    expect(cell.textContent.replace(/Heute/, "").replace(/\s/g, "")).toBe(String(day).repeat(cell.dataset.hinge === "double" ? 3 : 2));
  }
});

test("beim Nachholen gibt es kein heutiges Türchen", () => {
  setup({ calendar: { today: 30, opened: [] } });
  expect(screen.queryByText("Heute")).toBeNull();
  expect(document.querySelectorAll("[data-today='1']")).toHaveLength(0);
  expect(document.querySelectorAll("[data-state='available']")).toHaveLength(24);
});

test("Klick: offen geht auf, geöffnet zeigt, verschlossen rüttelt und sagt, wann es so weit ist", () => {
  vi.useFakeTimers();
  try {
    const { onOpen, onShow, onLocked } = setup();
    fireEvent.click(screen.getByTestId("advent-door-button-12"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ day: 12, state: "available" });
    fireEvent.click(screen.getByTestId("advent-door-button-2"));
    expect(onShow.mock.calls[0][0]).toMatchObject({ day: 2, state: "opened" });

    fireEvent.click(screen.getByTestId("advent-door-button-20"));
    expect(onLocked.mock.calls[0][0]).toMatchObject({ day: 20 });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("advent-door-20")).toHaveAttribute("data-rattle", "1");
    act(() => { vi.advanceTimersByTime(RATTLE_MS); });
    expect(screen.getByTestId("advent-door-20")).toHaveAttribute("data-rattle", "0");
  } finally {
    vi.useRealTimers();
  }
});

test("während ein Türchen aufgeht, öffnet kein zweites", () => {
  const { onOpen, onShow } = setup({ busyDay: 12 });
  expect(screen.getByTestId("advent-door-12")).toHaveAttribute("data-busy", "1");
  fireEvent.click(screen.getByTestId("advent-door-button-11"));
  fireEvent.click(screen.getByTestId("advent-door-button-12"));
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("advent-door-button-1"));
  expect(onShow).toHaveBeenCalledTimes(1);
});

test("jedes Türchen trägt seine Eigenheiten - am Rand mit dem Scharnier nach innen", () => {
  setup();
  const board = screen.getByTestId("advent-board");
  const columns = Number(board.dataset.columns);
  ORDER.forEach((day, index) => {
    const cell = screen.getByTestId(`advent-door-${day}`);
    const variant = doorVariant(7919 * day + 13);
    const place = cellOf(index, columns);
    const hinge = hingeAt(variant.hinge, place, columns);
    expect(cell).toHaveAttribute("data-shape", variant.shape);
    expect(cell).toHaveAttribute("data-hinge", hinge);
    expect(cell.style.getPropertyValue("--col")).toBe(String(place.col));
    expect(cell.style.getPropertyValue("--row")).toBe(String(place.row));
    expect(cell.style.getPropertyValue("--light")).toBe(variant.light.color);
    expect(cell.style.getPropertyValue("--angle")).toBe(String(variant.angle));
    expect(cell.querySelectorAll(".tls-adv__leaf")).toHaveLength(hinge === "double" ? 2 : 1);
    // Genau ein Schildchen mit der Zahl vorne, nie über dem Spalt zweier Flügel.
    expect(cell.querySelectorAll(".tls-adv__plaque")).toHaveLength(1);
    if (hinge === "double") expect(cell.dataset.plaque).not.toBe("center");
  });
  expect(new Set(ORDER.map((day) => screen.getByTestId(`advent-door-${day}`).dataset.shape)).size).toBeGreaterThan(1);
});

test("fehlt dem Server ein Türchen, bleibt der Platz leer statt zu brechen", () => {
  const broken = calendar();
  broken.doors = broken.doors.filter((door) => door.day !== 9);
  render(<AdventBoard calendar={broken} onOpen={() => {}} onShow={() => {}} onLocked={() => {}} />);
  expect(screen.queryByTestId("advent-door-9")).toBeNull();
  expect(screen.getByTestId("advent-board").children).toHaveLength(24);
});
