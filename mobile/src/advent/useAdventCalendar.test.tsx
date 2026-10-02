import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { STORAGE_KEY } from "./storage";
import { useAdventCalendar } from "./useAdventCalendar";

// Der Adventkalender einer Person in der App (#641, #642): der Server entscheidet, was offen ist. Gäste öffnen ohne
// Konto - ihr Gerät merkt sich die Türchen, nach dem Anmelden werden sie für das Konto nachgeholt.

const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock("../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApi.get(...args),
    post: (...args: unknown[]) => mockApi.post(...args),
    delete: (...args: unknown[]) => mockApi.delete(...args),
  },
  errorMessage: (error: unknown, fallback: string) => (error as { detail?: string })?.detail || fallback,
}));
const mockAuth: { user: { id: string } | null } = { user: null };
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../live", () => ({ isGuestUser: (user?: { id?: string } | null) => user?.id === "guest" }));

const GREETING = { kind: "text", title: "Ein Gruß", body: "Schön, dass du da bist." };
const QUIZ = { kind: "quiz", title: "Kranz-Quiz", quiz: { question: "Wie viele Kerzen?", answers: ["Drei", "Vier", "Fünf"], done: false } };
const PRIZE = { label: "TLS-Hoodie", winners: 1, audience: "all", status: "open", entries: 3, entered: false, can_enter: true, can_withdraw: false, won: false, terms: [] };

function calendar(opened: number[] = [], extra: Record<string, unknown> = {}) {
  const content: Record<number, unknown> = { 1: GREETING, 2: QUIZ, 3: { kind: "prize", title: "Gewinn", prize: PRIZE } };
  return {
    active: true,
    year: 2026,
    newest_door: 5,
    catch_up: false,
    opened: opened.length,
    total: 24,
    order: Array.from({ length: 24 }, (_, index) => index + 1),
    doors: Array.from({ length: 24 }, (_, index) => {
      const day = index + 1;
      const state = opened.includes(day) ? "opened" : day <= 5 ? "available" : "locked";
      return { day, seed: day * 1000, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, state, ...(state === "opened" ? { content: content[day] || GREETING } : {}) };
    }),
    ...extra,
  };
}

async function mount(onAwarded?: (count: number) => void) {
  const view = await renderHook(() => useAdventCalendar(onAwarded));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = null;
  mockApi.get.mockResolvedValue({ data: calendar() });
});

test("laden: ohne gemerkte Türchen ohne Zusatz, mit gemerkten nennt der Gast sie", async () => {
  const first = await mount();
  expect(mockApi.get).toHaveBeenCalledWith("/seasonal/advent", { params: {} });
  expect(first.result.current.calendar?.doors).toHaveLength(24);
  expect(first.result.current.signedIn).toBe(false);
  await first.unmount();

  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ year: 2026, days: [4, 1] }));
  mockAuth.user = { id: "guest" };
  const second = await mount();
  expect(mockApi.get).toHaveBeenLastCalledWith("/seasonal/advent", { params: { opened: "1,4" } });
  expect(second.result.current.signedIn).toBe(false);
});

test("gemerkte Türchen aus einem anderen Jahr werden vergessen", async () => {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ year: 2025, days: [1, 2, 3] }));
  await mount();
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
});

test("der Kalender ist zu: die gemerkten Türchen bleiben liegen", async () => {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ year: 2026, days: [1] }));
  mockApi.get.mockResolvedValue({ data: { active: false, next_start: "2027-12-01T00:00:00+01:00" } });
  const { result } = await mount();
  expect(result.current.calendar).toEqual({ active: false, next_start: "2027-12-01T00:00:00+01:00" });
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).not.toBeNull();
});

test("laden scheitert: ein Satz statt eines leeren Screens - und noch einmal versuchen geht", async () => {
  mockApi.get.mockRejectedValueOnce({ detail: "" });
  const { result } = await mount();
  expect(result.current.calendar).toBeNull();
  expect(result.current.error).toBe("Der Adventkalender lässt sich gerade nicht laden.");
  await act(async () => {
    await result.current.reload();
  });
  expect(result.current.error).toBe("");
  expect(result.current.calendar?.active).toBe(true);
});

test("Gast öffnet: der Inhalt erscheint, das Gerät merkt es sich", async () => {
  const onAwarded = jest.fn();
  const { result } = await mount(onAwarded);
  mockApi.post.mockResolvedValueOnce({ data: { day: 1, year: 2026, content: GREETING, counted: false, first: false, opened: null, newly_awarded: 0 } });
  await act(async () => {
    await result.current.open(1);
  });
  expect(mockApi.post).toHaveBeenCalledWith("/seasonal/advent/1/open");
  const door = result.current.calendar?.doors?.find((entry) => entry.day === 1);
  expect(door).toMatchObject({ state: "opened", content: GREETING });
  expect(result.current.calendar?.opened).toBe(1);
  expect(JSON.parse(String(await SecureStore.getItemAsync(STORAGE_KEY)))).toEqual({ year: 2026, days: [1] });
  expect(onAwarded).not.toHaveBeenCalled();
});

