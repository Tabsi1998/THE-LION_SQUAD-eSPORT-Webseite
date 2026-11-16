import { toast } from "sonner";
import { loadOk, problemKind, resetLoadReports, toastLoadFailed } from "./loadProblem";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
  toast.error.mockReset();
  resetLoadReports();
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

  expect(toast.error).toHaveBeenCalledTimes(1);
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

// Fix-Runde #2412: Seiten mit Nachladen im Takt (Übersicht, Kontakt, Teams, Dokumente) scheitern bei einer Störung
// immer wieder. Der Hinweis kommt einmal und erst wieder, wenn der Abruf zwischendurch geklappt hat (loadOk) - oder
// nach fünf Minuten, falls die Störung dann noch besteht.
test("wiederholter Fehlschlag meldet sich einmal, nach einem Erfolg wieder", () => {
  const fail = toastLoadFailed("Teile der Übersicht konnten nicht geladen werden.");
  for (let i = 0; i < 5; i += 1) fail({ response: { status: 500 } });
  expect(toast.error).toHaveBeenCalledTimes(1);

  loadOk("Teile der Übersicht konnten nicht geladen werden.");
  fail({ response: { status: 500 } });
  expect(toast.error).toHaveBeenCalledTimes(2);
});

test("nach fünf Minuten meldet sich eine anhaltende Störung noch einmal", () => {
  vi.useFakeTimers();
  try {
    const fail = toastLoadFailed("Die Kategorien konnten nicht geladen werden.");
    fail({ response: { status: 500 } });
    vi.advanceTimersByTime(4 * 60 * 1000);
    fail({ response: { status: 500 } });
    expect(toast.error).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 1000 + 1);
    fail({ response: { status: 500 } });
    expect(toast.error).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test("teilen sich Abrufe eine Meldung, schaltet nur der eigene Erfolg den Hinweis wieder scharf", () => {
  const message = "Teile der Übersicht konnten nicht geladen werden.";
  const failA = toastLoadFailed(message, "/a");
  failA({ response: { status: 500 } });
  // Abruf B klappt im selben Takt - A scheitert weiter und meldet sich nicht jedes Mal neu.
  loadOk("/b");
  failA({ response: { status: 500 } });
  expect(toast.error).toHaveBeenCalledTimes(1);
  loadOk("/a");
  failA({ response: { status: 500 } });
  expect(toast.error).toHaveBeenCalledTimes(2);
});
