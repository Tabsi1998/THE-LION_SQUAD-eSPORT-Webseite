import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getCachedBranding, onBrandingUpdated, setCachedBranding } from "@/lib/brandingEvents";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

/** Shared read path for the canonical public branding/contact/legal contract. */
export function usePublicSiteSettings() {
  const [settings, setSettings] = useState(() => getCachedBranding() || {});
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/public");
      setCachedBranding(data || {});
    } catch {}
  }, []);

  useEffect(() => {
    const unsubscribe = onBrandingUpdated((next) => setSettings(next || {}));
    load();
    return unsubscribe;
  }, [load]);
  useApiInvalidation(load, ["settings", "branding"]);

  return settings;
}
