import { useEffect } from "react";
import { API } from "@/lib/api";
import { emitApiInvalidation } from "@/lib/apiInvalidation";

export function ApiInvalidationBridge() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return undefined;

    const source = new EventSource(`${API}/changes/stream`, { withCredentials: true });
    source.addEventListener("change", (message) => {
      try {
        emitApiInvalidation({ ...JSON.parse(message.data), source: "server" });
      } catch {
        // Ignore malformed stream events; the browser will keep the stream alive.
      }
    });

    return () => source.close();
  }, []);

  return null;
}
