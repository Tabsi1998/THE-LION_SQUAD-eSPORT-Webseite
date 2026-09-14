import { TextDecoder, TextEncoder } from "util";
import {
  createLiveConnection,
  createSseParser,
  liveChangeMatches,
  type LiveChange,
  type SseMessage,
  type StreamFetch,
  type StreamResponse,
} from "./liveChanges";

// Die App fragte bisher im Intervall ab: Chat alle 7 s, Turnierliste alle 30 s.
// Mit dem Live-Strom lädt eine Ansicht erst, wenn sich wirklich etwas geändert
// hat. Dafür muss der Strom stimmen - Blöcke über Chunks hinweg, Wiederverbinden
// ohne verlorene Ereignisse, und eine abgelaufene Sitzung darf ihn nicht stilllegen.

const encoder = new TextEncoder();

function controllableStream(status = 200) {
  const queue: Array<{ done: boolean; value?: Uint8Array }> = [];
  let waiting: ((chunk: { done: boolean; value?: Uint8Array }) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;

  const deliver = (chunk: { done: boolean; value?: Uint8Array }) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      fail = null;
      resolve(chunk);
    } else {
      queue.push(chunk);
    }
  };

  const response: StreamResponse = {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: () => new Promise((resolve, reject) => {
          const next = queue.shift();
          if (next) {
            resolve(next);
          } else {
            waiting = resolve;
            fail = reject;
          }
        }),
      }),
    },
  };

  return {
    response,
    push: (text: string) => deliver({ done: false, value: encoder.encode(text) }),
    end: () => deliver({ done: true }),
    abort: () => {
      if (fail) {
        const reject = fail;
        waiting = null;
        fail = null;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }
    },
  };
}

type Call = { url: string; headers: Record<string, string>; signal: AbortSignal };

