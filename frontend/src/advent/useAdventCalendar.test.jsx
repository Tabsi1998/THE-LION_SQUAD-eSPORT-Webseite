import { act, renderHook, waitFor } from "@testing-library/react";

// Der Adventkalender einer Person (#641): Gäste öffnen mit, ihr Browser merkt es sich; nach dem Anmelden werden
// die Türchen für das Konto nachgeholt; ein neuer Erfolg wird sofort gefeiert.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
const auth = { user: null };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => auth }));

const { AWARDED_EVENT, errorText, useAdventCalendar } = await import("./useAdventCalendar");
const { STORAGE_KEY, readOpened, rememberOpened } = await import("./storage");

function calendar(opened = [], today = 12, year = 2026) {
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const state = day > today ? "locked" : opened.includes(day) ? "opened" : "available";
    doors.push({ day, seed: day, opens_at: `${year}-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, state, ...(state === "opened" ? { content: { kind: "text", title: `Inhalt ${day}` } } : {}) });
  }
  return { active: true, year, doors, opened: opened.length, total: 24, order: [] };
}

function opened(day, extra = {}) {
  return { data: { day, year: 2026, state: "opened", content: { kind: "text", title: `Inhalt ${day}` }, counted: true, first: true, opened: 1, total: 24, newly_awarded: 0, opened_at: "2026-12-12T09:00:00+00:00", ...extra } };
}

let awarded;
const onAwarded = (event) => awarded.push(event.detail);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.user = null;
  awarded = [];
  window.addEventListener(AWARDED_EVENT, onAwarded);
  apiMock.get.mockResolvedValue({ data: calendar() });
});

afterEach(() => window.removeEventListener(AWARDED_EVENT, onAwarded));

test("laden: ohne gemerkte Türchen ohne Zusatz, mit gemerkten nennt der Gast sie", async () => {
  const first = renderHook(() => useAdventCalendar());
  expect(first.result.current.loading).toBe(true);
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/advent", { params: {}, skipInvalidation: true });
  expect(first.result.current.calendar.active).toBe(true);
  expect(first.result.current.signedIn).toBe(false);
  first.unmount();

  rememberOpened(2026, 3);
  rememberOpened(2026, 1);
  const second = renderHook(() => useAdventCalendar());
  await waitFor(() => expect(second.result.current.loading).toBe(false));
  expect(apiMock.get).toHaveBeenLastCalledWith("/seasonal/advent", { params: { opened: "1,3" }, skipInvalidation: true });
});

test("gemerkte Türchen aus einem anderen Jahr werden vergessen", async () => {
  rememberOpened(2025, 7);
  const { result } = renderHook(() => useAdventCalendar());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("laden scheitert: ein Satz statt einer leeren Seite", async () => {
  apiMock.get.mockRejectedValueOnce({ response: { status: 500, data: {} } });
  const { result } = renderHook(() => useAdventCalendar());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.calendar).toBeNull();
  expect(result.current.error).toBe("Der Adventkalender lässt sich gerade nicht laden.");
  apiMock.get.mockResolvedValueOnce({ data: calendar() });
  await act(async () => { await result.current.reload(); });
  expect(result.current.error).toBe("");
  expect(result.current.calendar.active).toBe(true);
});

test("Gast öffnet: der Inhalt erscheint, der Browser merkt es sich", async () => {
  apiMock.post.mockResolvedValueOnce(opened(12, { counted: false, first: false, opened: null }));
  const { result } = renderHook(() => useAdventCalendar());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.open(12); });
  expect(apiMock.post).toHaveBeenCalledWith("/seasonal/advent/12/open", null, { skipInvalidation: true });
  const door = result.current.calendar.doors.find((entry) => entry.day === 12);
  expect(door).toMatchObject({ state: "opened", content: { title: "Inhalt 12" } });
  expect(result.current.calendar.opened).toBe(1);
  expect(readOpened(2026)).toEqual([12]);
  expect(awarded).toEqual([]);
});

test("angemeldet öffnet: gezählt wird am Server, der Browser merkt sich nichts - ein neuer Erfolg wird gefeiert", async () => {
  auth.user = { id: "u1" };
  apiMock.post.mockResolvedValueOnce(opened(12, { opened: 8, newly_awarded: 2 }));
  const { result } = renderHook(() => useAdventCalendar());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.open(12); });
  expect(result.current.signedIn).toBe(true);
  expect(result.current.calendar.opened).toBe(8);
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(awarded).toEqual([{ count: 2, source: "advent" }]);
});

test("öffnen scheitert: der Fehler kommt an, das Türchen bleibt zu", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Dieses Türchen öffnet sich am 13. Dezember um 6 Uhr." } } });
  const { result } = renderHook(() => useAdventCalendar());
  await waitFor(() => expect(result.current.loading).toBe(false));
  let failure = null;
  await act(async () => {
    try {
      await result.current.open(13);
    } catch (caught) {
      failure = caught;
    }
  });
  expect(errorText(failure, "x")).toBe("Dieses Türchen öffnet sich am 13. Dezember um 6 Uhr.");
  expect(errorText({}, "Ersatz")).toBe("Ersatz");
  expect(result.current.calendar.doors.find((entry) => entry.day === 13).state).toBe("locked");
});

test("nach dem Anmelden: was der Gast geöffnet hat, wird nachgeholt - einmal, ohne die schon gezählten", async () => {
  rememberOpened(2026, 1);
  rememberOpened(2026, 2);
  rememberOpened(2026, 5);
  auth.user = { id: "u1" };
  apiMock.get.mockResolvedValueOnce({ data: calendar([2]) }).mockResolvedValue({ data: calendar([1, 2, 5]) });
  apiMock.post.mockImplementation((url) => Promise.resolve(opened(Number(url.split("/")[3]), { newly_awarded: url.includes("/5/") ? 1 : 0 })));
  const { result, rerender } = renderHook(() => useAdventCalendar());
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  // Angemeldet schickt die Abfrage keine gemerkten Türchen mit - das Konto weiß, was offen ist.
  expect(apiMock.get).toHaveBeenNthCalledWith(1, "/seasonal/advent", { params: {}, skipInvalidation: true });
  expect(apiMock.post.mock.calls.map((call) => call[0])).toEqual(["/seasonal/advent/1/open", "/seasonal/advent/5/open"]);
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(awarded).toEqual([{ count: 1, source: "advent" }]);
  await waitFor(() => expect(result.current.calendar.opened).toBe(3));
  rerender();
  await act(async () => { await Promise.resolve(); });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
});

test("nachholen: ein Türchen, das sich nicht öffnen lässt, hält die anderen nicht auf", async () => {
  rememberOpened(2026, 1);
  rememberOpened(2026, 20);
  auth.user = { id: "u1" };
  apiMock.post.mockImplementation((url) => (url.includes("/20/") ? Promise.reject({ response: { status: 409 } }) : Promise.resolve(opened(1))));
  renderHook(() => useAdventCalendar());
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
  expect(awarded).toEqual([]);
});

test("Quiz und Verlosung ändern nur ihr Türchen", async () => {
  auth.user = { id: "u1" };
  const data = calendar([2, 12]);
  data.doors[1].content = { kind: "quiz", title: "Quiz", quiz: { question: "?", answers: ["a", "b", "c"], done: false } };
  data.doors[11].content = { kind: "prize", title: "Gewinn", prize: { label: "Hoodie", entered: false, entries: 3 } };
  apiMock.get.mockResolvedValue({ data });
  const { result } = renderHook(() => useAdventCalendar());
  await waitFor(() => expect(result.current.loading).toBe(false));

  apiMock.post.mockResolvedValueOnce({ data: { day: 2, correct: true, correct_index: 1, correct_answer: "b", explanation: "", done: true } });
  let answer;
  await act(async () => { answer = await result.current.answer(2, 1); });
  expect(apiMock.post).toHaveBeenCalledWith("/seasonal/advent/2/quiz", { answer: 1 }, { skipInvalidation: true });
  expect(answer.correct).toBe(true);
  expect(result.current.calendar.doors[1].content.quiz.done).toBe(true);

  apiMock.post.mockResolvedValueOnce({ data: { day: 12, prize: { label: "Hoodie", entered: true, entries: 4 } } });
  await act(async () => { await result.current.raffle(12, true); });
  expect(apiMock.post).toHaveBeenLastCalledWith("/seasonal/advent/12/enter", null, { skipInvalidation: true });
  expect(result.current.calendar.doors[11].content.prize).toEqual({ label: "Hoodie", entered: true, entries: 4 });
  expect(result.current.calendar.doors[11].content.title).toBe("Gewinn");

  apiMock.delete.mockResolvedValueOnce({ data: { day: 12, prize: { label: "Hoodie", entered: false, entries: 3 } } });
  await act(async () => { await result.current.raffle(12, false); });
  expect(apiMock.delete).toHaveBeenCalledWith("/seasonal/advent/12/enter", { skipInvalidation: true });
  expect(result.current.calendar.doors[11].content.prize.entered).toBe(false);
  expect(result.current.calendar.doors[0].content).toBeUndefined();
});
