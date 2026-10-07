// Fast-Lap-TV (#1127): Vergleich alt/neu - neue Zeit, Bestzeit, Strafzeit, Gleichstand; ein Neuladen ohne neue Zeit
// bewegt nichts, ein Streckenwechsel auch nicht.
import { fastLapBoard, lap } from "../../e2e/fixtures/tvHall.mjs";
import { compareBoards, deltaText, previousHolderText, rowChips } from "./tvFastLap";

test("ein Neuladen ohne neue Zeit bewegt nichts", () => {
  const board = fastLapBoard(8);
  expect(compareBoards(board, JSON.parse(JSON.stringify(board)))).toEqual({ improved: [], added: [], best: null });
  expect(compareBoards(null, board)).toEqual({ improved: [], added: [], best: null });
});

test("schneller als vorher: persönliche Bestzeit mit Abstand - aber keine Bestzeit, solange sie nicht vorn ist", () => {
  const board = fastLapBoard(8);
  const next = lap(board, "u6", 80900);
  const change = compareBoards(board, next);
  expect(change.improved).toHaveLength(1);
  expect(change.improved[0].deltaMs).toBe(80900 - board.entries.find((entry) => entry.user_id === "u6").time_ms);
  expect(change.best).toBeNull();
  expect(rowChips(change).get("u6").text).toBe(`${deltaText(change.improved[0].deltaMs)} · persönliche Bestzeit`);
  // Eine langsamere Runde ändert nichts.
  expect(compareBoards(next, lap(next, "u6", 90000)).improved).toEqual([]);
});

test("neue Bestzeit: Name, Zeit, Abstand und wer sie vorher hatte", () => {
  const board = fastLapBoard(8);
  const next = lap(board, "u5", 79400);
  const change = compareBoards(board, next);
  expect(change.best).toMatchObject({ userId: "u5", gapMs: -600, ownRecord: false });
  expect(deltaText(change.best.gapMs)).toBe("−0.600 s");
  expect(previousHolderText(change.best)).toBe("vorher NeonFalke · 1:20.000");
  // Der Spitzenreiter verbessert sich selbst.
  const own = compareBoards(board, lap(board, "u1", 79000));
  expect(own.best).toMatchObject({ userId: "u1", ownRecord: true });
  expect(previousHolderText(own.best)).toBe("vorher selbst 1:20.000");
});

test("Gleichstand mit der Bestzeit ist keine neue Bestzeit", () => {
  const board = fastLapBoard(8);
  const change = compareBoards(board, lap(board, "u3", 80000));
  expect(change.improved.map((row) => row.userId)).toEqual(["u3"]);
  expect(change.best).toBeNull();
});

test("Strafsekunden: richtig einsortiert, aber kein Bestzeit-Moment; eine erste Zeit heißt „Neu“", () => {
  const board = fastLapBoard(8);
  // 78,000 s gefahren plus 1 s Strafe = 79,000 s - schneller als 80,000 s, aber mit Strafe kein Moment.
  const penalized = lap(board, "u7", 78000, { penalty: 1 });
  const change = compareBoards(board, penalized);
  expect(penalized.entries[0].user_id).toBe("u7");
  expect(change.best).toBeNull();
  expect(change.improved.map((row) => row.userId)).toEqual(["u7"]);
  // Erste Zeit eines neuen Fahrers.
  const added = compareBoards(board, lap(board, "u99", 85000, { name: "NeuNina" }));
  expect(added.added.map((row) => row.userId)).toEqual(["u99"]);
  expect(rowChips(added).get("u99")).toEqual({ kind: "new", text: "Neu" });
  // Erste Zeit überhaupt auf einer leeren Strecke: Bestzeit ohne Vorgänger.
  const emptyBoard = { ...board, entries: [] };
  const first = compareBoards(emptyBoard, lap(emptyBoard, "u1", 81000, { name: "NeonFalke" }));
  expect(first.best).toMatchObject({ userId: "u1", previous: null, gapMs: null });
  expect(previousHolderText(first.best)).toBe("die erste Zeit auf dieser Strecke");
});

test("ungültig gemachte Zeit: die Zeile fällt zurück - kein Moment", () => {
  const board = fastLapBoard(8);
  const next = JSON.parse(JSON.stringify(board));
  next.entries = next.entries.filter((entry) => entry.user_id !== "u1");
  const change = compareBoards(board, next);
  expect(change).toEqual({ improved: [], added: [], best: null });
});

test("anderer Streckenstand (Wechsel der Strecke): nichts wird verglichen", () => {
  const board = fastLapBoard(8);
  const other = fastLapBoard(8, { trackId: "track-2", trackName: "Monza" });
  other.entries[0].time_ms = 1000;
  expect(compareBoards(board, other)).toEqual({ improved: [], added: [], best: null });
});
