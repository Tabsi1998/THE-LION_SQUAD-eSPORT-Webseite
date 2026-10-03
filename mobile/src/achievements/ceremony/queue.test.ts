import { BUNDLE_WINDOW_MS, createCeremonyQueue } from "./queue";

// Warteschlange der App (E13, #623), dieselben Fälle wie im Web (E8): nie zwei Zeremonien zugleich, kurz aufeinander folgende Pakete werden eins,
// ein Level-up hängt sich an die laufende Zeremonie, Negatives wird übersprungen.

const tier = (code: string, material = "gold", rank = 5, category = "match") => ({ code, name: code, material, rank, category, points: 10 });

describe("createCeremonyQueue", () => {
  it("zeigt eine Zeremonie nach der anderen und bündelt, was kurz hintereinander kommt", () => {
    let t = 1000;
    const queue = createCeremonyQueue({ now: () => t });
    const seen: Array<string | null> = [];
    queue.subscribe(() => seen.push(queue.getCurrent()?.id || null));
    const first = queue.enqueue({ id: "one", tiers: [tier("a")] });
    expect(queue.getCurrent()!.id).toBe("one");
    t += 500;
    queue.enqueue({ id: "two", tiers: [tier("b")] });
    t += 400;
    queue.enqueue({ id: "three", tiers: [tier("c")], context: { catchUp: true } });
    expect(queue.getPendingCount()).toBe(1);
    t += BUNDLE_WINDOW_MS + 1;
    queue.enqueue({ id: "four", tiers: [tier("d")] });
    expect(queue.getPendingCount()).toBe(2);
    expect(queue.advance()!.id).toBe("two");
    expect(queue.getCurrent()!.tiers.map((x) => x.code)).toEqual(["b", "c"]);
    expect(queue.getCurrent()!.context.catchUp).toBe(true);
    expect(queue.advance()!.id).toBe("four");
    expect(queue.advance()).toBeNull();
    expect(first!.id).toBe("one");
    expect([...new Set(seen.filter(Boolean))]).toEqual(["one", "two", "four"]);
  });

  it("hängt ein Level-up an die laufende Zeremonie und ruft onDone beim Weitergehen", () => {
    const queue = createCeremonyQueue({ now: () => 5 });
    const done = jest.fn();
    queue.enqueue({ id: "one", tiers: [tier("a")], onDone: done });
    queue.enqueue({ tiers: [], levelUp: { level: 7 } });
    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getCurrent()!.levelUp).toEqual({ level: 7 });
    queue.advance();
    expect(done).toHaveBeenCalledTimes(1);
    expect(queue.getCurrent()).toBeNull();
  });

  it("überspringt Pakete ohne Zeremonie (nur Negatives) und ignoriert Leeres", () => {
    const queue = createCeremonyQueue({ now: () => 1 });
    expect(queue.enqueue({ tiers: [] })).toBeNull();
    queue.enqueue({ id: "neg", tiers: [{ code: "n", is_negative: true, category: "negative" }] });
    expect(queue.getCurrent()).toBeNull();
    queue.clear();
    expect(queue.getPendingCount()).toBe(0);
  });
});
