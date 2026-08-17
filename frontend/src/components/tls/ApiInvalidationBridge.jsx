import { useEffect } from "react";
import { API } from "@/lib/api";
import { emitApiInvalidation } from "@/lib/apiInvalidation";

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

    return () => source.close();
  }, []);

  return null;
}
