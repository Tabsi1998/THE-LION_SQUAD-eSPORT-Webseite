import { toast } from "sonner";
import { problemKind, toastLoadFailed } from "./loadProblem";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
  toast.error.mockReset();
});

test("problemKind: ohne Antwort offline, 404 nicht gefunden, 401/403 nicht freigegeben, sonst Fehler", () => {
  expect(problemKind({})).toBe("offline");
  expect(problemKind({ response: { status: 404 } })).toBe("notFound");
  expect(problemKind({ response: { status: 403 } })).toBe("denied");
  expect(problemKind({ response: { status: 500 } })).toBe("error");
});

// #2412: ein Teil der Seite (Auswahlliste, Kachel) kam nicht - das meldet ein Hinweis, statt still zu fehlen. Dieselbe
// Meldung steht nur einmal da; abgebrochene Abrufe und „kein Netz“ (dafür gibt es die Offline-Leiste) bleiben still.
test("toastLoadFailed meldet einen Ladefehler einmal je Meldung", () => {
  const fail = toastLoadFailed("Die Kategorien konnten nicht geladen werden.");
  fail({ response: { status: 500 } });
  fail({ response: { status: 502 } });

  expect(toast.error).toHaveBeenCalledTimes(2);
  expect(toast.error).toHaveBeenCalledWith("Die Kategorien konnten nicht geladen werden.", { id: "load-failed:Die Kategorien konnten nicht geladen werden." });
});

test("toastLoadFailed meldet auch einen Fehler im eigenen Code (ohne Serverantwort, aber mit Netz)", () => {
  toastLoadFailed("Die Liste konnte nicht geladen werden.")(new TypeError("x is undefined"));

  expect(toast.error).toHaveBeenCalledTimes(1);
});

test("toastLoadFailed schweigt bei abgebrochenen Abrufen und ohne Netz", () => {
  const fail = toastLoadFailed("Egal.");
  fail({ code: "ERR_CANCELED", name: "CanceledError" });
  fail(new window.DOMException("aborted", "AbortError"));
  const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  fail({ isAxiosError: true, request: {} });
  online.mockRestore();

  expect(toast.error).not.toHaveBeenCalled();
});