test("angemeldet öffnet: gezählt wird am Server, das Gerät merkt sich nichts - ein neuer Erfolg wird gemeldet", async () => {
  mockAuth.user = { id: "u-1" };
  mockApi.get.mockResolvedValue({ data: calendar([1, 2], { signed_in: true }) });
  const onAwarded = jest.fn();
  const { result } = await mount(onAwarded);
  expect(result.current.signedIn).toBe(true);
  mockApi.post.mockResolvedValueOnce({ data: { day: 3, year: 2026, content: GREETING, counted: true, first: true, opened: 3, newly_awarded: 2, opened_at: "2026-12-05T07:00:00+01:00" } });
  await act(async () => {
    await result.current.open(3);
  });
  expect(result.current.calendar?.opened).toBe(3);
  expect(result.current.calendar?.doors?.find((entry) => entry.day === 3)).toMatchObject({ state: "opened", opened_at: "2026-12-05T07:00:00+01:00" });
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
  expect(onAwarded).toHaveBeenCalledWith(2);
});

test("öffnen scheitert: der Fehler kommt an, das Türchen bleibt zu", async () => {
  const { result } = await mount();
  mockApi.post.mockRejectedValueOnce({ detail: "Dieses Türchen ist noch zu.", response: { status: 409 } });
  await expect(result.current.open(9)).rejects.toMatchObject({ detail: "Dieses Türchen ist noch zu." });
  expect(result.current.calendar?.doors?.find((entry) => entry.day === 9)?.state).toBe("locked");
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
});

test("nach dem Anmelden: was der Gast geöffnet hat, wird nachgeholt - einmal, ohne die schon gezählten", async () => {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ year: 2026, days: [1, 2, 4] }));
  mockAuth.user = { id: "u-1" };
  mockApi.get.mockResolvedValueOnce({ data: calendar([1]) }).mockResolvedValue({ data: calendar([1, 2, 4]) });
  mockApi.post.mockImplementation(async (url: string) => ({ data: { day: Number(url.split("/")[3]), year: 2026, content: GREETING, counted: true, first: true, opened: 3, newly_awarded: url.includes("/4/") ? 1 : 0 } }));
  const onAwarded = jest.fn();
  const { result } = await mount(onAwarded);
  await waitFor(() => expect(result.current.calendar?.opened).toBe(3));
  expect(mockApi.post.mock.calls.map(([url]) => url)).toEqual(["/seasonal/advent/2/open", "/seasonal/advent/4/open"]);
  // Angemeldet schickt die App keine gemerkten Türchen mit.
  expect(mockApi.get.mock.calls.every(([, options]) => !(options as { params: Record<string, unknown> }).params.opened)).toBe(true);
  expect(onAwarded).toHaveBeenCalledTimes(1);
  expect(onAwarded).toHaveBeenCalledWith(1);
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
  // Einmal je Person und Jahr: ein weiteres Laden holt nichts mehr nach.
  await act(async () => {
    await result.current.reload();
  });
  expect(mockApi.post).toHaveBeenCalledTimes(2);
});

test("nachholen: ein Türchen, das sich nicht öffnen lässt, hält die anderen nicht auf", async () => {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ year: 2026, days: [2, 3] }));
  mockAuth.user = { id: "u-1" };
  mockApi.get.mockResolvedValueOnce({ data: calendar([]) }).mockResolvedValue({ data: calendar([3]) });
  mockApi.post.mockRejectedValueOnce({ detail: "Dieses Türchen gibt es nicht mehr." }).mockResolvedValueOnce({ data: { day: 3, year: 2026, content: GREETING, counted: true, first: true, opened: 1, newly_awarded: 0 } });
  const onAwarded = jest.fn();
  const { result } = await mount(onAwarded);
  await waitFor(() => expect(result.current.calendar?.opened).toBe(1));
  expect(mockApi.post).toHaveBeenCalledTimes(2);
  expect(onAwarded).not.toHaveBeenCalled();
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
});

test("Quiz und Verlosung ändern nur ihr Türchen", async () => {
  mockAuth.user = { id: "u-1" };
  mockApi.get.mockResolvedValue({ data: calendar([1, 2, 3]) });
  const { result } = await mount();
  const before = result.current.calendar?.doors?.find((entry) => entry.day === 1);

  mockApi.post.mockResolvedValueOnce({ data: { day: 2, correct: true, correct_index: 1, correct_answer: "Vier", explanation: "Für jeden Adventsonntag eine.", done: true } });
  let answer: unknown;
  await act(async () => {
    answer = await result.current.answer(2, 1);
  });
  expect(mockApi.post).toHaveBeenLastCalledWith("/seasonal/advent/2/quiz", { answer: 1 });
  expect(answer).toMatchObject({ correct: true, correct_answer: "Vier" });
  expect(result.current.calendar?.doors?.find((entry) => entry.day === 2)?.content?.quiz?.done).toBe(true);

  mockApi.post.mockResolvedValueOnce({ data: { prize: { ...PRIZE, entries: 4, entered: true, can_enter: false, can_withdraw: true } } });
  await act(async () => {
    await result.current.raffle(3, true);
  });
  expect(mockApi.post).toHaveBeenLastCalledWith("/seasonal/advent/3/enter");
  expect(result.current.calendar?.doors?.find((entry) => entry.day === 3)?.content?.prize).toMatchObject({ entries: 4, entered: true });

  mockApi.delete.mockResolvedValueOnce({ data: { prize: PRIZE } });
  await act(async () => {
    await result.current.raffle(3, false);
  });
  expect(mockApi.delete).toHaveBeenCalledWith("/seasonal/advent/3/enter");
  expect(result.current.calendar?.doors?.find((entry) => entry.day === 3)?.content?.prize).toMatchObject({ entries: 3, entered: false });
  expect(result.current.calendar?.doors?.find((entry) => entry.day === 1)).toBe(before);
});
