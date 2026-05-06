import { useEffect, useMemo, useRef } from "react";
import { invalidationMatches, subscribeApiInvalidation } from "@/lib/apiInvalidation";

export function useApiInvalidation(callback, resources = [], options = {}) {
  const callbackRef = useRef(callback);
  const timerRef = useRef(null);
  const debounceMs = options.debounceMs ?? 150;
  const resourceKey = useMemo(() => resources.join("|"), [resources]);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const selectedResources = resourceKey ? resourceKey.split("|") : [];
    return subscribeApiInvalidation((event) => {
      if (!invalidationMatches(event, selectedResources)) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        Promise.resolve(callbackRef.current?.(event)).catch(() => {});
      }, debounceMs);
    });
  }, [debounceMs, resourceKey]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
}
