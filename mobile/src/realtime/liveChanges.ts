/**
 * Live-Änderungen vom Server für die App.
 *
 * Der Server meldet über /api/changes/stream (Server-Sent Events), welche
 * Ressource sich geändert hat - ohne Inhalte. Ansichten laden daraufhin neu.
 * Das Web liest denselben Strom (frontend/src/lib/apiInvalidation.js); die
 * Zuordnung von Ereignis zu Ansicht ist hier bewusst gleich gehalten.
 *
 * React Native kennt kein EventSource. Gelesen wird deshalb der Antwortstrom
 * von expo/fetch; das Format ist klein genug für einen eigenen Parser.
 */

export type LiveChange = {
  event_id?: string;
  event_type?: string;
  path?: string;
  resource?: string;
  reset?: boolean;
  reason?: string;
  version?: number;
};

export type SseMessage = { event: string; data: string; id?: string };

/**
 * Zerlegt einen SSE-Strom in Nachrichten. Blöcke dürfen beliebig über Chunks
 * verteilt ankommen; Kommentarzeilen (Heartbeats) werden ignoriert.
 */
export function createSseParser(dispatch: (message: SseMessage) => void) {
  let pending = "";
  let eventName = "";
  let dataLines: string[] = [];
  let lastId: string | undefined;

  const flush = () => {
    if (dataLines.length) dispatch({ event: eventName || "message", data: dataLines.join("\n"), id: lastId });
    eventName = "";
    dataLines = [];
  };

  return (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      if (line === "") {
        flush();
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") eventName = value;
        else if (field === "data") dataLines.push(value);
        else if (field === "id" && !value.includes("\0")) lastId = value;
      }
      newline = pending.indexOf("\n");
    }
  };
}

export function normalizeApiPath(path?: string | null) {
  if (!path) return "";
  let value = String(path).split("?")[0].replace(/^https?:\/\/[^/]+/i, "");
  value = value.replace(/^\/+/, "");
  if (value.startsWith("api/")) value = value.slice(4);
  return value.replace(/\/+$/, "");
}

export function resourceFromPath(path?: string | null) {
  const parts = normalizeApiPath(path).split("/").filter(Boolean);
  if (!parts.length) return "";
  if (parts[0] === "admin" && parts[1]) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

// Wie im Web: Eine Änderung an matches-v2 betrifft auch Turnieransichten usw.
const RESOURCE_ALIASES: Record<string, string[]> = {
  "admin/achievements": ["achievements", "badges", "users"],
  "admin/media": ["media", "uploads"],
  "admin/nav": ["nav"],
  "admin/pages": ["pages", "cms"],
  "membership/applications": ["membership", "users"],
  "membership/benefits": ["membership"],
  "membership/user": ["membership", "users"],
  "settings/branding": ["settings", "branding", "nav", "home"],
  uploads: ["media"],
  matches: ["tournaments"],
  "matches-v2": ["tournaments", "matches"],
  prizes: ["users"],
  f1: ["fastlap", "prizes"],
};

function eventKeys(event: LiveChange) {
  const path = normalizeApiPath(event.path);
  const resource = event.resource || resourceFromPath(path);
  const keys = new Set([path, resource].filter(Boolean));
  if (path.startsWith("admin/")) keys.add(path.slice("admin/".length));
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i <= Math.min(parts.length, 3); i += 1) {
    keys.add(parts.slice(0, i).join("/"));
    if (parts[0] === "admin" && i > 1) keys.add(parts.slice(1, i).join("/"));
  }
  for (const key of [...keys]) {
    (RESOURCE_ALIASES[key] || []).forEach((alias) => keys.add(alias));
  }
  return [...keys].filter(Boolean);
}

export function liveChangeMatches(event: LiveChange, resources: readonly string[]) {
  if (event.reset || event.event_type === "stream.reset") return true;
  if (!resources.length) return true;
  const keys = eventKeys(event);
  return resources.some((candidate) => {
    const normalized = normalizeApiPath(candidate);
    if (!normalized) return true;
    return keys.some((key) => key === normalized || key.startsWith(`${normalized}/`));
  });
}

type StreamChunk = { done: boolean; value?: Uint8Array };
export type StreamResponse = {
  ok: boolean;
  status: number;
  body: { getReader(): { read(): Promise<StreamChunk> } } | null;
};
export type StreamFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<StreamResponse>;
type Decoder = { decode(input?: Uint8Array, options?: { stream?: boolean }): string };

