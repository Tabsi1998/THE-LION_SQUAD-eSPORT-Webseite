import { useEffect } from "react";
import { API } from "@/lib/api";
import { emitApiInvalidation, setStreamConnected } from "@/lib/apiInvalidation";

export function ApiInvalidationBridge() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return undefined;

    const source = new EventSource(`${API}/changes/stream`, { withCredentials: true });
    const forward = (message, reset = false) => {
      try {
        emitApiInvalidation({ ...JSON.parse(message.data), reset, source: "server" });
      } catch {
        // Ignore malformed stream events; the browser will keep the stream alive.
      }
    };
    source.addEventListener("change", (message) => forward(message));
    source.addEventListener("reset", (message) => forward(message, true));
    // Der Browser verbindet nach einem Abbruch von selbst neu. Dazwischen
    // gilt der Strom als getrennt, und die Ansichten fragen im Takt nach.
    source.addEventListener("open", () => setStreamConnected(true));
    source.addEventListener("error", () => setStreamConnected(false));

    return () => {
      source.close();
      setStreamConnected(false);
    };
  }, []);

  return null;
}