function harness(responses: Array<ReturnType<typeof controllableStream> | StreamResponse>, token: { value: string | null }) {
  const calls: Call[] = [];
  const fetchImpl: StreamFetch = async (url, init) => {
    calls.push({ url, ...init });
    const next = responses.shift();
    if (!next) return new Promise<StreamResponse>(() => {});
    if ("response" in next) {
      init.signal.addEventListener("abort", () => next.abort());
      return next.response;
    }
    return next;
  };
  const refreshSession = jest.fn(async () => {
    token.value = "token-neu";
    return true;
  });
  const connection = createLiveConnection({
    url: "https://example.test/api/changes/stream",
    fetchImpl,
    getToken: () => token.value,
    refreshSession,
    createDecoder: () => new TextDecoder() as unknown as { decode(input?: Uint8Array, options?: { stream?: boolean }): string },
  });
  const events: LiveChange[] = [];
  const statuses: boolean[] = [];
  connection.subscribe((event) => events.push(event));
  connection.onStatus((value) => statuses.push(value));
  return { calls, connection, events, statuses, refreshSession };
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const change = (id: string, resource: string) =>
  `id: ${id}\nevent: change\ndata: ${JSON.stringify({ event_id: id, resource, path: `/api/${resource}` })}\n\n`;

describe("SSE-Parser", () => {
  test("setzt Blöcke zusammen, die über Chunks verteilt ankommen", () => {
    const messages: SseMessage[] = [];
    const feed = createSseParser((message) => messages.push(message));

    feed("id: e1\nevent: cha");
    feed("nge\ndata: {\"resource\":");
    feed("\"teams\"}\r\n\r\n: heartbeat\n\n");

    expect(messages).toEqual([{ event: "change", data: "{\"resource\":\"teams\"}", id: "e1" }]);
  });

  test("verbindet mehrzeilige Daten und ignoriert Kommentare", () => {
    const messages: SseMessage[] = [];
    const feed = createSseParser((message) => messages.push(message));

    feed(": heartbeat\n\nevent: connected\ndata: a\ndata: b\n\n");

    expect(messages).toEqual([{ event: "connected", data: "a\nb", id: undefined }]);
  });
});

describe("Zuordnung von Ereignis zu Ansicht", () => {
  test("eine geschwärzte öffentliche Turnieränderung trifft Turnieransichten", () => {
    const event = { resource: "tournaments", path: "/api/tournaments" };
    expect(liveChangeMatches(event, ["tournaments"])).toBe(true);
    expect(liveChangeMatches(event, ["news"])).toBe(false);
  });

  test("ein v2-Ergebnis trifft Match- und Turnieransichten", () => {
    const event = { resource: "matches-v2", path: "/api/matches-v2" };
    expect(liveChangeMatches(event, ["matches"])).toBe(true);
    expect(liveChangeMatches(event, ["tournaments"])).toBe(true);
  });

  test("private Ereignisse treffen nur ihre eigene Ansicht", () => {
    const event = { resource: "messages", path: "/api/messages" };
    expect(liveChangeMatches(event, ["messages"])).toBe(true);
    expect(liveChangeMatches(event, ["teams", "notifications"])).toBe(false);
  });

  test("ein Reset trifft jede Ansicht", () => {
    expect(liveChangeMatches({ reset: true }, ["teams"])).toBe(true);
  });
});

describe("Live-Verbindung", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("meldet sich mit Token an und reicht Änderungen genau einmal weiter", async () => {
    const stream = controllableStream();
    const { calls, connection, events, statuses } = harness([stream], { value: "token-alt" });

    connection.start();
    await settle();
    stream.push("event: connected\ndata: {\"ok\":true}\n\n");
    stream.push(change("e1", "teams"));
    stream.push(change("e1", "teams"));
    await settle();

    expect(calls[0].headers.Authorization).toBe("Bearer token-alt");
    expect(calls[0].headers.Accept).toBe("text/event-stream");
    expect(statuses).toEqual([true]);
    expect(events.map((event) => event.event_id)).toEqual(["e1"]);
    connection.stop();
  });

  test("Gäste verbinden ohne Token", async () => {
    const stream = controllableStream();
    const { calls, connection } = harness([stream], { value: null });

    connection.start();
    await settle();

    expect(calls[0].headers.Authorization).toBeUndefined();
    connection.stop();
  });

  test("jeder Reset kommt an, auch mit derselben Kennung", async () => {
    const stream = controllableStream();
    const { connection, events } = harness([stream], { value: "token" });
    const reset = "event: reset\ndata: {\"event_id\":\"stream-reset:x\",\"reset\":true}\n\n";

    connection.start();
    await settle();
    stream.push(reset);
    stream.push(reset);
    await settle();

    expect(events.filter((event) => event.reset)).toHaveLength(2);
    connection.stop();
  });

  test("verbindet nach einem Abbruch neu und setzt beim letzten Ereignis wieder an", async () => {
    jest.useFakeTimers();
    const first = controllableStream();
    const second = controllableStream();
    const { calls, connection, statuses } = harness([first, second], { value: "token" });

    connection.start();
    await settle();
    first.push("event: connected\ndata: {}\n\n");
    first.push(change("e7", "tournaments"));
    first.end();
    await settle();

    expect(statuses).toEqual([true, false]);
    expect(calls).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1000);
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[1].headers["Last-Event-ID"]).toBe("e7");
    connection.stop();
  });

  test("eine abgelaufene Sitzung wird erneuert und sofort wieder verbunden", async () => {
    jest.useFakeTimers();
    const unauthorized: StreamResponse = { ok: false, status: 401, body: null };
    const stream = controllableStream();
    const token = { value: "token-alt" as string | null };
    const { calls, connection, refreshSession } = harness([unauthorized, stream], token);

    connection.start();
    await settle();
    await jest.advanceTimersByTimeAsync(0);
    await settle();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.Authorization).toBe("Bearer token-neu");
    connection.stop();
  });

  test("stop bricht den Strom ab und verbindet nicht erneut", async () => {
    jest.useFakeTimers();
    const stream = controllableStream();
    const { calls, connection, statuses } = harness([stream, controllableStream()], { value: "token" });

    connection.start();
    await settle();
    stream.push("event: connected\ndata: {}\n\n");
    await settle();
    connection.stop();
    await settle();
    await jest.advanceTimersByTimeAsync(60_000);
    await settle();

    expect(calls[0].signal.aborted).toBe(true);
    expect(calls).toHaveLength(1);
    expect(statuses).toEqual([true, false]);
  });

  test("restart vergisst die Wiederaufnahme-Marke der alten Sitzung", async () => {
    const first = controllableStream();
    const second = controllableStream();
    const { calls, connection } = harness([first, second], { value: "token" });

    connection.start();
    await settle();
    first.push(change("e9", "messages"));
    await settle();
    connection.restart();
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[1].headers["Last-Event-ID"]).toBeUndefined();
    connection.stop();
  });
});
