import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { BEST_MS, useLapBoardMotion } from "./useLapBoardMotion";

// Bewegung in der Fast-Lap-Tabelle (#1585): was die Tabelle nach einer neuen Zeit weiß - Hinweis an der Zeile, alte
// Zeit zum Herunterzählen, Band „Neue Bestzeit!“. Ein Neuladen ohne neue Zeit und ein Streckenwechsel tun nichts.

const entry = (key, rank, ms, extra = {}) => ({ participant_id: key, user_id: key.startsWith("guest-") ? null : key, rank, time_ms: ms, time_str: String(ms), display_name: key, ...extra });
const boardOf = (track, entries) => ({ track: { id: track }, entries });

let marks;
function Probe({ board }) {
  const ref = useRef(null);
  marks = useLapBoardMotion(board, ref);
  return (
    <table ref={ref}><tbody>
      {(board?.entries || []).map((row) => <tr key={row.participant_id} data-flip-key={row.participant_id}><td data-rank-digit>{row.rank}</td></tr>)}
    </tbody></table>
  );
}

afterEach(() => { vi.useRealTimers(); });

test("eine schnellere Zeit: Hinweis, alte Zeit zum Herunterzählen, bei Platz 1 das Band", () => {
  const first = boardOf("t1", [entry("a", 1, 80000), entry("guest-g1", 2, 81000)]);
  const { rerender } = render(<Probe board={first} />);
  expect(marks.chips.size).toBe(0);
  rerender(<Probe board={boardOf("t1", [entry("guest-g1", 1, 79500), entry("a", 2, 80000)])} />);
  expect(marks.chips.get("guest-g1").kind).toBe("best");
  expect(marks.fromMs.get("guest-g1")).toBe(81000);
  expect(marks.best.userId).toBe("guest-g1");
  expect(marks.fresh.has("guest-g1")).toBe(true);
});

test("ein Neuladen ohne neue Zeit und ein Streckenwechsel bewegen nichts", () => {
  const first = boardOf("t1", [entry("a", 1, 80000)]);
  const { rerender } = render(<Probe board={first} />);
  rerender(<Probe board={JSON.parse(JSON.stringify(first))} />);
  expect(marks.chips.size).toBe(0);
  rerender(<Probe board={boardOf("t2", [entry("b", 1, 70000)])} />);
  expect(marks.chips.size).toBe(0);
  expect(marks.best).toBeNull();
});

test("das Band geht nach ein paar Sekunden wieder", () => {
  vi.useFakeTimers();
  const { rerender } = render(<Probe board={boardOf("t1", [entry("a", 1, 80000)])} />);
  rerender(<Probe board={boardOf("t1", [entry("b", 1, 79000), entry("a", 2, 80000)])} />);
  expect(marks.best).not.toBeNull();
  act(() => { vi.advanceTimersByTime(BEST_MS + 100); });
  expect(marks.best).toBeNull();
});

test("die Platzziffer: eine neue Zeit bricht die laufende Bewegung ab, das Verlassen der Seite alle (Nachprüfung)", () => {
  const animations = [];
  const original = globalThis.Element.prototype.animate;
  globalThis.Element.prototype.animate = vi.fn(() => { const animation = { cancel: vi.fn() }; animations.push(animation); return animation; });
  try {
    const { rerender, unmount } = render(<Probe board={boardOf("t1", [entry("a", 1, 80000), entry("b", 2, 81000)])} />);
    rerender(<Probe board={boardOf("t1", [entry("b", 1, 79000), entry("a", 2, 80000)])} />);
    expect(animations).toHaveLength(2);
    rerender(<Probe board={boardOf("t1", [entry("a", 1, 78000), entry("b", 2, 79000)])} />);
    expect(animations).toHaveLength(4);
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(animations[1].cancel).toHaveBeenCalled();
    unmount();
    expect(animations[2].cancel).toHaveBeenCalled();
    expect(animations[3].cancel).toHaveBeenCalled();
  } finally {
    globalThis.Element.prototype.animate = original;
  }
});
