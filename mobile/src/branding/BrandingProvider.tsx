import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { brandingFromSettings, DEFAULT_BRANDING, type Branding, type PublicBranding } from "../lib/branding";
import { useLiveRefresh } from "../realtime/LiveChangesProvider";

// Ändert der Verein Logo, Maskottchen oder Namen in den Einstellungen, zieht die App mit (#229):
// einmal beim Start, danach live über „settings/branding“. Ohne Provider - in Tests - gelten die
// eingebauten Werte, ohne Netz bleiben sie stehen.
const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<PublicBranding>("/settings/public");
      setBranding(brandingFromSettings(data));
    } catch {
      // Offline oder Server nicht da: die eingebauten Bilder tragen weiter.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(load, ["settings", "branding"]);

  const value = useMemo(() => branding, [branding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