export type LiveConnectionOptions = {
  url: string;
  fetchImpl: StreamFetch;
  getToken: () => string | null;
  /** Erneuert eine abgelaufene Sitzung; true, wenn es geklappt hat. */
  refreshSession?: () => Promise<boolean>;
  createDecoder?: () => Decoder;
  maxDelayMs?: number;
};

export type LiveConnection = ReturnType<typeof createLiveConnection>;

const SEEN_EVENT_LIMIT = 256;

function defaultDecoder(): Decoder {
  const Ctor = (globalThis as unknown as { TextDecoder?: new () => Decoder }).TextDecoder;
  if (!Ctor) throw new Error("TextDecoder ist nicht verfügbar.");
  return new Ctor();
}

export function createLiveConnection(options: LiveConnectionOptions) {
  const listeners = new Set<(event: LiveChange) => void>();
  const statusListeners = new Set<(connected: boolean) => void>();
  const seen = new Set<string>();
  const seenOrder: string[] = [];
  let active = false;
  let generation = 0;
  let connected = false;
  let failures = 0;
  let lastEventId: string | undefined;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeRetry: (() => void) | null = null;

  const setConnected = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    statusListeners.forEach((listener) => listener(value));
  };

  const emit = (event: LiveChange) => {
    // Resets tragen je Grund dieselbe Kennung und müssen jedes Mal ankommen.
    const key = event.event_id;
    if (key && !event.reset) {
      if (seen.has(key)) return;
      seen.add(key);
      seenOrder.push(key);
      if (seenOrder.length > SEEN_EVENT_LIMIT) seen.delete(seenOrder.shift() as string);
    }
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Ein defekter Abonnent darf die anderen nicht aufhalten.
      }
    });
  };

  async function readOnce(runId: number): Promise<"closed" | "refreshed"> {
    const abort = new AbortController();
    controller = abort;
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    const token = options.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;

    const response = await options.fetchImpl(options.url, { headers, signal: abort.signal });
    if (response.status === 401 && token && options.refreshSession && (await options.refreshSession())) {
      return "refreshed";
    }
    if (!response.ok || !response.body) throw new Error(`Live-Strom nicht verfügbar (${response.status})`);

    const reader = response.body.getReader();
    const decoder = (options.createDecoder || defaultDecoder)();
    const feed = createSseParser((message) => {
      if (runId !== generation) return;
      if (message.event === "connected") {
        failures = 0;
        setConnected(true);
        return;
      }
      if (message.event !== "change" && message.event !== "reset") return;
      let data: LiveChange;
      try {
        data = JSON.parse(message.data) as LiveChange;
      } catch {
        return;
      }
      if (message.event === "change" && message.id) lastEventId = message.id;
      emit({ ...data, reset: message.event === "reset" || data.reset === true });
    });

    while (runId === generation) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) feed(decoder.decode(value, { stream: true }));
    }
    return "closed";
  }

  async function loop(runId: number) {
    while (runId === generation) {
      let outcome: "closed" | "refreshed" | "failed" = "failed";
      try {
        outcome = await readOnce(runId);
      } catch {
        outcome = "failed";
      }
      if (runId !== generation) return;
      setConnected(false);
      failures += 1;
      // Nach erneuerter Sitzung sofort, sonst mit wachsendem Abstand bis maxDelayMs.
      const delay = outcome === "refreshed" && failures <= 1
        ? 0
        : Math.min(options.maxDelayMs ?? 30_000, 1000 * 2 ** Math.min(failures - 1, 5));
      await new Promise<void>((resolve) => {
        wakeRetry = resolve;
        retryTimer = setTimeout(resolve, delay);
      });
      retryTimer = null;
      wakeRetry = null;
    }
  }

  function start() {
    if (active) return;
    active = true;
    generation += 1;
    void loop(generation);
  }

  function stop() {
    if (!active) return;
    active = false;
    generation += 1;
    controller?.abort();
    controller = null;
    if (retryTimer) clearTimeout(retryTimer);
    wakeRetry?.();
    setConnected(false);
  }

  return {
    start,
    stop,
    /** Neu verbinden, etwa nach An- oder Abmeldung. Die Wiederaufnahme-Marke gehört zur alten Sitzung. */
    restart() {
      stop();
      lastEventId = undefined;
      start();
    },
    subscribe(listener: (event: LiveChange) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onStatus(listener: (value: boolean) => void) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    /** Lokales Ereignis, etwa ein Reset nach Rückkehr aus dem Hintergrund. */
    emitLocal(event: LiveChange) {
      emit(event);
    },
    isConnected: () => connected,
  };
}
